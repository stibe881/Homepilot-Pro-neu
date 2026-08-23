"""Babysitter-Modus: jemand ist da, den die Anwesenheit nicht kennt.

Der Fall, für den es ihn gibt: Die Eltern sind weg, also meldet die
Anwesenheit «niemand zuhause» - und «alles aus» fährt die Storen
herunter und schaltet scharf, während der Babysitter im Wohnzimmer
sitzt.
"""

from homepilot.core import babysitter


def test_read_ist_nachsichtig() -> None:
    """Ein kaputter Eintrag heisst «Modus aus», nicht «Absturz».

    Ein Ablauf, der wegen eines Tippfehlers in einer Datei nicht mehr
    läuft, wäre die schlechtere Antwort.
    """
    assert babysitter.read(None) == {"active": False, "allow": [], "since": None}
    assert babysitter.read("kaputt")["active"] is False
    assert babysitter.read({"active": True, "allow": "keine Liste"})["allow"] == []
    # Doppelte und leere Kennungen fliegen raus.
    assert babysitter.read({"allow": ["a", "a", "", "b"]})["allow"] == ["a", "b"]


def test_blocks_haelt_nur_zurueck_was_nicht_freigegeben_ist() -> None:
    stand = {"active": True, "allow": ["licht_bewegung"]}
    assert babysitter.blocks(stand, "alles_aus") is True
    assert babysitter.blocks(stand, "licht_bewegung") is False


def test_ohne_modus_haelt_nichts_zurueck() -> None:
    """Und die Haken bleiben trotzdem stehen.

    Wer den Modus am nächsten Abend wieder einschaltet, soll nicht neu
    anhaken müssen.
    """
    stand = {"active": False, "allow": ["licht_bewegung"]}
    assert babysitter.blocks(stand, "alles_aus") is False
    assert babysitter.is_allowed(stand, "licht_bewegung") is True


def test_toggle_gibt_frei_und_zurueck() -> None:
    stand = babysitter.toggle(None, "licht_bewegung", True)
    assert stand["allow"] == ["licht_bewegung"]
    stand = babysitter.toggle(stand, "tuerklingel", True)
    assert stand["allow"] == ["licht_bewegung", "tuerklingel"]
    stand = babysitter.toggle(stand, "licht_bewegung", False)
    assert stand["allow"] == ["tuerklingel"]
    # Zweimal abwählen ist kein Fehler.
    assert babysitter.toggle(stand, "licht_bewegung", False)["allow"] == ["tuerklingel"]


def test_set_active_merkt_sich_seit_wann() -> None:
    """«seit 19:40» beantwortet am Morgen, ob jemand vergessen hat auszuschalten."""
    an = babysitter.set_active({"allow": ["a"]}, True, now=1_700_000_000.0)
    assert an["active"] is True
    assert an["since"] == 1_700_000_000.0
    # Die Freigaben überleben das Ausschalten.
    aus = babysitter.set_active(an, False)
    assert aus["active"] is False and aus["since"] is None
    assert aus["allow"] == ["a"]


def test_summary_sagt_wie_viele_dann_ruhen() -> None:
    """«17 Abläufe ruhen dann» ist die Auskunft, die man vor dem Drücken braucht."""
    stand = {"active": True, "allow": ["a", "weg"]}
    zusammen = babysitter.summary(stand, ["a", "b", "c"])
    assert zusammen["running"] == 1
    assert zusammen["paused"] == 2
    assert zusammen["active"] is True
    # Eine Freigabe für einen gelöschten Ablauf zählt nicht mit.
    assert "weg" in zusammen["allow"]


def test_der_zustand_ueberlebt_den_datenspeicher() -> None:
    """Der hält Listen.

    Ein Zustand als blosses dict käme dort als Liste seiner Schlüssel
    wieder heraus - der Modus wäre nach dem ersten Neustart aus, und
    zwar lautlos.
    """
    stand = babysitter.set_active({"allow": ["a"]}, True, now=1.0)
    zurueck = babysitter.read(babysitter.store(stand))
    assert zurueck == stand
