"""Der Nachbericht: was war das gerade?

Die einzelnen Zeilen stehen im Verlauf - aber eine Liste beantwortet die
Frage nicht, die man zehn Minuten später in der Küche stellt: Was war
zuerst, was folgte, und wer hat es beendet?
"""

from __future__ import annotations

from homepilot.core import alarmbericht


def zeile(kind: str, text: str, at: float, by: str = ""):
    return {"kind": kind, "text": text, "at": at, "by": by}


# Der Verlauf steht jüngste zuerst - so schreibt ihn alarm._note.
VERLAUF = [
    zeile("disarmed", "Unscharf geschaltet", 1_000_240.0, "Stefan"),
    zeile("motion", "Bewegung vor Küche", 1_000_060.0),
    zeile("triggered", "Alarm ausgelöst: Haustüre", 1_000_000.0),
    zeile("armed", "Ausser Haus scharf geschaltet", 990_000.0, "Stefan"),
]


def test_ohne_ausloeser_gibt_es_nichts_zu_berichten() -> None:
    """Der Normalfall: Die Anlage wird viel häufiger unscharf
    geschaltet, als sie auslöst."""
    nur_scharf = [zeile("armed", "Scharf", 990_000.0)]
    assert alarmbericht.bericht(nur_scharf, "Stefan", 1_000_000.0) is None


def test_der_bericht_beginnt_beim_ausloeser() -> None:
    ergebnis = alarmbericht.bericht(VERLAUF, "Stefan", 1_000_240.0)
    assert ergebnis is not None
    titel, text = ergebnis
    assert titel == "Was war: Haustüre"
    assert text.startswith(alarmbericht._zeit(1_000_000.0))
    assert "Haustüre" in text


def test_was_danach_kam_steht_in_der_reihenfolge() -> None:
    """Daran sieht man einen Weg durchs Haus - und daran, dass eine
    einzelne Meldung ohne Fortsetzung meist eine Katze war."""
    _, text = alarmbericht.bericht(VERLAUF, "Stefan", 1_000_240.0)
    assert text.index("Haustüre") < text.index("Küche")


def test_das_scharfschalten_davor_gehoert_nicht_dazu() -> None:
    """Ein Bericht über einen Alarm soll den Alarm beschreiben, nicht
    die Woche davor."""
    _, text = alarmbericht.bericht(VERLAUF, "Stefan", 1_000_240.0)
    assert "scharf geschaltet" not in text


def test_wer_beendet_hat_steht_am_schluss() -> None:
    _, text = alarmbericht.bericht(VERLAUF, "Stefan", 1_000_240.0)
    assert text.endswith("von Stefan.")
    assert "4 Minuten" in text


def test_niemand_hat_hingeschaut_steht_ausgeschrieben() -> None:
    """Die Zeile, wegen der es den Bericht gibt."""
    _, text = alarmbericht.bericht(VERLAUF, "automatisch", 1_000_240.0)
    assert "ohne dass jemand hinsah" in text


def test_ein_kurzer_alarm_wird_in_sekunden_gezaehlt() -> None:
    """Bei einem Alarm, der nach zwanzig Sekunden endete, ist genau
    diese Zahl die Auskunft - jemand war schon an der Türe."""
    assert alarmbericht.dauer(20) == "20 Sekunden"
    assert alarmbericht.dauer(60) == "eine Minute"
    assert alarmbericht.dauer(3600) == "60 Minuten"


def test_viele_zwischenschritte_werden_gezaehlt() -> None:
    viel = [zeile("disarmed", "Unscharf", 1_000_500.0, "Stefan")]
    viel += [
        zeile("motion", f"Bewegung {n}", 1_000_400.0 - n * 10) for n in range(9)
    ]
    viel += [zeile("triggered", "Alarm ausgelöst: Haustüre", 1_000_000.0)]
    _, text = alarmbericht.bericht(viel, "Stefan", 1_000_500.0)
    assert "und 4 weitere Meldungen" in text


def test_ein_frueherer_abend_bleibt_draussen() -> None:
    """Gesucht ist der Abschnitt vom jüngsten «ausgelöst» - alles davor
    gehört zu einem anderen Abend."""
    zwei_abende = [
        zeile("disarmed", "Unscharf", 2_000_100.0, "Bine"),
        zeile("triggered", "Alarm ausgelöst: Terrasse", 2_000_000.0),
        *VERLAUF,
    ]
    titel, text = alarmbericht.bericht(zwei_abende, "Bine", 2_000_100.0)
    assert titel == "Was war: Terrasse"
    assert "Haustüre" not in text
