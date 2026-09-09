"""Gutscheine der Familie (Punkt 264 der Werkbank): Sichtbarkeit, Klemmen,
Ablauf-Erinnerung, Bild und Familienbuch – dazu die angehängte Datei
(Punkt 266): ablegen, ausliefern, ablehnen, aufräumen."""

from __future__ import annotations

import base64
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import dateien, familienbuch, gutscheine
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

# Ein winziges, echtes PDF - an den ersten Bytes sieht man, dass genau
# das ankam, was hineinging (Punkt 266 der Werkbank).
PDF_ROH = b"%PDF-1.4\n%HomePilot\n1 0 obj\n<<>>\nendobj\n"
PDF = "data:application/pdf;base64," + base64.b64encode(PDF_ROH).decode()

# ── Reine Funktionen ─────────────────────────────────────────────────────


def test_bereinigen_klemmt_den_rest_zwischen_null_und_gesamtwert():
    """Ein Rest von -5 heisst «aufgebraucht», nicht «Fehler»."""
    unter = gutscheine.bereinigen({"total": 100, "left": -5})
    assert unter["left"] == 0
    ueber = gutscheine.bereinigen({"total": 100, "left": 140})
    assert ueber["left"] == 100


def test_bereinigen_setzt_den_rest_ohne_angabe_auf_den_gesamtwert():
    neu = gutscheine.bereinigen({"total": 50})
    assert neu["left"] == 50


def test_bereinigen_macht_aus_stueck_ganze_zahlen():
    stk = gutscheine.bereinigen({"unit": "stk", "total": 2.6, "left": 1.4})
    assert stk["total"] == 3 and stk["left"] == 1
    assert isinstance(stk["left"], int)


def test_bereinigen_faellt_bei_unsinn_auf_bekannte_woerter_zurueck():
    unsinn = gutscheine.bereinigen(
        {"unit": "euro", "shared": "geheim", "total": "viel", "expires": "irgendwann"}
    )
    assert unsinn["unit"] == "chf"
    assert unsinn["shared"] == "familie"
    assert unsinn["total"] == 0 and unsinn["left"] == 0
    assert unsinn["expires"] is None


def test_bereinigen_laesst_ein_datum_und_leere_frist_durch():
    assert gutscheine.bereinigen({"expires": "2030-06-30"})["expires"] == "2030-06-30"
    assert gutscheine.bereinigen({"expires": ""})["expires"] is None
    assert gutscheine.bereinigen({"expires": None})["expires"] is None


def test_bereinigen_wirft_kaputte_abzuege_weg():
    sauber = gutscheine.bereinigen(
        {"total": 10, "left": 5, "transactions": [{"amount": 5}, "kaputt", None]}
    )
    assert sauber["transactions"] == [{"amount": 5}]
    assert gutscheine.bereinigen({"transactions": "x"})["transactions"] == []


def test_privat_sieht_nur_der_autor_auch_der_besitzer_nicht():
    """«Privat» heisst privat - sonst wäre das Wort eine Lüge."""
    rows = [
        {"id": "a", "author": "Livia", "shared": "privat"},
        {"id": "b", "author": "Livia", "shared": "familie"},
        {"id": "c", "author": "Stefan"},  # ohne Angabe: geteilt
    ]
    assert [r["id"] for r in gutscheine.sichtbar(rows, "Stefan")] == ["b", "c"]
    assert [r["id"] for r in gutscheine.sichtbar(rows, "Livia")] == ["a", "b", "c"]
    assert not gutscheine.darf_sehen(rows[0], "Stefan")
    assert gutscheine.darf_sehen(rows[0], "Livia")


def test_ablaufende_nennt_die_engste_erreichte_stufe():
    heute = date(2030, 6, 1)
    rows = [
        {"id": "weit", "left": 80, "expires": "2030-06-30"},  # 29 Tage → 30er-Stufe
        {"id": "nah", "left": 10, "expires": "2030-06-05"},  # 4 Tage → nur 7er-Stufe
        {"id": "fern", "left": 10, "expires": "2030-09-01"},  # noch nichts
    ]
    treffer = {row["id"]: (stufe, tage) for row, stufe, tage in gutscheine.ablaufende(rows, heute)}
    # Index der Stufe: 0 = erste Erinnerung, 1 = zweite, 2 = Ablauftag.
    assert treffer == {"weit": (0, 29), "nah": (1, 4)}


def test_ablaufende_uebergeht_leere_unbegrenzte_und_abgelaufene():
    heute = date(2030, 6, 1)
    rows = [
        {"id": "leer", "left": 0, "expires": "2030-06-03"},
        {"id": "unbegrenzt", "left": 50, "expires": None},
        {"id": "vorbei", "left": 50, "expires": "2030-05-30"},
        {"id": "heute", "left": 50, "expires": "2030-06-01"},
    ]
    assert [
        (row["id"], stufe) for row, stufe, _ in gutscheine.ablaufende(rows, heute)
    ] == [("heute", 2)]


def test_ablaufende_nimmt_die_stufen_aus_den_einstellungen():
    heute = date(2030, 6, 1)
    rows = [{"id": "g", "left": 5, "expires": "2030-07-10"}]  # 39 Tage
    assert gutscheine.ablaufende(rows, heute) == []
    prefs = gutscheine.prefs_lesen({"first_days": 45, "second_days": 10})
    treffer = gutscheine.ablaufende(rows, heute, gutscheine.stufen(prefs))
    assert [(stufe, tage) for _, stufe, tage in treffer] == [(0, 39)]


def test_prefs_vorgaben_sind_dreissig_und_sieben():
    assert gutscheine.prefs_lesen(None) == {"first_days": 30, "second_days": 7}
    assert gutscheine.prefs_lesen([]) == {"first_days": 30, "second_days": 7}
    # Die Ein-Eintrag-Liste des DataStore wird gelesen wie ein Dict.
    assert gutscheine.prefs_lesen([{"first_days": 14, "second_days": 3}]) == {
        "first_days": 14,
        "second_days": 3,
    }


def test_prefs_klemmen_und_tauschen():
    assert gutscheine.prefs_lesen({"first_days": 900, "second_days": 0}) == {
        "first_days": 365,
        "second_days": 1,
    }
    # Vertauscht eingetragen: getauscht, nicht abgelehnt.
    assert gutscheine.prefs_lesen({"first_days": 7, "second_days": 30}) == {
        "first_days": 30,
        "second_days": 7,
    }
    # Gleich: die erste rückt nach vorn - sonst käme dieselbe Erinnerung zweimal.
    assert gutscheine.prefs_lesen({"first_days": 7, "second_days": 7}) == {
        "first_days": 7,
        "second_days": 6,
    }
    assert gutscheine.prefs_lesen({"first_days": 1, "second_days": 1}) == {
        "first_days": 2,
        "second_days": 1,
    }
    assert gutscheine.prefs_lesen({"first_days": "x", "second_days": None}) == {
        "first_days": 30,
        "second_days": 7,
    }


def test_die_meldung_liest_sich_wie_versprochen():
    eintrag = {"shop": "Brack.ch", "unit": "chf", "left": 80, "expires": "2030-06-30"}
    titel, text = gutscheine.meldung(eintrag, 7)
    assert titel == "Gutschein läuft ab"
    assert text == "Brack.ch: 80 CHF verfallen in 7 Tagen (30.06.2030)"


def test_die_meldung_kennt_stueck_rappen_morgen_und_heute():
    stk = {"shop": "Kinderparadies", "unit": "stk", "left": 1, "expires": "2030-06-30"}
    assert gutscheine.meldung(stk, 1)[1] == "Kinderparadies: 1 Stück verfällt morgen (30.06.2030)"
    rappen = {"shop": "Coop", "unit": "chf", "left": 12.5, "expires": "2030-06-30"}
    assert gutscheine.meldung(rappen, 0)[1] == "Coop: 12.50 CHF verfallen heute (30.06.2030)"


def test_die_marke_traegt_das_ablaufdatum_und_die_stellung_der_stufe():
    """Wer die Frist verlängert, soll vor dem neuen Datum wieder erinnert
    werden - wer die Stufen umstellt, aber nicht noch einmal dieselbe."""
    a = gutscheine.marke({"id": "x", "expires": "2030-06-30"}, 1)
    b = gutscheine.marke({"id": "x", "expires": "2030-12-31"}, 1)
    assert a != b
    assert a.endswith(":zweite") and "7" not in a.split(":")[-1]
    assert gutscheine.marke({"id": "x", "expires": "2030-06-30"}, 2).endswith(":tag")


def test_empfaenger_privat_der_autor_geteilt_alle():
    assert gutscheine.empfaenger({"shared": "privat", "author": "Livia"}) == "Livia"
    assert gutscheine.empfaenger({"shared": "familie", "author": "Livia"}) is None


def test_ins_buch_kommen_nur_geteilte_ohne_pin():
    rows = [
        {"id": "a", "shop": "Brack.ch", "number": "574", "pin": "1234", "shared": "familie"},
        {"id": "b", "shop": "Geheim", "number": "999", "pin": "0000", "shared": "privat"},
    ]
    buch = gutscheine.fuers_buch(rows)
    assert [r["shop"] for r in buch] == ["Brack.ch"]
    assert "pin" not in buch[0] and buch[0]["number"] == "574"


def test_ein_anhang_ohne_adresse_fliegt_aus_dem_gutschein():
    """Was keine Adresse hat, ist kein Anhang - vor allem der data-URI.

    Bliebe der `{"data": …}` stehen, läge die ganze Datei in der
    Datendatei; genau davor sollen die Dateien bewahren.
    """
    riesig = {"data": "data:application/pdf;base64,JVBERi0=", "name": "x.pdf"}
    assert gutscheine.bereinigen({"file": riesig})["file"] is None
    assert gutscheine.bereinigen({"file": "irgendwas"})["file"] is None
    assert gutscheine.bereinigen({"file": None})["file"] is None
    # Eine fremde Adresse ist keine: Sonst bestimmte der Schreiber eines
    # Eintrags, welchen Server die App beim Öffnen aufruft.
    fremd = {"url": "https://beispiel.ch/x.pdf", "name": "x.pdf"}
    assert gutscheine.bereinigen({"file": fremd})["file"] is None
    # Ohne das Feld bleibt es weg - ein PUT ohne «file» ist keine Aussage.
    assert "file" not in gutscheine.bereinigen({"total": 10})


def test_ein_anhang_wird_auf_seine_vier_felder_geklemmt():
    sauber = gutscheine.bereinigen(
        {
            "file": {
                "url": "/api/family/vouchers/abc/datei?v=deadbeef",
                "name": "Gutschein Brack.pdf",
                "type": "application/pdf",
                "bytes": "182913",
                "data": "data:application/pdf;base64,JVBERi0=",
                "geheim": "weg damit",
            }
        }
    )["file"]
    assert sauber == {
        "url": "/api/family/vouchers/abc/datei?v=deadbeef",
        "name": "Gutschein Brack.pdf",
        "type": "application/pdf",
        "bytes": 182913,
    }
    # Unsinn wird geklemmt, nicht abgelehnt - wie der Rest des Gutscheins.
    krumm = gutscheine.bereinigen(
        {"file": {"url": "/api/family/vouchers/a/datei", "type": "x/y", "bytes": -3}}
    )["file"]
    assert krumm["type"] == "application/octet-stream"
    assert krumm["bytes"] == 0 and krumm["name"] == "Datei"


def test_entpacke_nimmt_pdf_und_lehnt_programme_und_riesen_ab():
    """Ausführbares hat auf einem Hub nichts zu suchen - und ein Video auch nicht."""
    roh, endung, typ = dateien.entpacke(PDF)
    assert roh.startswith(b"%PDF") and endung == "pdf" and typ == "application/pdf"

    for verboten in ("text/html", "image/svg+xml", "application/x-sh"):
        with pytest.raises(dateien.DateiFehler) as fehler:
            dateien.entpacke(f"data:{verboten};base64,{base64.b64encode(b'x').decode()}")
        assert fehler.value.status == 415

    with pytest.raises(dateien.DateiFehler) as fehler:
        dateien.entpacke("/api/family/vouchers/a/datei?v=abc")
    assert fehler.value.status == 415

    with pytest.raises(dateien.DateiFehler) as fehler:
        dateien.entpacke(
            "data:application/pdf;base64,"
            + base64.b64encode(b"x" * (dateien.MAX_BYTES + 1)).decode()
        )
    assert fehler.value.status == 413
    assert "MB" in str(fehler.value)


def test_ein_dateiname_bricht_die_kopfzeile_nicht():
    """Der Name kommt aus einer Mail - Umbruch, Anführungszeichen, Pfad."""
    boese = 'Gutschein"\r\nX-Böse: ja\r\n\r\n../../etc/passwd'
    name = dateien.sauberer_name(boese, "pdf")
    assert "\n" not in name and "\r" not in name and '"' not in name
    assert "/" not in name and "\\" not in name
    kopf = dateien.disposition(boese)
    assert "\n" not in kopf and "\r" not in kopf
    assert kopf.startswith('inline; filename="') and "filename*=UTF-8''" in kopf
    # Umlaute überleben - aber nur im kodierten Teil; der einfache ist
    # ASCII, sonst scheiterte die ganze Antwort an der latin-1-Kopfzeile.
    kopf = dateien.disposition("Gutschein Küche 🎁.pdf")
    assert kopf.encode("latin-1")
    assert "K%C3%BCche" in kopf
    # Und die Endung wird angehängt, wenn sie fehlt.
    assert dateien.sauberer_name("Gutschein Brack", "pdf") == "Gutschein Brack.pdf"
    assert dateien.sauberer_name("Gutschein.PDF", "pdf") == "Gutschein.PDF"
    assert dateien.sauberer_name("   ", "pdf") == "Datei.pdf"


def test_ins_buch_kommt_der_dateiname_ohne_die_adresse():
    """Der Name sagt, dass es eine Datei gab; die Adresse nützt ohne Hub nichts."""
    rows = gutscheine.fuers_buch(
        [
            {
                "id": "a",
                "shop": "Brack.ch",
                "file": {
                    "url": "/api/family/vouchers/a/datei?v=abc",
                    "name": "Gutschein Brack.pdf",
                    "type": "application/pdf",
                    "bytes": 1234,
                },
            }
        ]
    )
    assert rows[0]["file"] == "Gutschein Brack.pdf"
    seite = familienbuch.render({"family_vouchers": rows}, "01.09.2026")
    assert "Gutschein Brack.pdf" in seite
    assert "/datei" not in seite


def test_das_familienbuch_zeigt_gutscheine_ohne_pin_und_ohne_private():
    seite = familienbuch.render(
        {
            "family_vouchers": [
                {"id": "a", "shop": "Brack.ch", "title": "Gutschein", "number": "574124",
                 "pin": "9876", "left": 80, "shared": "familie"},
                {"id": "b", "shop": "Nurmeins", "number": "111", "shared": "privat"},
            ]
        },
        "01.09.2026",
    )
    assert "Gutscheine" in seite and "Brack.ch" in seite and "574124" in seite
    assert "9876" not in seite
    assert "Nurmeins" not in seite


# ── Routen ───────────────────────────────────────────────────────────────

USERS = [
    {"name": "Stefan", "role": "besitzer", "token": "t-owner"},
    {"name": "Livia", "role": "bewohner", "token": "t-livia"},
]

# 1×1 Pixel als PNG – klein genug für einen Test, echt genug für den Decoder.
WINZIG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM"
    "IQAAAABJRU5ErkJggg=="
)


def make_client(tmp_path=None) -> TestClient:
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            users=USERS,
            data_file=str(tmp_path / "hub.json") if tmp_path else None,
        )
    )
    return TestClient(create_app(hub))


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_ein_privater_gutschein_bleibt_dem_besitzer_des_hubs_verborgen():
    with make_client() as client:
        privat = client.post(
            "/api/family/vouchers",
            json={"shop": "Brack.ch", "total": 100, "shared": "privat"},
            headers=auth("t-livia"),
        ).json()
        client.post(
            "/api/family/vouchers",
            json={"shop": "Coop", "total": 50, "shared": "familie"},
            headers=auth("t-livia"),
        )
        # Einzelroute und Gesamtroute: Stefan sieht nur den geteilten.
        einzeln = client.get("/api/family/vouchers", headers=auth("t-owner")).json()
        assert [v["shop"] for v in einzeln] == ["Coop"]
        alles = client.get("/api/family", headers=auth("t-owner")).json()
        assert [v["shop"] for v in alles["vouchers"]] == ["Coop"]
        # Livia sieht beide.
        assert len(client.get("/api/family/vouchers", headers=auth("t-livia")).json()) == 2
        # Ändern und Löschen durch Stefan: nein.
        assert (
            client.put(
                f"/api/family/vouchers/{privat['id']}",
                json={"left": 0},
                headers=auth("t-owner"),
            ).status_code
            == 403
        )
        assert (
            client.delete(
                f"/api/family/vouchers/{privat['id']}", headers=auth("t-owner")
            ).status_code
            == 403
        )
        # Livia selbst darf.
        assert (
            client.put(
                f"/api/family/vouchers/{privat['id']}",
                json={"left": 20},
                headers=auth("t-livia"),
            ).json()["left"]
            == 20
        )


def test_der_papierkorb_verraet_keinen_privaten_gutschein():
    with make_client() as client:
        privat = client.post(
            "/api/family/vouchers",
            json={"shop": "Geheim", "total": 10, "shared": "privat"},
            headers=auth("t-livia"),
        ).json()
        client.delete(f"/api/family/vouchers/{privat['id']}", headers=auth("t-livia"))
        korb = client.get("/api/family-trash", headers=auth("t-owner")).json()["items"]
        assert korb == []
        korb = client.get("/api/family-trash", headers=auth("t-livia")).json()["items"]
        assert [row["item"]["shop"] for row in korb] == ["Geheim"]
        assert (
            client.post(
                f"/api/family-trash/vouchers/{privat['id']}/restore",
                headers=auth("t-owner"),
            ).status_code
            == 403
        )
        assert (
            client.post(
                f"/api/family-trash/vouchers/{privat['id']}/restore",
                headers=auth("t-livia"),
            ).status_code
            == 200
        )


def test_abziehen_ist_ein_put_und_der_hub_klemmt_nur():
    with make_client() as client:
        gutschein = client.post(
            "/api/family/vouchers",
            json={"shop": "Brack.ch", "unit": "CHF", "total": 100, "shared": "familie"},
            headers=auth("t-owner"),
        ).json()
        assert gutschein["unit"] == "chf"
        assert gutschein["left"] == 100
        assert gutschein["expires"] is None
        antwort = client.put(
            f"/api/family/vouchers/{gutschein['id']}",
            json={
                "left": 80,
                "transactions": [{"at": "2026-09-07T10:00:00", "amount": 20, "by": "Stefan"}],
            },
            headers=auth("t-owner"),
        ).json()
        assert antwort["left"] == 80 and len(antwort["transactions"]) == 1
        # Zu viel abgezogen: geklemmt, nicht abgelehnt.
        antwort = client.put(
            f"/api/family/vouchers/{gutschein['id']}",
            json={"left": -30},
            headers=auth("t-owner"),
        )
        assert antwort.status_code == 200 and antwort.json()["left"] == 0
        antwort = client.put(
            f"/api/family/vouchers/{gutschein['id']}",
            json={"left": 500, "shared": "quatsch"},
            headers=auth("t-owner"),
        ).json()
        assert antwort["left"] == 100 and antwort["shared"] == "familie"


def test_das_gutscheinfoto_wird_datei_und_folgt_der_privatsphaere(tmp_path):
    with make_client(tmp_path) as client:
        gutschein = client.post(
            "/api/family/vouchers",
            json={"shop": "Brack.ch", "total": 100, "shared": "privat", "image_url": WINZIG},
            headers=auth("t-livia"),
        ).json()
        assert gutschein["image_url"].startswith(
            f"/api/family/vouchers/{gutschein['id']}/bild?v="
        )
        assert (tmp_path / "gutscheinbilder" / f"{gutschein['id']}.png").exists()
        bild = client.get(gutschein["image_url"], headers=auth("t-livia"))
        assert bild.status_code == 200 and bild.content.startswith(b"\x89PNG")
        assert "immutable" in bild.headers["cache-control"]
        # Für Stefan gibt es das Bild nicht - auch nicht als 403, das
        # verriete, dass etwas da ist.
        assert client.get(gutschein["image_url"], headers=auth("t-owner")).status_code == 404
        # Löschen und Korb leeren nimmt das Bild mit.
        client.delete(f"/api/family/vouchers/{gutschein['id']}", headers=auth("t-livia"))
        assert (tmp_path / "gutscheinbilder" / f"{gutschein['id']}.png").exists()
        client.delete("/api/family-trash", headers=auth("t-livia"))
        assert not (tmp_path / "gutscheinbilder" / f"{gutschein['id']}.png").exists()


def test_die_gutscheindatei_wird_abgelegt_und_ausgeliefert(tmp_path):
    """Ein Gutschein kommt als PDF - das gehört an den Eintrag, nicht ins Postfach."""
    with make_client(tmp_path) as client:
        gutschein = client.post(
            "/api/family/vouchers",
            json={
                "shop": "Brack.ch",
                "total": 100,
                "shared": "privat",
                "file": {"data": PDF, "name": "Gutschein Brack.pdf"},
            },
            headers=auth("t-livia"),
        ).json()
        # Der Vertrag mit der App: genau diese vier Felder.
        assert set(gutschein["file"]) == {"url", "name", "type", "bytes"}
        assert gutschein["file"]["url"].startswith(
            f"/api/family/vouchers/{gutschein['id']}/datei?v="
        )
        assert gutschein["file"]["name"] == "Gutschein Brack.pdf"
        assert gutschein["file"]["type"] == "application/pdf"
        assert gutschein["file"]["bytes"] == len(PDF_ROH)
        assert (tmp_path / "gutscheindateien" / f"{gutschein['id']}.pdf").exists()

        antwort = client.get(gutschein["file"]["url"], headers=auth("t-livia"))
        assert antwort.status_code == 200
        assert antwort.content == PDF_ROH
        assert antwort.headers["content-type"].startswith("application/pdf")
        assert 'filename="Gutschein Brack.pdf"' in antwort.headers["content-disposition"]
        assert antwort.headers["content-disposition"].startswith("inline;")
        assert "immutable" in antwort.headers["cache-control"]

        # Ein unveränderter Block überlebt das Speichern - die App
        # schickt ihn beim Abziehen einfach mit zurück.
        nachher = client.put(
            f"/api/family/vouchers/{gutschein['id']}",
            json={"left": 80, "file": gutschein["file"]},
            headers=auth("t-livia"),
        ).json()
        assert nachher["file"] == gutschein["file"]
        assert (tmp_path / "gutscheindateien" / f"{gutschein['id']}.pdf").exists()


def test_die_datei_eines_fremden_privaten_gutscheins_gibt_es_nicht(tmp_path):
    """404 und nicht 403: Die Adresse selbst soll nichts verraten."""
    with make_client(tmp_path) as client:
        gutschein = client.post(
            "/api/family/vouchers",
            json={
                "shop": "Geheim",
                "total": 100,
                "shared": "privat",
                "file": {"data": PDF, "name": "Geheim.pdf"},
            },
            headers=auth("t-livia"),
        ).json()
        assert (
            client.get(gutschein["file"]["url"], headers=auth("t-owner")).status_code
            == 404
        )
        # Eine Liste ohne Dateiordner kennt keine Dateien.
        assert (
            client.get("/api/family/recipes/x/datei", headers=auth("t-owner")).status_code
            == 404
        )


def test_loeschen_und_korb_leeren_nehmen_die_datei_mit(tmp_path):
    with make_client(tmp_path) as client:
        gutschein = client.post(
            "/api/family/vouchers",
            json={"shop": "Brack.ch", "total": 100, "file": {"data": PDF, "name": "b.pdf"}},
            headers=auth("t-livia"),
        ).json()
        ablage = tmp_path / "gutscheindateien" / f"{gutschein['id']}.pdf"
        client.delete(f"/api/family/vouchers/{gutschein['id']}", headers=auth("t-livia"))
        # Im Papierkorb bleibt sie liegen: Zurückholen soll den Gutschein
        # samt PDF bringen.
        assert ablage.exists()
        client.delete("/api/family-trash", headers=auth("t-livia"))
        assert not ablage.exists()


def test_wer_den_anhang_wegnimmt_nimmt_ihn_ganz_weg(tmp_path):
    """Sonst bliebe das PDF unter seiner Adresse abrufbar, ohne am Gutschein zu stehen."""
    with make_client(tmp_path) as client:
        gutschein = client.post(
            "/api/family/vouchers",
            json={"shop": "Brack.ch", "total": 100, "file": {"data": PDF, "name": "b.pdf"}},
            headers=auth("t-livia"),
        ).json()
        adresse = gutschein["file"]["url"]
        ablage = tmp_path / "gutscheindateien" / f"{gutschein['id']}.pdf"
        nachher = client.put(
            f"/api/family/vouchers/{gutschein['id']}",
            json={"file": None},
            headers=auth("t-livia"),
        ).json()
        assert nachher["file"] is None
        assert not ablage.exists()
        assert client.get(adresse, headers=auth("t-livia")).status_code == 404


def test_eine_zu_grosse_datei_und_ein_verbotener_typ_werden_abgelehnt(tmp_path):
    """413 und 415 statt Klemmen - eine halbe Datei ist keine.

    Und der Gutschein entsteht gar nicht erst: Ein Eintrag ohne den
    Anhang, den man angehängt hat, sähe aus wie geglückt.
    """
    with make_client(tmp_path) as client:
        riesig = "data:application/pdf;base64," + base64.b64encode(
            b"x" * (dateien.MAX_BYTES + 1)
        ).decode()
        antwort = client.post(
            "/api/family/vouchers",
            json={"shop": "Brack.ch", "total": 100, "file": {"data": riesig}},
            headers=auth("t-livia"),
        )
        assert antwort.status_code == 413
        antwort = client.post(
            "/api/family/vouchers",
            json={
                "shop": "Brack.ch",
                "total": 100,
                "file": {"data": "data:text/html;base64,PHNjcmlwdD4=", "name": "x.html"},
            },
            headers=auth("t-livia"),
        )
        assert antwort.status_code == 415
        assert client.get("/api/family/vouchers", headers=auth("t-livia")).json() == []

        # Und beim Ändern bleibt der Gutschein, wie er war - die Prüfung
        # steht vor der ersten Änderung am Eintrag.
        gutschein = client.post(
            "/api/family/vouchers",
            json={"shop": "Brack.ch", "total": 100},
            headers=auth("t-livia"),
        ).json()
        antwort = client.put(
            f"/api/family/vouchers/{gutschein['id']}",
            json={"left": 20, "file": {"data": riesig, "name": "x.pdf"}},
            headers=auth("t-livia"),
        )
        assert antwort.status_code == 413
        unveraendert = client.get("/api/family/vouchers", headers=auth("t-livia")).json()
        assert unveraendert[0]["left"] == 100 and "file" not in unveraendert[0]


def test_ein_dateiname_mit_umbruch_bricht_die_auslieferung_nicht(tmp_path):
    """Der Name kommt aus einer Mail - er darf keine Kopfzeile anfangen."""
    with make_client(tmp_path) as client:
        gutschein = client.post(
            "/api/family/vouchers",
            json={
                "shop": "Brack.ch",
                "total": 100,
                "file": {"data": PDF, "name": 'a"\r\nX-Böse: ja\r\n\r\nboese.pdf'},
            },
            headers=auth("t-livia"),
        ).json()
        antwort = client.get(gutschein["file"]["url"], headers=auth("t-livia"))
        assert antwort.status_code == 200
        assert "x-böse" not in {k.lower() for k in antwort.headers}
        kopf = antwort.headers["content-disposition"]
        assert "\n" not in kopf and "\r" not in kopf
        assert kopf.count('"') == 2


def test_rezeptbilder_behalten_ihre_alte_adresse_und_die_neue_geht_auch(tmp_path):
    with make_client(tmp_path) as client:
        rezept = client.post(
            "/api/family/recipes",
            json={"text": "Lasagne", "image_url": WINZIG},
            headers=auth("t-owner"),
        ).json()
        assert rezept["image_url"].startswith(f"/api/recipes/{rezept['id']}/bild?v=")
        assert (tmp_path / "rezeptbilder" / f"{rezept['id']}.png").exists()
        neu = client.get(f"/api/family/recipes/{rezept['id']}/bild", headers=auth("t-owner"))
        assert neu.status_code == 200
        # Eine Liste ohne Bildordner kennt keine Bilder.
        assert client.get("/api/family/tasks/x/bild", headers=auth("t-owner")).status_code == 404


# ── Wächter ──────────────────────────────────────────────────────────────


async def wach(monkeypatch, jetzt: datetime, rows):
    """Ein Hub mit Gutscheinen und angehaltener Uhr."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}], users=USERS))
    await hub.start()
    hub.data.set(gutscheine.KEY, rows)

    class Uhr(datetime):
        @classmethod
        def now(cls, tz=None):
            return jetzt

    monkeypatch.setattr("homepilot.core.watchdog.datetime", Uhr)
    gesendet: list[tuple[str, str, str | None]] = []

    async def merken(title, body, category="outage", to=None, **_):
        gesendet.append((category, body, to))

    hub.watchdog._notify = merken  # type: ignore[method-assign]
    return hub, gesendet


@pytest.mark.asyncio
async def test_der_waechter_erinnert_je_gutschein_und_stufe_genau_einmal(monkeypatch):
    rows = [
        {"id": "b1", "author": "Livia", "shop": "Brack.ch", "unit": "chf", "total": 100,
         "left": 80, "expires": "2030-06-30", "shared": "privat"},
        {"id": "k1", "author": "Stefan", "shop": "Kinderparadies", "unit": "stk", "total": 1,
         "left": 1, "expires": "2030-06-05", "shared": "familie"},
    ]
    # Um sechs Uhr nichts.
    hub, gesendet = await wach(monkeypatch, datetime(2030, 6, 1, 6, 0), rows)
    try:
        await hub.watchdog._check_vouchers()
        assert gesendet == []
    finally:
        await hub.stop()

    hub, gesendet = await wach(monkeypatch, datetime(2030, 6, 1, 9, 0), rows)
    try:
        await hub.watchdog._check_vouchers()
        assert sorted(gesendet) == [
            ("vouchers", "Brack.ch: 80 CHF verfallen in 29 Tagen (30.06.2030)", "Livia"),
            ("vouchers", "Kinderparadies: 1 Stück verfällt in 4 Tagen (05.06.2030)", None),
        ]
        # Die nächste Runde derselben Stunde bringt nichts Neues.
        await hub.watchdog._check_vouchers()
        assert len(gesendet) == 2
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_die_sieben_tage_stufe_kommt_nach_der_dreissiger(monkeypatch):
    rows = [
        {"id": "b1", "author": "Livia", "shop": "Brack.ch", "unit": "chf", "total": 100,
         "left": 80, "expires": "2030-06-30", "shared": "familie"},
    ]
    hub, gesendet = await wach(monkeypatch, datetime(2030, 6, 1, 9, 0), rows)
    try:
        await hub.watchdog._check_vouchers()
        assert len(gesendet) == 1
        gemerkt = hub.data.get("notified")
        # Dreissig-Tage-Stufe ist raus - 20 Tage später schweigt er noch,
        # bei sieben Tagen meldet er ein zweites Mal.
        hub.data.set("notified", gemerkt)
    finally:
        await hub.stop()

    hub, gesendet = await wach(monkeypatch, datetime(2030, 6, 21, 9, 0), rows)
    try:
        hub.data.set("notified", gemerkt)
        await hub.watchdog._check_vouchers()
        assert gesendet == []
        gemerkt = hub.data.get("notified")
    finally:
        await hub.stop()

    hub, gesendet = await wach(monkeypatch, datetime(2030, 6, 24, 9, 0), rows)
    try:
        hub.data.set("notified", gemerkt)
        await hub.watchdog._check_vouchers()
        assert [body for _, body, _ in gesendet] == [
            "Brack.ch: 80 CHF verfallen in 6 Tagen (30.06.2030)"
        ]
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_ein_aufgebrauchter_gutschein_darf_still_verfallen(monkeypatch):
    rows = [
        {"id": "b1", "author": "Livia", "shop": "Brack.ch", "unit": "chf", "total": 100,
         "left": 0, "expires": "2030-06-05", "shared": "familie"},
    ]
    hub, gesendet = await wach(monkeypatch, datetime(2030, 6, 1, 9, 0), rows)
    try:
        await hub.watchdog._check_vouchers()
        assert gesendet == []
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_was_aus_dem_korb_faellt_nimmt_sein_bild_mit(monkeypatch, tmp_path):
    """Vorher blieben die Fotos für immer liegen - ein Gutscheinfoto mit
    Nummer und Strichcode soll nicht länger auf der Platte sein als der
    Eintrag, zu dem es gehört."""
    from homepilot.core import trash

    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            data_file=str(tmp_path / "hub.json"),
        )
    )
    await hub.start()
    try:
        ordner = tmp_path / "gutscheinbilder"
        ordner.mkdir()
        (ordner / "alt.png").write_bytes(b"x")
        (ordner / "frisch.png").write_bytes(b"x")
        jetzt = datetime(2030, 6, 1, 4, 0)
        korb = [
            {"kind": "vouchers", "at": jetzt.timestamp() - trash.KEEP_SECONDS - 1,
             "by": "Livia", "name": "alt", "item": {"id": "alt"}},
            {"kind": "vouchers", "at": jetzt.timestamp() - 60,
             "by": "Livia", "name": "frisch", "item": {"id": "frisch"}},
        ]
        hub.data.set("family_trash", korb)

        class Uhr(datetime):
            @classmethod
            def now(cls, tz=None):
                return jetzt

        monkeypatch.setattr("homepilot.core.watchdog.datetime", Uhr)
        monkeypatch.setattr("homepilot.core.trash.time.time", lambda: jetzt.timestamp())
        await hub.watchdog._check_family_cleanup()
        assert not (ordner / "alt.png").exists()
        assert (ordner / "frisch.png").exists()
        assert [row["name"] for row in hub.data.get("family_trash")] == ["frisch"]
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_was_aus_dem_korb_faellt_nimmt_auch_seine_datei_mit(monkeypatch, tmp_path):
    """Das PDF ist der Gutschein - es darf nicht länger liegen als der Eintrag."""
    from homepilot.core import trash

    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            data_file=str(tmp_path / "hub.json"),
        )
    )
    await hub.start()
    try:
        ordner = tmp_path / "gutscheindateien"
        ordner.mkdir()
        (ordner / "alt.pdf").write_bytes(PDF_ROH)
        (ordner / "frisch.pdf").write_bytes(PDF_ROH)
        jetzt = datetime(2030, 6, 1, 4, 0)
        hub.data.set(
            "family_trash",
            [
                {"kind": "vouchers", "at": jetzt.timestamp() - trash.KEEP_SECONDS - 1,
                 "by": "Livia", "name": "alt", "item": {"id": "alt"}},
                {"kind": "vouchers", "at": jetzt.timestamp() - 60,
                 "by": "Livia", "name": "frisch", "item": {"id": "frisch"}},
            ],
        )

        class Uhr(datetime):
            @classmethod
            def now(cls, tz=None):
                return jetzt

        monkeypatch.setattr("homepilot.core.watchdog.datetime", Uhr)
        monkeypatch.setattr("homepilot.core.trash.time.time", lambda: jetzt.timestamp())
        await hub.watchdog._check_family_cleanup()
        assert not (ordner / "alt.pdf").exists()
        assert (ordner / "frisch.pdf").exists()
    finally:
        await hub.stop()


def test_die_erinnerungsstufen_haben_eine_route():
    with make_client() as client:
        assert client.get("/api/push/vouchers", headers=auth("t-livia")).json() == {
            "first_days": 30,
            "second_days": 7,
        }
        # Teil-Body: nur die erste Stufe ändern.
        antwort = client.put(
            "/api/push/vouchers", json={"first_days": 60}, headers=auth("t-owner")
        )
        assert antwort.status_code == 200
        assert antwort.json() == {"ok": True, "first_days": 60, "second_days": 7}
        # Und sie überlebt den Weg durch den DataStore - das Batterie-
        # Muster tat das nicht (Dict → Liste der Schlüssel).
        assert client.get("/api/push/vouchers", headers=auth("t-owner")).json() == {
            "first_days": 60,
            "second_days": 7,
        }
        # Vertauscht: getauscht, geklemmt.
        antwort = client.put(
            "/api/push/vouchers",
            json={"first_days": 3, "second_days": 400},
            headers=auth("t-owner"),
        ).json()
        assert antwort == {"ok": True, "first_days": 365, "second_days": 3}


def test_die_stufen_darf_nur_setzen_wer_die_konfiguration_bearbeitet():
    with make_client() as client:
        # Bewohnerin ohne EDIT_CONFIG: nein.
        assert (
            client.put(
                "/api/push/vouchers", json={"first_days": 60}, headers=auth("t-livia")
            ).status_code
            == 403
        )


@pytest.mark.asyncio
async def test_drei_stufen_je_gutschein_jede_genau_einmal(monkeypatch):
    rows = [
        {"id": "b1", "author": "Livia", "shop": "Brack.ch", "unit": "chf", "total": 100,
         "left": 80, "expires": "2030-06-30", "shared": "familie"},
    ]
    gemerkt: list = []
    texte: list[str] = []
    # Ein Tag nach dem anderen, 40 Tage lang - jede Runde mit dem
    # Gedächtnis der vorigen.
    from datetime import timedelta

    for tag in range(0, 41):
        jetzt = datetime(2030, 5, 21, 9, 0) + timedelta(days=tag)
        hub, gesendet = await wach(monkeypatch, jetzt, rows)
        try:
            hub.data.set("notified", gemerkt)
            await hub.watchdog._check_vouchers()
            await hub.watchdog._check_vouchers()  # zweite Runde derselben Stunde
            texte.extend(body for _, body, _ in gesendet)
            gemerkt = hub.data.get("notified")
        finally:
            await hub.stop()
    assert texte == [
        "Brack.ch: 80 CHF verfallen in 30 Tagen (30.06.2030)",
        "Brack.ch: 80 CHF verfallen in 7 Tagen (30.06.2030)",
        "Brack.ch: 80 CHF verfallen heute (30.06.2030)",
    ]


@pytest.mark.asyncio
async def test_umgestellte_stufen_holen_nichts_nach(monkeypatch):
    """Wer die erste Erinnerung von 30 auf 45 Tage stellt, hat sie für
    die laufenden Gutscheine schon bekommen."""
    rows = [
        {"id": "b1", "author": "Livia", "shop": "Brack.ch", "unit": "chf", "total": 100,
         "left": 80, "expires": "2030-06-30", "shared": "familie"},
    ]
    hub, gesendet = await wach(monkeypatch, datetime(2030, 6, 1, 9, 0), rows)
    try:
        await hub.watchdog._check_vouchers()
        assert len(gesendet) == 1
        gemerkt = hub.data.get("notified")
    finally:
        await hub.stop()

    hub, gesendet = await wach(monkeypatch, datetime(2030, 6, 2, 9, 0), rows)
    try:
        hub.data.set("notified", gemerkt)
        hub.data.set(gutscheine.PREFS_KEY, [{"first_days": 45, "second_days": 14}])
        await hub.watchdog._check_vouchers()
        assert gesendet == []
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_frisch_eingetragen_am_ablauftag_kommt_nur_die_tagesmeldung(monkeypatch):
    rows = [
        {"id": "b1", "author": "Livia", "shop": "Brack.ch", "unit": "chf", "total": 100,
         "left": 80, "expires": "2030-06-30", "shared": "familie"},
    ]
    hub, gesendet = await wach(monkeypatch, datetime(2030, 6, 30, 9, 0), rows)
    try:
        await hub.watchdog._check_vouchers()
        assert [body for _, body, _ in gesendet] == [
            "Brack.ch: 80 CHF verfallen heute (30.06.2030)"
        ]
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_abgeschaltete_regel_erinnert_gar_nicht(monkeypatch):
    """Der Schalter in «Abläufe → Push» gilt fürs ganze Haus.

    Bisher liess sich die Gutschein-Erinnerung nur je Person abbestellen
    - als einzige der Familien-Nachrichten hatte sie keine Regel, an der
    ein Schalter hängen könnte. Jetzt hat sie eine, und der Wächter
    fragt sie, bevor er den Kalender überhaupt anschaut.
    """
    rows = [
        {"id": "b1", "author": "Livia", "shop": "Brack.ch", "unit": "chf", "total": 100,
         "left": 80, "expires": "2030-06-30", "shared": "familie"},
    ]
    hub, gesendet = await wach(monkeypatch, datetime(2030, 6, 1, 9, 0), rows)
    try:
        hub.watchdog.rules["vouchers"]["enabled"] = False
        await hub.watchdog._check_vouchers()
        assert gesendet == []
        # Und eingeschaltet meldet er wieder - sonst prüfte der Test nur,
        # dass irgendetwas den Weg versperrt.
        hub.watchdog.rules["vouchers"]["enabled"] = True
        await hub.watchdog._check_vouchers()
        assert len(gesendet) == 1
    finally:
        await hub.stop()


# ── Karte mitbringen (Punkt 267 der Werkbank) ───────────────────────────


def test_ein_gutschein_ohne_angabe_verlangt_die_karte_nicht():
    """Alte Einträge bleiben, wie sie waren - und bekommen ein ehrliches False.

    Nummer und PIN stehen in der App; dass ein Laden trotzdem das
    Original sehen will, ist die Ausnahme. Wer nichts angetippt hat, hat
    damit nichts behauptet.
    """
    assert gutscheine.bereinigen({"total": 10})["physical"] is False
    assert gutscheine.bereinigen({"total": 10, "physical": True})["physical"] is True
    # Was aus einem Formular kommt, ist ein Wahrheitswert - nicht der
    # Text «false», der als nichtleerer String sonst wahr wäre.
    assert gutscheine.bereinigen({"physical": ""})["physical"] is False
    assert gutscheine.bereinigen({"physical": "ja"})["physical"] is True


def test_das_buch_druckt_die_karte_als_satz_und_das_gegenteil_gar_nicht():
    """Auf der gedruckten Seite steht kein «physical False».

    Das Familienbuch schreibt jedes Feld hin, wie es heisst. Ein
    Wahrheitswert liest sich dort wie ein Fehler; gebraucht wird der
    Hinweis nur in der einen Richtung.
    """
    rows = [
        {"id": "a", "shop": "Brack.ch", "shared": "familie", "physical": True},
        {"id": "b", "shop": "Zalando", "shared": "familie", "physical": False},
    ]
    buch = gutscheine.fuers_buch(rows)
    assert "physical" not in buch[0] and "physical" not in buch[1]
    assert buch[0]["mitbringen"] == "Karte, Bon oder Ausdruck nötig"
    assert "mitbringen" not in buch[1]
