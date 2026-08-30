"""Eine Verbindung, die kommt und geht – erkennen und genau einmal melden."""

from __future__ import annotations

from homepilot.core import flattern

from .pushstand import Pushstand, entitaet

# ── Der reine Kern ─────────────────────────────────────────────────────


def test_alte_rueckkehrer_fallen_aus_dem_fenster():
    # Das Vergessen gehört ins Merken: Sonst wüchse die Liste eines
    # wackeligen Geräts über Tage, und die Meldung käme wegen einer
    # Stunde von vorgestern.
    alt = [1000.0, 2000.0]
    assert flattern.merken(alt, 2000.0 + flattern.FENSTER + 1) == [2000.0 + flattern.FENSTER + 1]


def test_frische_rueckkehrer_bleiben_stehen():
    assert flattern.merken([1000.0], 1100.0) == [1000.0, 1100.0]


def test_erst_ab_der_schwelle_flattert_es():
    # Zwei Aussetzer in einer Stunde hat jedes Funknetz einmal.
    assert flattern.flattert([1.0, 2.0]) is False
    assert flattern.flattert([float(n) for n in range(flattern.SCHWELLE)]) is True


def test_ruhe_erst_nach_einem_ganzen_fenster():
    assert flattern.beruhigt([], 5000.0) is True
    assert flattern.beruhigt([4000.0], 5000.0) is False
    assert flattern.beruhigt([4000.0], 4000.0 + flattern.FENSTER) is True


def test_der_satz_nennt_die_zahl_und_einen_griff():
    text = flattern.satz("androidtv", 9)
    assert "androidtv" in text
    assert "9-mal" in text
    # Ohne Ursachen stünde da ein Problem ohne Handgriff.
    assert "Empfang" in text


# ── Im Wächter ─────────────────────────────────────────────────────────


def wackler(stand: Pushstand, mal: int) -> None:
    """`mal` Unterbrechungen samt Rückkehr – so, wie sie im Haus ankommen."""
    for _ in range(mal):
        stand.hub.watchdog._on_state(
            "state_changed",
            {
                "entity_id": "androidtv.10_10_1_37",
                "availability_changed": True,
                "entity": {"available": True},
                "old_state": {},
                "new_state": {},
            },
        )


async def test_eine_flatternde_anbindung_wird_genau_einmal_gemeldet(hub):
    stand = Pushstand(hub)
    stand.welt([entitaet("androidtv.10_10_1_37", integration="androidtv")])

    wackler(stand, flattern.SCHWELLE + 2)
    await stand.runden(4)

    assert stand.wie_oft("androidtv verbindet dauernd neu") == 1


async def test_zwei_aussetzer_sind_keine_meldung(hub):
    """Der Ausfallmelder soll nicht durch die Hintertür zurückkommen: Wer
    zweimal kurz weg war, hat kein Problem, sondern ein Funknetz."""
    stand = Pushstand(hub)
    stand.welt([entitaet("androidtv.10_10_1_37", integration="androidtv")])

    wackler(stand, 2)
    await stand.runden(3)

    assert stand.wie_oft("androidtv verbindet dauernd neu") == 0


async def test_weitere_wackler_melden_nicht_erneut(hub):
    """Die Meldung darf nicht mit jeder weiteren Rückkehr wiederkommen –
    genau daran ist die Akku-Warnung einmal gescheitert."""
    stand = Pushstand(hub)
    stand.welt([entitaet("androidtv.10_10_1_37", integration="androidtv")])

    wackler(stand, flattern.SCHWELLE)
    await stand.runden(2)
    wackler(stand, flattern.SCHWELLE)
    await stand.runden(2)

    assert stand.wie_oft("androidtv verbindet dauernd neu") == 1


async def test_die_demo_flattert_nie(hub):
    """Wer auf der Ignorier-Liste steht, meldet auch hier nicht: Der
    Gremlin lässt seinen Sensor absichtlich kommen und gehen."""
    stand = Pushstand(hub)
    stand.welt([entitaet("demo.motion_hall")])

    for _ in range(flattern.SCHWELLE + 5):
        hub.watchdog._on_state(
            "state_changed",
            {
                "entity_id": "demo.motion_hall",
                "availability_changed": True,
                "entity": {"available": True},
                "old_state": {},
                "new_state": {},
            },
        )
    await stand.runden(3)

    assert stand.wie_oft("demo verbindet dauernd neu") == 0
