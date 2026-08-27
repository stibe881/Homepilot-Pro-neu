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
    # Still, ohne Klingeln: kein alert.
    assert "alert" not in start["aps"]
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
    pytest.importorskip("cryptography.hazmat.primitives.asymmetric.ec")
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
