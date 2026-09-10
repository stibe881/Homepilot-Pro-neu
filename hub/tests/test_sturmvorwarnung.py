"""Bescheid sagen, bevor es losgeht.

Der Sturmwächter fährt die Storen hoch und meldet, dass er es getan
hat. Das ist der richtige Griff für die Lamellen - und es beantwortet
die andere Hälfte der Frage nicht: Der Sonnenschirm, die Kissen, das
Trampolin muss ein Mensch hereinholen, und dafür braucht er Vorlauf.
"""

from __future__ import annotations

from datetime import datetime

from homepilot.core import sturmvorwarnung as sv

JETZT = datetime(2026, 6, 20, 18, 0)


def lage(onset: str, grund: str = "Sturm") -> dict[str, str]:
    return {"grund": grund, "severity": "severe", "bis": "", "onset": onset}


def test_die_vorwarnung_kommt_kurz_vorher() -> None:
    """MeteoSchweiz gibt Warnungen gern am Vormittag für den Abend
    heraus. Eine Meldung «Sturm ab 19 Uhr» um zehn Uhr morgens wischt
    man weg und hat sie um sieben vergessen."""
    assert sv.faellig(lage("2026-06-20T18:30:00"), JETZT)
    assert not sv.faellig(lage("2026-06-20T22:00:00"), JETZT)


def test_wer_schon_mittendrin_steht_bekommt_keine_vorwarnung() -> None:
    """Eine «Vorwarnung», die zugleich mit dem Wind eintrifft, wäre eine
    Lüge im Namen - dann meldet der Sturmwächter."""
    assert not sv.faellig(lage("2026-06-20T17:30:00"), JETZT)
    assert not sv.faellig(lage("2026-06-20T18:00:00"), JETZT)


def test_ohne_beginn_gibt_es_keine_vorwarnung() -> None:
    """Nicht «sofort»: Eine Vorwarnung aufgrund eines Zeitstempels, den
    niemand lesen konnte, käme zur falschen Zeit."""
    assert not sv.faellig(lage(""), JETZT)
    assert not sv.faellig(lage("irgendwann"), JETZT)
    assert not sv.faellig(None, JETZT)


def test_eine_zeitzone_wird_umgerechnet() -> None:
    """MeteoAlarm liefert mit Zeitzone, verglichen wird gegen die
    Ortszeit des Hubs."""
    assert sv.onset_lesen("2026-06-20T18:30:00+02:00") is not None
    assert sv.onset_lesen("2026-06-20T18:30:00Z") is not None


def test_ein_fenster_und_kein_zeitpunkt() -> None:
    """Der Wächter läuft im Minutentakt, aber eine Runde kann ausfallen
    (Neustart, Update) - «genau bei 40 Minuten» wäre für immer
    verpasst."""
    for minuten in (5, 20, 39):
        spaeter = datetime(2026, 6, 20, 18, 40 - minuten)
        assert sv.faellig(lage("2026-06-20T18:40:00"), spaeter), minuten


def test_dieselbe_warnung_warnt_einmal_vor() -> None:
    kennung = sv.marke(lage("2026-06-20T18:30:00"))
    rows = sv.vermerken([], kennung, 1000.0)
    assert sv.schon_gewarnt(rows, kennung)


def test_ein_zweiter_sturm_bekommt_seine_eigene() -> None:
    """Sonst würde der zweite verschluckt."""
    erste = sv.marke(lage("2026-06-20T18:30:00"))
    zweite = sv.marke(lage("2026-06-20T23:00:00"))
    rows = sv.vermerken([], erste, 1000.0)
    assert not sv.schon_gewarnt(rows, zweite)


def test_der_text_sagt_wann_und_was_offen_ist() -> None:
    titel, text = sv.text(lage("2026-06-20T18:30:00"), ["Fenster Bad"], JETZT)
    assert titel == "⚠️ Sturm ab 18:30"
    assert "30 Minuten" in text
    assert "Fenster Bad" in text


def test_der_text_fragt_nach_dem_was_der_hub_nicht_sieht() -> None:
    """Was draussen steht, weiss nur, wer hinsieht - eine Liste dazu
    wäre erfunden."""
    _, text = sv.text(lage("2026-06-20T18:30:00"), [], JETZT)
    assert "draussen" in text


def test_viele_offene_fenster_werden_gezaehlt() -> None:
    _, text = sv.text(
        lage("2026-06-20T18:30:00"), [f"Fenster {n}" for n in range(7)], JETZT
    )
    assert "und 3 weitere" in text


def test_der_grund_steht_im_titel() -> None:
    """Hagel und Sturm verlangen Verschiedenes - der Schirm hilft gegen
    das eine und ist beim anderen das Problem."""
    titel, _ = sv.text(lage("2026-06-20T18:30:00", grund="Hagel"), [], JETZT)
    assert "Hagel" in titel
