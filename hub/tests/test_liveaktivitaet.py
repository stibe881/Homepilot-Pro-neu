"""Die Haustür-Live-Aktivität: starten beim Gehen, beenden beim Kommen."""

from homepilot.core.liveaktivitaet import (
    abmelden,
    aktivitaet_merken,
    apns_jwt,
    end_payload,
    parse_apns,
    registrieren,
    start_payload,
    wechsel,
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
