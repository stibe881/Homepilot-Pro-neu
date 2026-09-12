"""Die Anlage an die Anwesenheit koppeln - und die scharfen Kanten dabei.

Der häufigste Fehler an einer Alarmanlage ist nicht ein Fehlalarm,
sondern eine Anlage, die niemand scharf geschaltet hat. Die Kopplung
behebt das - und schafft dabei zwei neue Möglichkeiten, sich in den Fuss
zu schiessen. Beide stehen hier.
"""

from __future__ import annotations

from homepilot.core import alarmanwesenheit as ak

WEG = ["away", "away"]
DA = ["home", "away"]
UNBEKANNT = ["unknown", "unknown"]


def test_ein_haus_voller_unbekannter_telefone_gilt_als_bewohnt() -> None:
    """Sonst schaltete sich die Anlage nach jedem Neustart scharf,
    während die Familie am Tisch sitzt."""
    assert not ak.alle_weg(UNBEKANNT)
    assert ak.alle_weg(WEG)


def test_ohne_nachlauf_wird_nicht_scharf_geschaltet() -> None:
    """Man steht mit dem Velo vor der Garage, das Telefon hat die Zone
    gerade verlassen, und drei Minuten später geht man noch einmal
    hinein."""
    assert not ak.soll_scharf(
        WEG, stufe=ak.AUTOMATISCH, state="unscharf", weg_seit=900.0, jetzt=1000.0
    )
    assert ak.soll_scharf(
        WEG, stufe=ak.AUTOMATISCH, state="unscharf", weg_seit=200.0, jetzt=1000.0
    )


def test_der_nachtmodus_wird_nicht_ueberschrieben() -> None:
    """Wer im Nachtmodus ist, hat sich etwas dabei gedacht - «ausser
    Haus» wäre dann eine Abstufung nach unten."""
    assert not ak.soll_scharf(
        WEG, stufe=ak.AUTOMATISCH, state="scharf", weg_seit=0.0, jetzt=1e9
    )


def test_ausgeschaltet_heisst_ausgeschaltet() -> None:
    assert not ak.soll_scharf(
        WEG, stufe=ak.AUS, state="unscharf", weg_seit=0.0, jetzt=1e9
    )
    assert not ak.soll_unscharf(DA, stufe=ak.AUS, state="scharf")


def test_solange_jemand_da_ist_wird_nicht_scharf_geschaltet() -> None:
    assert not ak.soll_scharf(
        DA, stufe=ak.AUTOMATISCH, state="unscharf", weg_seit=0.0, jetzt=1e9
    )


def test_beim_heimkommen_wird_nicht_gewartet() -> None:
    """Wer heimkommt, steht in der Eingangsverzögerung, und die läuft.
    Zehn Minuten zu warten hiesse, die Sirene abzuwarten."""
    assert ak.soll_unscharf(DA, stufe=ak.AUTOMATISCH, state="eintritt")


def test_auch_die_heulende_sirene_wird_abgestellt() -> None:
    """Genau der Fall, für den man das einschaltet: mit den Einkäufen
    in der Tür."""
    assert ak.soll_unscharf(DA, stufe=ak.AUTOMATISCH, state="ausgeloest")


def test_die_unscharfe_anlage_wird_nicht_noch_unschaerfer() -> None:
    assert not ak.soll_unscharf(DA, stufe=ak.AUTOMATISCH, state="unscharf")


def test_die_vorgabe_ist_vorschlagen_nicht_automatisch() -> None:
    """Automatisch unscharf ist die gefährliche Richtung: Ein Telefon
    in fremder Hand hebt damit die Anlage auf."""
    assert ak.stufe_lesen(None) == ak.VORSCHLAGEN
    assert ak.stufe_lesen("unfug") == ak.VORSCHLAGEN
    assert ak.stufe_lesen("automatisch") == ak.AUTOMATISCH


def test_ein_vorschlag_klingt_wie_eine_frage() -> None:
    """Ein Vorschlag, der wie eine Meldung klingt, wird weggewischt -
    und dann steht das Haus offen."""
    assert ak.satz("scharf", ak.VORSCHLAGEN).endswith("?")
    assert not ak.satz("scharf", ak.AUTOMATISCH).endswith("?")
    assert ak.satz("unscharf", ak.VORSCHLAGEN).endswith("?")


def test_selbsttaetig_wird_nie_in_den_urlaubsmodus_geschaltet() -> None:
    """Der überwacht auch Innenräume und hat keine Karenz für Bewohner -
    das soll jemand entscheiden, nicht eine Ortung."""
    assert ak.MODUS == "ausser_haus"


# ── Wer als Person zählt (Punkt 551) ───────────────────────────────────────


class _Gerät:
    def __init__(self, state):
        self.state = state


def test_die_geraeteklasse_entscheidet_wer_eine_person_ist() -> None:
    """Über die Klasse und nicht über die Integration.

    So zählt auch die von Hand gesetzte Anwesenheit mit, und die Anlage
    muss keinen Geofence kennen, den es vielleicht gar nicht gibt.
    """
    assert ak.ist_person(_Gerät({"state": "home", "device_class": "presence"}))
    assert ak.ist_person(_Gerät({"state": "away", "device_class": "Presence"}))


def test_ein_fensterkontakt_ist_keine_person() -> None:
    """Sonst hübe ein geschlossenes Fenster die Anlage auf."""
    assert not ak.ist_person(_Gerät({"state": "off", "device_class": "contact"}))
    assert not ak.ist_person(_Gerät({"state": "on"}))
    assert not ak.ist_person(_Gerät({}))
