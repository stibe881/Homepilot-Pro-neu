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
    {"name": "Sandra", "role": "bewohner", "token": "t-sandra"},
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
        # Livia selbst darf - über eine Buchung (Punkt 371 der Werkbank);
        # ein blosses «left» ohne Verlauf bewegt seit dieser Absicherung
        # nichts mehr.
        assert (
            client.put(
                f"/api/family/vouchers/{privat['id']}",
                json={
                    "transactions": [
                        {"at": "2026-09-07T10:00:00", "amount": 80, "by": "Livia"}
                    ]
                },
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


def test_abziehen_ist_ein_put_und_der_hub_rechnet_den_rest_aus_dem_verlauf():
    """Punkt 371 der Werkbank: `left` folgt dem Verlauf, nicht dem, was
    die App im selben PUT mitschickt - sonst überschreibt ein zweites
    Telefon still den Abzug des ersten (siehe transaktionen_zusammenfuehren
    in core/gutscheine.py). Ein blosses «left» ohne passende Buchung
    bewegt seither nichts mehr."""
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
                "left": 999,  # wird ignoriert - massgeblich ist die Buchung
                "transactions": [{"at": "2026-09-07T10:00:00", "amount": 20, "by": "Stefan"}],
            },
            headers=auth("t-owner"),
        ).json()
        assert antwort["left"] == 80 and len(antwort["transactions"]) == 1
        # Zu viel abgezogen: geklemmt, nicht abgelehnt.
        antwort = client.put(
            f"/api/family/vouchers/{gutschein['id']}",
            json={
                "transactions": antwort["transactions"]
                + [{"at": "2026-09-07T11:00:00", "amount": 500, "by": "Stefan"}]
            },
            headers=auth("t-owner"),
        )
        assert antwort.status_code == 200 and antwort.json()["left"] == 0
        # Aufgebraucht heisst automatisch archiviert (Punkt 372).
        assert antwort.json()["archived"] is True
        antwort = client.put(
            f"/api/family/vouchers/{gutschein['id']}",
            json={"left": 500, "shared": "quatsch"},
            headers=auth("t-owner"),
        ).json()
        assert antwort["left"] == 0 and antwort["shared"] == "familie"


def test_zwei_geraete_ziehen_gleichzeitig_ab_beide_buchungen_bleiben():
    """Punkt 371: Zwei Telefone kennen beide nur ihren eigenen Verlauf -
    keines darf die Buchung des anderen wortlos überschreiben."""
    with make_client() as client:
        gutschein = client.post(
            "/api/family/vouchers",
            json={"shop": "Brack.ch", "total": 100, "shared": "familie"},
            headers=auth("t-owner"),
        ).json()
        # Handy A sieht den frischen Gutschein und bucht 30 ab.
        a = client.put(
            f"/api/family/vouchers/{gutschein['id']}",
            json={
                "transactions": [{"at": "2026-09-07T10:00:00", "amount": 30, "by": "Stefan"}]
            },
            headers=auth("t-owner"),
        ).json()
        assert a["left"] == 70
        # Handy B hatte den Gutschein VORHER geladen (kennt A's Buchung
        # nicht) und bucht unabhängig 20 ab - sein PUT trägt nur die
        # eigene Buchung, nicht die von A.
        b = client.put(
            f"/api/family/vouchers/{gutschein['id']}",
            json={
                "transactions": [{"at": "2026-09-07T10:05:00", "amount": 20, "by": "Livia"}]
            },
            headers=auth("t-owner"),
        ).json()
        # Beide Buchungen stehen im Verlauf, und der Rest ist 100-30-20=50 -
        # nicht 80 (wie bei einem blossen Ersetzen, das A's Buchung verlöre).
        assert b["left"] == 50
        assert {t["by"] for t in b["transactions"]} == {"Stefan", "Livia"}


def test_derselbe_storno_zweimal_geschickt_wird_nur_einmal_gutgeschrieben():
    """Zwei Telefone, die dieselbe Buchung im selben Moment zurücknehmen,
    sollen den Betrag nicht doppelt gutschreiben."""
    with make_client() as client:
        gutschein = client.post(
            "/api/family/vouchers",
            json={"shop": "Brack.ch", "total": 100, "shared": "familie"},
            headers=auth("t-owner"),
        ).json()
        abzug = client.put(
            f"/api/family/vouchers/{gutschein['id']}",
            json={
                "transactions": [{"at": "2026-09-07T10:00:00", "amount": 40, "by": "Stefan"}]
            },
            headers=auth("t-owner"),
        ).json()
        assert abzug["left"] == 60
        ziel = "2026-09-07T10:00:00"
        # Zwei verschiedene Geräte, jedes mit eigenem Zeitstempel, nehmen
        # unabhängig voneinander denselben Abzug zurück.
        storno_a = {
            "at": "2026-09-07T11:00:00",
            "amount": -40,
            "by": "Stefan",
            "art": "storno",
            "storniert": ziel,
        }
        storno_b = {
            "at": "2026-09-07T11:00:05",
            "amount": -40,
            "by": "Livia",
            "art": "storno",
            "storniert": ziel,
        }
        erste = client.put(
            f"/api/family/vouchers/{gutschein['id']}",
            json={"transactions": abzug["transactions"] + [storno_a]},
            headers=auth("t-owner"),
        ).json()
        assert erste["left"] == 100
        zweite = client.put(
            f"/api/family/vouchers/{gutschein['id']}",
            json={"transactions": abzug["transactions"] + [storno_b]},
            headers=auth("t-owner"),
        ).json()
        assert zweite["left"] == 100
        assert len(zweite["transactions"]) == 2


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
async def test_der_waechter_meldet_den_tag_nach_dem_verfall_und_archiviert(monkeypatch):
    """Punkt 372 der Werkbank: die letzte Meldung, dann ins Archiv."""
    rows = [
        {"id": "b1", "author": "Livia", "shop": "Brack.ch", "unit": "chf", "total": 100,
         "left": 30, "expires": "2030-06-05", "shared": "privat"},
    ]
    # Am Ablauftag selbst: nur die reguläre Stufe (Ablauftag-Erinnerung),
    # noch kein «verfallen» - dafür ist es erst einen Tag zu früh.
    hub, gesendet = await wach(monkeypatch, datetime(2030, 6, 5, 9, 0), rows)
    try:
        await hub.watchdog._check_vouchers()
        assert [body for _, body, _ in gesendet] == [
            "Brack.ch: 30 CHF verfallen heute (05.06.2030)"
        ]
        assert hub.data.get(gutscheine.KEY)[0].get("archived") is not True
        gemerkt = hub.data.get("notified")
    finally:
        await hub.stop()

    hub, gesendet = await wach(monkeypatch, datetime(2030, 6, 6, 9, 0), rows)
    try:
        hub.data.set("notified", gemerkt)
        await hub.watchdog._check_vouchers()
        assert gesendet == [
            ("vouchers", "Brack.ch: 30 CHF sind verfallen und weg.", "Livia")
        ]
        assert hub.data.get(gutscheine.KEY)[0]["archived"] is True
        gemerkt = hub.data.get("notified")
    finally:
        await hub.stop()

    # Ein zweiter Lauf am Folgetag meldet nichts mehr - der Gutschein
    # ist jetzt archiviert (dieselben Objekte wurden oben in place
    # verändert, wie es der Wächter auch am echten hub.data täte).
    assert rows[0]["archived"] is True
    hub, gesendet = await wach(monkeypatch, datetime(2030, 6, 7, 9, 0), rows)
    try:
        hub.data.set("notified", gemerkt)
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


def test_rest_aus_transaktionen_zaehlt_abzug_und_storno_nicht_die_uebergabe():
    tx = [
        {"amount": 30, "art": "abzug"},
        {"amount": -10, "art": "storno"},  # Gegenbuchung: gibt 10 zurück
        {"amount": 0, "art": "uebergabe"},
    ]
    assert gutscheine.rest_aus_transaktionen(100, tx, False) == 80
    # Geklemmt bei 0 und beim Gesamtwert.
    assert gutscheine.rest_aus_transaktionen(100, [{"amount": 500}], False) == 0
    assert gutscheine.rest_aus_transaktionen(100, [{"amount": -500, "art": "storno"}], False) == 100


def test_transaktionen_zusammenfuehren_haengt_nur_unbekannte_an():
    bisherige = [{"at": "10:00", "amount": 20, "art": "abzug"}]
    neue = [
        {"at": "10:00", "amount": 20, "art": "abzug"},  # schon bekannt
        {"at": "10:05", "amount": 15, "art": "abzug"},  # neu
    ]
    ergebnis = gutscheine.transaktionen_zusammenfuehren(bisherige, neue)
    assert [t["at"] for t in ergebnis] == ["10:00", "10:05"]


def test_transaktionen_zusammenfuehren_verschluckt_den_doppelten_storno():
    bisherige = [
        {"at": "10:00", "amount": 20, "art": "abzug"},
        {"at": "10:05", "amount": -20, "art": "storno", "storniert": "10:00"},
    ]
    # Ein zweites Gerät nimmt dieselbe Buchung mit anderem Zeitstempel
    # ebenfalls zurück - das darf nicht ein zweites Mal gutschreiben.
    neue = bisherige + [{"at": "10:06", "amount": -20, "art": "storno", "storniert": "10:00"}]
    ergebnis = gutscheine.transaktionen_zusammenfuehren(bisherige, neue)
    assert len(ergebnis) == 2


def test_frisch_verfallen_nur_mit_restwert_und_noch_nicht_archiviert():
    heute = date(2030, 6, 5)
    rows = [
        {"id": "a", "left": 50, "expires": "2030-06-01"},  # verfallen, hat noch was
        {"id": "b", "left": 0, "expires": "2030-06-01"},  # aufgebraucht - egal
        {"id": "c", "left": 50, "expires": "2030-06-01", "archived": True},  # schon erledigt
        {"id": "d", "left": 50, "expires": "2030-06-30"},  # noch nicht verfallen
        {"id": "e", "left": 50, "expires": None},  # unbegrenzt
    ]
    treffer = [row["id"] for row in gutscheine.frisch_verfallen(rows, heute)]
    assert treffer == ["a"]


def test_verfalls_meldung_nennt_laden_und_betrag():
    titel, text = gutscheine.verfalls_meldung({"shop": "Brack.ch", "left": 80})
    assert titel == "Gutschein verfallen"
    assert text == "Brack.ch: 80 CHF sind verfallen und weg."


def test_verfallen_zeitraum_zaehlt_nur_innerhalb_der_grenzen_und_ohne_stueck():
    rows = [
        {"shop": "A", "unit": "chf", "left": 30, "expires": "2030-06-15"},  # im Monat
        {"shop": "B", "unit": "chf", "left": 20, "expires": "2030-05-31"},  # davor
        {"shop": "C", "unit": "chf", "left": 0, "expires": "2030-06-10"},  # leer
        {"shop": "D", "unit": "stk", "left": 2, "expires": "2030-06-10"},  # kein Betrag
    ]
    ergebnis = gutscheine.verfallen_zeitraum(rows, date(2030, 6, 1), date(2030, 6, 30))
    assert ergebnis == {"summe": 30, "anzahl": 1}


def test_aufgebraucht_kennt_rappenreste_als_leer():
    assert gutscheine.aufgebraucht({"left": 0}) is True
    assert gutscheine.aufgebraucht({"left": 0.004}) is True
    assert gutscheine.aufgebraucht({"left": 0.01}) is False


# ── Übergabe mit Annahme (Punkt 377) ───────────────────────────────────────


def test_uebergabe_vorschlagen_aendert_den_besitzer_noch_nicht():
    entry = {"id": "v1", "author": "Stefan", "shop": "Brack.ch", "transactions": []}
    neu = gutscheine.uebergabe_vorschlagen(entry, "Livia", "Stefan", datetime(2026, 1, 1))
    assert neu["author"] == "Stefan"  # unverändert
    assert neu["pending_transfer_to"] == "Livia"
    assert neu["transactions"][-1]["art"] == "uebergabe_vorschlag"
    # Ein leerer Name schlägt nichts vor.
    assert gutscheine.uebergabe_vorschlagen(entry, "  ", "Stefan", datetime(2026, 1, 1)) is entry


def test_uebergabe_annehmen_nur_durch_die_eingeladene_person():
    entry = {
        "id": "v1", "author": "Stefan", "shop": "Brack.ch",
        "pending_transfer_to": "Livia", "transactions": [],
    }
    neu, fehler = gutscheine.uebergabe_annehmen(entry, "Sandra", datetime(2026, 1, 2))
    assert neu is None and fehler is not None
    neu, fehler = gutscheine.uebergabe_annehmen(entry, "Livia", datetime(2026, 1, 2))
    assert fehler is None
    assert neu["author"] == "Livia"
    assert neu["pending_transfer_to"] is None
    assert neu["transactions"][-1] == {
        "at": datetime(2026, 1, 2).isoformat(),
        "amount": 0,
        "by": "Livia",
        "art": "uebergabe",
        "note": "angenommen",
    }


def test_uebergabe_ablehnen_durch_absender_oder_empfaenger():
    entry = {
        "id": "v1", "author": "Stefan", "shop": "Brack.ch",
        "pending_transfer_to": "Livia", "transactions": [],
    }
    neu, fehler = gutscheine.uebergabe_ablehnen(entry, "Sandra", datetime(2026, 1, 2))
    assert neu is None and fehler is not None
    neu, _ = gutscheine.uebergabe_ablehnen(dict(entry), "Livia", datetime(2026, 1, 2))
    assert neu["pending_transfer_to"] is None and neu["author"] == "Stefan"
    neu, _ = gutscheine.uebergabe_ablehnen(dict(entry), "Stefan", datetime(2026, 1, 2))
    assert neu["pending_transfer_to"] is None


def test_ohne_vorgeschlagene_uebergabe_geht_weder_annehmen_noch_ablehnen():
    entry = {"id": "v1", "author": "Stefan", "shop": "Brack.ch"}
    assert gutscheine.uebergabe_annehmen(entry, "Livia", datetime(2026, 1, 1))[1] is not None
    assert gutscheine.uebergabe_ablehnen(entry, "Livia", datetime(2026, 1, 1))[1] is not None


def test_eingehende_uebergaben_nennt_nur_das_noetigste():
    rows = [
        {"id": "v1", "shop": "Brack.ch", "left": 40, "unit": "chf", "author": "Stefan",
         "pending_transfer_to": "Livia", "pin": "9999", "number": "geheim"},
        {"id": "v2", "shop": "Coop", "pending_transfer_to": "Sandra"},
        {"id": "v3", "shop": "Zalando"},  # keine Übergabe
    ]
    treffer = gutscheine.eingehende_uebergaben(rows, "Livia")
    assert treffer == [{"id": "v1", "shop": "Brack.ch", "left": 40, "unit": "chf", "by": "Stefan"}]
    assert "pin" not in treffer[0] and "number" not in treffer[0]


def test_die_route_fuer_eine_uebergabe_mit_annahme():
    with make_client() as client:
        gutschein = client.post(
            "/api/family/vouchers",
            json={"shop": "Brack.ch", "total": 100, "shared": "privat"},
            headers=auth("t-owner"),
        ).json()
        # Stefan schlägt Livia vor.
        vorgeschlagen = client.put(
            f"/api/family/vouchers/{gutschein['id']}",
            json={"pending_transfer_to": "Livia"},
            headers=auth("t-owner"),
        ).json()
        assert vorgeschlagen["author"] == "Stefan"
        # Livia sieht ihn nicht in der vollen Liste (noch fremd, privat) …
        assert client.get("/api/family/vouchers", headers=auth("t-livia")).json() == []
        # … aber im schmalen Eingangs-Auszug.
        eingehend = client.get("/api/family/vouchers/eingehend", headers=auth("t-livia")).json()
        assert eingehend == [{"id": gutschein["id"], "shop": "Brack.ch", "left": 100.0, "unit": "chf", "by": "Stefan"}]
        # Sandra darf nicht annehmen - der Vorschlag war nicht an sie.
        assert (
            client.post(
                f"/api/family/vouchers/{gutschein['id']}/annehmen", headers=auth("t-sandra")
            ).status_code
            == 403
        )
        angenommen = client.post(
            f"/api/family/vouchers/{gutschein['id']}/annehmen", headers=auth("t-livia")
        ).json()
        assert angenommen["author"] == "Livia"
        assert angenommen["pending_transfer_to"] is None
        # Jetzt gehört er Livia - Stefan sieht ihn nicht mehr in seiner Liste.
        assert client.get("/api/family/vouchers", headers=auth("t-owner")).json() == []
        assert len(client.get("/api/family/vouchers", headers=auth("t-livia")).json()) == 1


def test_die_route_fuer_eine_abgelehnte_uebergabe():
    with make_client() as client:
        gutschein = client.post(
            "/api/family/vouchers",
            json={"shop": "Brack.ch", "total": 100, "shared": "privat"},
            headers=auth("t-owner"),
        ).json()
        client.put(
            f"/api/family/vouchers/{gutschein['id']}",
            json={"pending_transfer_to": "Livia"},
            headers=auth("t-owner"),
        )
        abgelehnt = client.post(
            f"/api/family/vouchers/{gutschein['id']}/ablehnen", headers=auth("t-livia")
        ).json()
        assert abgelehnt["author"] == "Stefan" and abgelehnt["pending_transfer_to"] is None
        assert client.get("/api/family/vouchers/eingehend", headers=auth("t-livia")).json() == []


# ── Der Code auf der Karte (Punkt 420 der Werkbank) ─────────────────────


def test_der_hub_haelt_nur_die_beiden_bekannten_codearten_fest():
    assert gutscheine.bereinigen({"code": "qr"})["code"] == "qr"
    assert gutscheine.bereinigen({"code": "STRICH"})["code"] == "strich"


def test_eine_fehlende_codeart_wird_nicht_erfunden():
    """Ohne Angabe bleibt das Feld weg - und die App rechnet es aus.

    Anders als bei `unit` und `shared` wäre ein eingesetztes «strich»
    eine Behauptung über eine Karte, die niemand angesehen hat. Es
    stünde dann einem QR-Code im Weg, den die App am Inhalt der Nummer
    längst erkannt hätte - etwa bei einer Adresse, die als Strichcode
    ohnehin unlesbar wäre.
    """
    assert "code" not in gutscheine.bereinigen({"total": 10})
    assert "code" not in gutscheine.bereinigen({"code": "aztec"})
    assert "code" not in gutscheine.bereinigen({"code": ""})
    assert "code" not in gutscheine.bereinigen({"code": None})


def test_das_buch_druckt_die_codeart_nicht():
    """Auf Papier hilft sie niemandem - einen Scanner hat man da nicht."""
    rows = [{"id": "a", "shop": "Brack.ch", "shared": "familie", "code": "qr", "number": "574"}]
    buch = gutscheine.fuers_buch(rows)
    assert "code" not in buch[0] and buch[0]["number"] == "574"
