"""Push-Einstellungen je Gerät (Punkt 471).

Der Fall: Das iPad liegt nachts im Wohnzimmer und darf klingeln, das
Telefon liegt neben dem Bett.
"""

from homepilot.core import pushgeraet

ZEILE = {
    "user": "Stefan",
    "muted": ["battery"],
    "ruhe": {"enabled": True, "from": 22, "to": 7},
}


def test_ein_geraet_ohne_eintrag_folgt_der_person():
    assert pushgeraet.fuer_geraet(ZEILE, "ExponentPushToken[x]") == ZEILE
    assert pushgeraet.weicht_ab(ZEILE, "ExponentPushToken[x]") is False


def test_eine_abweichung_ueberschreibt_nur_ihr_feld():
    """Wer am iPad die Ruhezeit ausschaltet, behält dort die Abbestellungen."""
    zeile = pushgeraet.setzen(ZEILE, "tab", {"ruhe": {"enabled": False, "from": 0, "to": 0}})
    fuers_tab = pushgeraet.fuer_geraet(zeile, "tab")
    assert fuers_tab["ruhe"]["enabled"] is False
    assert fuers_tab["muted"] == ["battery"]
    # Das Telefon bleibt, wie es war.
    assert pushgeraet.fuer_geraet(zeile, "phone")["ruhe"]["enabled"] is True


def test_eine_leere_abweichung_fliegt_wieder_heraus():
    """Sonst behauptete die App «eigene Einstellung», wo keine ist."""
    zeile = pushgeraet.setzen(ZEILE, "tab", {"ruhe": {"enabled": False}})
    zurueck = pushgeraet.setzen(zeile, "tab", {"ruhe": None})
    assert pushgeraet.FELD not in zurueck
    assert pushgeraet.weicht_ab(zurueck, "tab") is False


def test_kaputte_zeilen_lassen_alle_geraete_der_person_folgen():
    assert pushgeraet.lesen(None) == {}
    assert pushgeraet.lesen({"geraete": "unsinn"}) == {}
    assert pushgeraet.fuer_geraet(None, "tab") == {}


def test_abgemeldete_geraete_werden_aufgeraeumt():
    zeile = pushgeraet.setzen(ZEILE, "alt", {"ruhe": {"enabled": False}})
    zeile = pushgeraet.setzen(zeile, "neu", {"ruhe": {"enabled": False}})
    sauber = pushgeraet.aufraeumen(zeile, ["neu"])
    assert sauber is not None
    assert list(pushgeraet.lesen(sauber)) == ["neu"]
    # Nichts zu tun heisst nichts schreiben.
    assert pushgeraet.aufraeumen(sauber, ["neu"]) is None


# ── Der Push-Dienst wählt je Gerät (Punkt 471) ────────────────────────────


def test_der_dienst_haelt_nur_das_gemeinte_geraet_zurueck():
    """Das iPad liegt nachts im Wohnzimmer und darf klingeln."""
    from types import SimpleNamespace

    from homepilot.core.push import PushService
    from homepilot.core.users import Role

    dienst = PushService()
    dienst.register("ExponentPushToken[phone]", "Stefan", "iPhone")
    dienst.register("ExponentPushToken[tab]", "Stefan", "iPad Wohnzimmer")
    users = [SimpleNamespace(name="Stefan", role=Role.OWNER)]

    # Die Person hat «battery» abbestellt - beide Geräte schweigen.
    dienst.muted = {"Stefan": {"battery"}}
    assert dienst.recipients(users, "all", "battery") == []

    # Das iPad weicht ab: Dort will man sie.
    dienst.geraete_muted = {"ExponentPushToken[tab]": set()}
    assert dienst.recipients(users, "all", "battery") == ["ExponentPushToken[tab]"]
