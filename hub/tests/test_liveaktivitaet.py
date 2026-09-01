"""Die Haustür-Live-Aktivität: starten im Anmarsch, beenden beim Kommen."""

from homepilot.core.liveaktivitaet import (
    abmelden,
    aktivitaet_merken,
    apns_jwt,
    end_payload,
    karte_faellig,
    kartenstand,
    parse_apns,
    registrieren,
    start_payload,
    token_tot,
    vermerk,
    war_weit,
    wechsel,
    weit_merken,
    weit_weg,
)


def test_parse_apns_ist_alles_oder_nichts():
    """Ein halber Block sähe beim Start gesund aus und fiele erst beim
    ersten Versand um - lieber gleich aus, mit einer Zeile im Protokoll."""
    voll = {
        "key_file": "apns.p8",
        "key_id": "ABC123",
        "team_id": "DEF456",
        "bundle_id": "me.stibe.homepilot",
    }
    gelesen = parse_apns(voll)
    assert gelesen is not None
    assert gelesen["bundle_id"] == "me.stibe.homepilot"
    assert parse_apns({**voll, "team_id": ""}) is None
    assert parse_apns({}) is None
    assert parse_apns(None) is None


def test_registrieren_ersetzt_dasselbe_telefon():
    rows = registrieren([], "Stibe", "token-a", "iPhone")
    rows = registrieren(rows, "Stibe", "token-a", "iPhone")
    assert len(rows) == 1
    rows = registrieren(rows, "Bine", "token-b")
    assert len(rows) == 2
    assert abmelden(rows, "token-a") == [rows[1]]


def test_ein_neues_token_ersetzt_dasselbe_telefon():
    """Der Fall vom Sperrbildschirm: fünf gleiche Karten übereinander.

    Apple stellt das «push-to-start»-Token immer wieder neu aus - nach
    jeder Neuinstallation, nach jedem Update. Nach Token abgelegt blieb
    die alte Zeile stehen, jede trug ihr eigenes «unterwegs», und beim
    nächsten Weggehen bekam dasselbe Telefon einen Start-Push je Zeile.
    """
    rows = registrieren([], "Stibe", "token-alt", "Stibes iPhone")
    rows = registrieren(rows, "Stibe", "token-neu", "Stibes iPhone")
    assert [row["start_token"] for row in rows] == ["token-neu"]

    # Ein zweites Telefon derselben Person bleibt ein zweites.
    rows = registrieren(rows, "Stibe", "token-pad", "iPad")
    assert len(rows) == 2
    # Und das Telefon einer anderen Person erst recht.
    rows = registrieren(rows, "Bine", "token-b", "Bines iPhone")
    assert len(rows) == 3


def test_ohne_geraetenamen_bleibt_es_beim_token():
    """Eine alte App-Fassung schickt keinen Namen mit. Dann lieber eine
    Zeile zu viel als die eines fremden Geräts überschrieben."""
    rows = registrieren([], "Stibe", "token-a")
    rows = registrieren(rows, "Stibe", "token-b")
    assert len(rows) == 2


def test_nur_eine_endgueltige_absage_traegt_ein_telefon_aus():
    """Ein Token, das es nicht mehr gibt, wird auch morgen keines mehr
    sein. Alles andere - überlastet, kaputte Verbindung - ist ein
    Problem von jetzt und darf kein Telefon austragen."""
    assert token_tot(410, "{}") is True
    assert token_tot(400, '{"reason":"BadDeviceToken"}') is True
    assert token_tot(400, '{"reason":"BadCollapseId"}') is False
    assert token_tot(429, "TooManyRequests") is False
    assert token_tot(200, "") is False


def test_wechsel_startet_beim_gehen_und_beendet_beim_kommen():
    rows = registrieren([], "Stibe", "token-a", "iPhone")

    # Weg: einmal starten - und beim nächsten Takt nicht noch einmal.
    rows, starten, beenden = wechsel(rows, {"Stibe": True})
    assert [r["start_token"] for r in starten] == ["token-a"]
    assert beenden == []
    rows, starten, beenden = wechsel(rows, {"Stibe": True})
    assert starten == [] and beenden == []

    # Die App meldet das Token der laufenden Aktivität nach.
    rows = aktivitaet_merken(rows, "Stibe", "activity-1")
    assert rows[0]["activity_token"] == "activity-1"

    # Heimgekommen: genau ein Ende, danach Ruhe.
    rows, starten, beenden = wechsel(rows, {"Stibe": False})
    assert [r["activity_token"] for r in beenden] == ["activity-1"]
    assert rows[0]["unterwegs"] is False
    assert rows[0]["activity_token"] is None
    rows, starten, beenden = wechsel(rows, {"Stibe": False})
    assert starten == [] and beenden == []


def test_nichtwissen_aendert_nichts():
    """Aus «unbekannt» soll weder eine Karte entstehen noch eine
    verschwinden - wer im Ergebnis fehlt, bleibt wie er ist."""
    rows = registrieren([], "Stibe", "token-a")
    rows, starten, _ = wechsel(rows, {"Stibe": True})
    assert len(starten) == 1
    # Zone meldet gerade nichts Brauchbares: Stibe fehlt im Stand.
    rows, starten, beenden = wechsel(rows, {})
    assert starten == [] and beenden == []
    assert rows[0]["unterwegs"] is True


def test_payloads_tragen_das_noetige():
    start = start_payload(1000.0)
    assert start["aps"]["event"] == "start"
    assert start["aps"]["attributes-type"] == "TuerAktivitaetAttributes"
    assert start["aps"]["attributes"] == {"tuer": "Haustüre"}
    # Das alert ist beim Start PFLICHT: Ohne es nahm Apple den Push an
    # (200 im Log), aber iOS stellte still nie eine Karte auf. Genau so
    # sah der Fehler wochenlang aus - dieser Test hält die Lehre fest.
    assert start["aps"]["alert"]["title"] == "Haustüre"
    assert start["aps"]["alert"]["body"]
    ende = end_payload(2000.0)
    assert ende["aps"]["event"] == "end"
    assert ende["aps"]["dismissal-date"] == 2000


def test_apns_jwt_traegt_kennung_und_gueltige_signatur():
    """Apple prüft kid im Kopf, iss in den Claims und die ES256-Signatur
    in roher r||s-Form - genau das hier auch, mit einem frischen
    Schlüssel statt eines eingecheckten."""
    import base64
    import json

    import pytest

    # Wie pydevccu: Das Extra 'apns' ist optional - ohne die Bibliothek
    # wird übersprungen statt rot.
    #
    # Nicht importorskip: Eine halb eingerichtete cryptography (die
    # Rust-Anbindung ohne _cffi_backend) wirft beim Import keine
    # ImportError, sondern eine PanicException aus pyo3 - die erbt von
    # BaseException, und importorskip lässt sie durch. Ein fehlendes
    # Extra ist aber in beiden Fällen dasselbe: kein Grund für Rot.
    try:
        import cryptography.hazmat.primitives.asymmetric.ec  # noqa: F401
    except BaseException as err:  # pragma: no cover - hängt an der Umgebung
        pytest.skip(f"cryptography nicht benutzbar: {err}")
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import (
        encode_dss_signature,
    )

    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    token = apns_jwt(pem, "KEY1", "TEAM1", 1234.0)
    kopf_roh, inhalt_roh, signatur_roh = token.split(".")

    def lesen(teil: str) -> dict:
        return json.loads(base64.urlsafe_b64decode(teil + "=" * (-len(teil) % 4)))

    assert lesen(kopf_roh) == {"alg": "ES256", "kid": "KEY1"}
    assert lesen(inhalt_roh) == {"iss": "TEAM1", "iat": 1234}
    roh = base64.urlsafe_b64decode(signatur_roh + "=" * (-len(signatur_roh) % 4))
    assert len(roh) == 64
    der = encode_dss_signature(
        int.from_bytes(roh[:32], "big"), int.from_bytes(roh[32:], "big")
    )
    key.public_key().verify(
        der, f"{kopf_roh}.{inhalt_roh}".encode(), ec.ECDSA(hashes.SHA256())
    )


def test_der_profil_schalter_stoppt_und_beendet():
    """Wer die Live-Aktivität im Profil abschaltet, gilt für die Karte
    als zuhause: nichts Neues startet, und die laufende endet sofort -
    nicht erst beim nächsten Heimkommen."""
    from homepilot.core.liveaktivitaet import abgeschaltet

    prefs = [
        {"user": "Stibe", "prefs": {"liveTuer": False}},
        {"user": "Bine", "prefs": {"liveTuer": True}},
        {"user": "Tablet", "prefs": {}},
        "kaputt",
    ]
    assert abgeschaltet(prefs) == {"Stibe"}
    assert abgeschaltet([]) == set()

    # Und in der Runde: weg, aber abgeschaltet -> die Karte endet.
    rows = registrieren([], "Stibe", "token-a")
    rows, starten, _ = wechsel(rows, {"Stibe": True})
    rows = aktivitaet_merken(rows, "Stibe", "activity-1")
    weg = {"Stibe": True}
    for name in abgeschaltet(prefs):
        weg[name] = False
    rows, starten, beenden = wechsel(rows, weg)
    assert starten == []
    assert [r["activity_token"] for r in beenden] == ["activity-1"]


class TestKarteFaellig:
    def test_auf_dem_heimweg_laeuft_die_karte(self) -> None:
        # Nicht zuhause, wieder nah - und vorher wirklich draussen
        # gewesen: genau der Moment für den Türöffner.
        assert karte_faellig("away", 800, True) is True
        assert karte_faellig("quartier", 2500, True) is True

    def test_beim_weggehen_kommt_sie_nicht(self) -> None:
        """Der Fall vom Sperrbildschirm: Beim Hinausgehen ist man
        ebenfalls im Umkreis - die Karte gehört aber auf den Heimweg."""
        assert karte_faellig("away", 800, False) is False
        assert karte_faellig("quartier", 2500, False) is False

    def test_weit_weg_laeuft_sie_nicht(self) -> None:
        # Sonst läge sie den ganzen Arbeitstag auf dem Sperrbildschirm.
        assert karte_faellig("away", 12_000, True) is False

    def test_zuhause_endet_sie(self) -> None:
        assert karte_faellig("home", 0, True) is False

    def test_ohne_entfernung_entscheidet_die_zone(self) -> None:
        assert karte_faellig("quartier", None, True) is True
        assert karte_faellig("away", None, True) is False

    def test_unbekannt_bleibt_unbekannt(self) -> None:
        assert karte_faellig("unknown", None, True) is None
        assert karte_faellig("", 500, True) is None
        # bool ist in Python ein int - aber keine Entfernung.
        assert karte_faellig("away", True, True) is False


class TestWeitWeg:
    """Was als «war wirklich draussen» zählt - der Vermerk, ohne den
    keine Karte mehr kommt."""

    def test_weiter_als_der_umkreis(self) -> None:
        assert weit_weg("away", 12_000) is True
        assert weit_weg("away", 800) is False

    def test_zuhause_faengt_von_vorn_an(self) -> None:
        assert weit_weg("home", 0) is False

    def test_ohne_entfernung_entscheidet_die_zone(self) -> None:
        assert weit_weg("away", None) is True
        assert weit_weg("quartier", None) is False

    def test_unbekannt_aendert_nichts(self) -> None:
        assert weit_weg("unknown", None) is None
        assert weit_weg("", 12_000) is None

    def test_der_vermerk_haelt_je_person(self) -> None:
        rows = weit_merken([], "Stibe", True)
        rows = weit_merken(rows, "Bine", False)
        assert war_weit(rows, "Stibe") is True
        assert war_weit(rows, "Bine") is False
        assert war_weit(rows, "Levin") is False
        # Und je Person nur eine Zeile.
        rows = weit_merken(rows, "Stibe", False)
        assert len([r for r in rows if r["user"] == "Stibe"]) == 1
        assert war_weit(rows, "Stibe") is False



class TestVermerk:
    """Wann «war draussen» gesetzt und wann es gelöscht wird.

    Der Fehler dahinter: Gelöscht wurde bei jedem Näherkommen. «Nicht
    mehr weit weg» ist ab drei Kilometern wahr - also genau ab der
    Entfernung, ab der die Karte fällig wäre. Ob eine kam, hing damit
    daran, in welcher Reihenfolge die Ortung ihre Punkte lieferte.
    """

    def test_draussen_setzt_den_vermerk(self) -> None:
        assert vermerk("away", True) is True

    def test_naeherkommen_loescht_ihn_nicht(self) -> None:
        # Zwei Kilometer vor der Türe: der Heimweg, nicht sein Ende.
        assert vermerk("away", False) is None
        assert vermerk("quartier", False) is None

    def test_erst_zuhause_faengt_es_von_vorn_an(self) -> None:
        assert vermerk("home", False) is False
        # Auch dann, wenn die Ortung gerade nichts weiss.
        assert vermerk("home", None) is False

    def test_unbekanntes_laesst_ihn_stehen(self) -> None:
        assert vermerk("unknown", None) is None


class TestKartenstand:
    """Anfangen auf dem Heimweg, aufhören zuhause - und dazwischen
    liegenbleiben, auch wenn die Ortung zittert."""

    def test_eine_liegende_karte_ueberlebt_einen_ausreisser(self) -> None:
        # Der gemeldete Fall: Die Entfernung springt kurz über die
        # Grenze. Vorher endete die Karte damit und begann gleich neu -
        # und weil das Beenden oft nicht ankommt, lagen danach zwei.
        assert kartenstand("away", 12_000, True, True) is True
        assert kartenstand("away", 12_000, True, False) is False

    def test_zuhause_endet_sie_auch_dann(self) -> None:
        assert kartenstand("home", 0, True, True) is False

    def test_ohne_laufende_karte_gilt_die_alte_regel(self) -> None:
        assert kartenstand("away", 800, True, False) is True
        assert kartenstand("away", 800, False, False) is False

    def test_unbekannt_bleibt_unbekannt(self) -> None:
        assert kartenstand("unknown", None, True, True) is None


def test_die_startsperre_verhindert_einen_stapel():
    """Der letzte Riegel: Selbst wenn alles andere versagt, kommt
    innerhalb einer halben Stunde keine zweite Karte dazu.

    Nötig, weil ein Ende-Push das Token der laufenden Aktivität braucht.
    Ein gesperrtes Telefon meldet es oft nie nach - die alte Karte
    verschwindet dann nicht, sie bekommt bloss Gesellschaft.
    """
    rows = registrieren([], "Stibe", "token-a", "iPhone")
    rows, starten, _ = wechsel(rows, {"Stibe": True}, jetzt=1000.0)
    assert len(starten) == 1

    # Zuhause angekommen - aber die App hat nie ein Aktivitäts-Token
    # nachgemeldet, das Ende geht also ins Leere.
    rows, _, beenden = wechsel(rows, {"Stibe": False}, jetzt=1100.0)
    assert [r.get("activity_token") for r in beenden] == [None]

    # Gleich wieder unterwegs: Die Karte gilt als liegend, es kommt
    # keine zweite dazu.
    rows, starten, _ = wechsel(rows, {"Stibe": True}, jetzt=1200.0)
    assert starten == []
    assert rows[0]["unterwegs"] is True

    # Nach der Sperrfrist ist eine neue Karte wieder richtig: Die alte
    # hat iOS bis dahin längst weggeräumt.
    rows, _, _ = wechsel(rows, {"Stibe": False}, jetzt=1300.0)
    rows, starten, _ = wechsel(rows, {"Stibe": True}, jetzt=1300.0 + 1801.0)
    assert len(starten) == 1
