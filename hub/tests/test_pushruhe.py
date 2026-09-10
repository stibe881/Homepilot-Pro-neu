"""Ruhezeit, Stillstellen auf Zeit und der Tagesdeckel.

Alle drei halten Meldungen zurück, und der Fehler, den man mit ihnen
bauen kann, ist immer derselbe: eine Nacht, in der der Wasseralarm nicht
brummt. Deshalb steht die Liste der Kategorien, die nichts aufhält, als
erster Test hier - vor allem anderen.
"""

from __future__ import annotations

from homepilot.core import pushruhe
from homepilot.core.push import CATEGORIES


def test_der_wasseralarm_laesst_sich_nicht_stillstellen() -> None:
    """Die Zusage, wegen der es diese Datei gibt."""
    for kategorie in ("alarm", "leak", "doorbell", "baby_cry", "timer"):
        assert not pushruhe.darf_zurueckgehalten(kategorie)
        assert (
            pushruhe.haelt_zurueck(
                kategorie,
                ruhe={"enabled": True, "from": 22, "to": 7},
                still={kategorie: 1e12},
                stunde=3,
            )
            is None
        )


def test_immer_durch_kennt_nur_echte_kategorien() -> None:
    """Ein Tippfehler in der Liste wäre eine Kategorie, die doch still ist."""
    assert set(CATEGORIES) >= pushruhe.IMMER_DURCH


def test_ein_ablauf_darf_stillgestellt_werden() -> None:
    """Wer sich einen zu redseligen Ablauf gebaut hat, soll ihn nicht
    löschen müssen, um Ruhe zu haben."""
    assert pushruhe.darf_zurueckgehalten("automation:gefriertruhe")


# ── Ruhezeit ───────────────────────────────────────────────────────────────


def test_die_nacht_geht_ueber_mitternacht() -> None:
    nacht = {"enabled": True, "from": 22, "to": 7}
    assert pushruhe.in_der_ruhe(nacht, 23)
    assert pushruhe.in_der_ruhe(nacht, 0)
    assert pushruhe.in_der_ruhe(nacht, 6)
    assert not pushruhe.in_der_ruhe(nacht, 7)
    assert not pushruhe.in_der_ruhe(nacht, 21)


def test_eine_ruhezeit_am_tag_geht_auch() -> None:
    """Wer Nachtschicht hat, schläft von 8 bis 15."""
    schicht = {"enabled": True, "from": 8, "to": 15}
    assert pushruhe.in_der_ruhe(schicht, 9)
    assert not pushruhe.in_der_ruhe(schicht, 16)
    assert not pushruhe.in_der_ruhe(schicht, 2)


def test_gleiche_zahlen_heissen_keine_ruhezeit() -> None:
    """Ein Fenster von null Stunden - nicht eines von vierundzwanzig.
    Wer wirklich nie etwas will, bestellt die Kategorie ab, und das
    steht dann auch noch in einem halben Jahr sichtbar da."""
    assert not pushruhe.in_der_ruhe({"enabled": True, "from": 22, "to": 22}, 22)


def test_ausgeschaltet_haelt_nichts_zurueck() -> None:
    assert not pushruhe.in_der_ruhe({"enabled": False, "from": 22, "to": 7}, 3)


def test_kaputte_ruhezeit_wird_zur_vorgabe() -> None:
    """Eine kaputte Zeile im Datenspeicher darf den Hub nicht am Melden
    hindern - und die Vorgabe ist «aus»."""
    gelesen = pushruhe.ruhe_lesen({"enabled": "vielleicht", "from": "acht", "to": None})
    assert gelesen == {"enabled": False, "from": 22, "to": 7}


def test_batteriewarnung_schweigt_nachts() -> None:
    assert (
        pushruhe.haelt_zurueck(
            "battery", ruhe={"enabled": True, "from": 22, "to": 7}, stunde=3
        )
        == pushruhe.GRUND_RUHE
    )


# ── Stillstellen auf Zeit ──────────────────────────────────────────────────


def test_stillstellen_laeuft_von_selbst_ab() -> None:
    jetzt = 1_000_000.0
    stand = pushruhe.still_setzen({}, "appliance", 2, jetzt)
    assert pushruhe.still_lesen(stand, jetzt + 3600)
    # Zwei Stunden später ist es vorbei, ohne dass jemand aufräumt.
    assert not pushruhe.still_lesen(stand, jetzt + 7300)


def test_stillstellen_geht_hoechstens_einen_tag() -> None:
    jetzt = 1_000_000.0
    stand = pushruhe.still_setzen({}, "appliance", 500, jetzt)
    assert stand["appliance"] == jetzt + pushruhe.STILL_MAX_STUNDEN * 3600


def test_null_stunden_hebt_es_wieder_auf() -> None:
    """Derselbe Weg hin und zurück - ein zweiter Aufruf wäre einer, den
    man vergessen kann."""
    jetzt = 1_000_000.0
    stand = pushruhe.still_setzen({}, "appliance", 5, jetzt)
    assert pushruhe.still_setzen(stand, "appliance", 0, jetzt) == {}


def test_stillgestelltes_wird_zurueckgehalten() -> None:
    assert (
        pushruhe.haelt_zurueck("appliance", still={"appliance": 1e12}, stunde=12)
        == pushruhe.GRUND_STILL
    )


# ── Tagesdeckel ────────────────────────────────────────────────────────────


def test_der_deckel_greift_erst_beim_naechsten() -> None:
    """Drei Batteriewarnungen kommen, die vierte nicht - nicht die dritte."""
    stand: list = []
    for _ in range(pushruhe.DECKEL["battery"]):
        assert not pushruhe.ueber_deckel(stand, "battery", "2026-09-10")
        stand = pushruhe.hochzaehlen(stand, "battery", "2026-09-10")
    assert pushruhe.ueber_deckel(stand, "battery", "2026-09-10")


def test_der_deckel_faellt_um_mitternacht() -> None:
    stand: list = []
    for _ in range(10):
        stand = pushruhe.hochzaehlen(stand, "battery", "2026-09-10")
    assert pushruhe.ueber_deckel(stand, "battery", "2026-09-10")
    assert not pushruhe.ueber_deckel(stand, "battery", "2026-09-11")


def test_ohne_deckel_wird_nicht_gezaehlt() -> None:
    """Sonst wüchse der Speicher um eine Zeile je Kategorie, die
    niemand je liest."""
    assert pushruhe.hochzaehlen([], "doorbell", "2026-09-10")[0]["zahl"] == {}


def test_der_alarm_hat_keinen_deckel() -> None:
    for kategorie in pushruhe.IMMER_DURCH:
        assert pushruhe.deckel_fuer(kategorie) is None


def test_deckel_kennt_nur_echte_kategorien() -> None:
    assert set(CATEGORIES) >= set(pushruhe.DECKEL)
