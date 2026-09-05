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
    assert babysitter.read(None) == {
        "active": False,
        "allow": [],
        "since": None,
        "until": None,
    }
    assert babysitter.read("kaputt")["active"] is False
    assert babysitter.read({"active": True, "allow": "keine Liste"})["allow"] == []
    # Doppelte und leere Kennungen fliegen raus.
    assert babysitter.read({"allow": ["a", "a", "", "b"]})["allow"] == ["a", "b"]


def test_blocks_haelt_nur_zurueck_was_nicht_freigegeben_ist() -> None:
    stand = {"active": True, "allow": ["licht_bewegung"]}
    assert babysitter.blocks(stand, "alles_aus", 1_700_000_000.0) is True
    assert babysitter.blocks(stand, "licht_bewegung", 1_700_000_000.0) is False


def test_ohne_modus_haelt_nichts_zurueck() -> None:
    """Und die Haken bleiben trotzdem stehen.

    Wer den Modus am nächsten Abend wieder einschaltet, soll nicht neu
    anhaken müssen.
    """
    stand = {"active": False, "allow": ["licht_bewegung"]}
    assert babysitter.blocks(stand, "alles_aus", 1_700_000_000.0) is False
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
    zusammen = babysitter.summary(stand, ["a", "b", "c"], 1_700_000_000.0)
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


# ── Die Frist (früher der Gästemodus) ──────────────────────────────────
#
# Sie stand in einem zweiten Modus daneben, der fast dasselbe tat -
# nur pausierte er *alle* Abläufe, auch die hier freigegebenen, und
# zwar still. Ein Modus statt zwei; was der andere wirklich konnte,
# steht jetzt hier.


def test_ohne_frist_laeuft_er_bis_jemand_ausschaltet() -> None:
    """Der Babysitter-Abend: Man denkt ans Ausschalten."""
    stand = babysitter.starten(None, 1_700_000_000.0)
    assert stand["until"] is None
    # Auch einen Tag später gilt er noch.
    assert babysitter.laeuft(stand, 1_700_000_000.0 + 86_400) is True
    assert babysitter.restminuten(stand, 1_700_000_000.0) == 0


def test_mit_frist_endet_er_von_selbst() -> None:
    """Der Besuch: Danach denkt garantiert niemand mehr daran."""
    jetzt = 1_700_000_000.0
    stand = babysitter.starten(None, jetzt, stunden=4)
    assert stand["until"] == jetzt + 4 * 3600
    assert babysitter.laeuft(stand, jetzt + 3600) is True
    assert babysitter.restminuten(stand, jetzt + 3600) == 180
    # Nach Ablauf gilt er als aus, auch wenn ihn noch niemand aufräumte.
    assert babysitter.laeuft(stand, jetzt + 5 * 3600) is False
    assert babysitter.blocks(stand, "alles_aus", jetzt + 5 * 3600) is False


def test_die_frist_sticht_den_schalter() -> None:
    """Sonst hinge das Haus an einer Aufräumrunde, die nicht lief."""
    jetzt = 1_700_000_000.0
    abgelaufen = {"active": True, "allow": [], "until": jetzt - 1}
    assert babysitter.read(abgelaufen)["active"] is True
    assert babysitter.laeuft(abgelaufen, jetzt) is False
    assert babysitter.summary(abgelaufen, ["a"], jetzt)["active"] is False


def test_unsinnige_dauern_werden_eingefangen() -> None:
    assert babysitter.stunden_pruefen(None) == babysitter.STUNDEN_VORGABE
    assert babysitter.stunden_pruefen("vier") == babysitter.STUNDEN_VORGABE
    assert babysitter.stunden_pruefen(0) == babysitter.STUNDEN_VORGABE
    assert babysitter.stunden_pruefen(-3) == babysitter.STUNDEN_VORGABE
    assert babysitter.stunden_pruefen(999) == babysitter.MAX_STUNDEN
    assert babysitter.stunden_pruefen(2) == 2.0


def test_die_freigaben_ueberleben_die_frist() -> None:
    """Sie gehören zum Haus, nicht zum Abend."""
    stand = babysitter.toggle(None, "licht_bewegung", True)
    an = babysitter.starten(stand, 1.0, stunden=2)
    assert an["allow"] == ["licht_bewegung"]
    aus = babysitter.beenden(an)
    assert aus["allow"] == ["licht_bewegung"]
    assert aus["until"] is None and aus["active"] is False


def test_read_wirft_einen_alten_undo_eintrag_weg() -> None:
    """Das zurückgebaute Empfangslicht hinterliess ``undo`` im Speicher.

    Ein Haus, das den Modus über die Umstellung hinweg laufen hat, darf
    daran nicht hängenbleiben - der Rest wird gelesen, der Schlüssel
    verschwindet.
    """
    alt = {"active": True, "allow": ["a"], "since": 1.0, "undo": "abc123"}
    gelesen = babysitter.read(alt)
    assert gelesen["active"] is True and gelesen["allow"] == ["a"]
    assert "undo" not in gelesen


def test_ein_freigegebener_ablauf_laeuft_auch_beim_besuch() -> None:
    """Genau das konnte der Gästemodus nicht - er pausierte alles."""
    jetzt = 1_700_000_000.0
    stand = babysitter.starten(
        babysitter.toggle(None, "flurlicht", True), jetzt, stunden=4
    )
    assert babysitter.blocks(stand, "flurlicht", jetzt + 60) is False
    assert babysitter.blocks(stand, "alles_aus", jetzt + 60) is True
