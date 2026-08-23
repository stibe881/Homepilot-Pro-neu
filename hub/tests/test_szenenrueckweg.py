"""Szenen zurücknehmen – und zwar nur, was sie geändert haben.

Der Fall, um den es geht: «Kino» schaltet Musik ein, das Licht aus und
den Fernseher aus. Der zweite Druck nimmt das zurück. War der Fernseher
aber schon vorher aus, hat die Szene an ihm nichts getan – dann darf der
Rückweg ihn auch nicht einschalten.
"""

from homepilot.core.szenenrueckweg import (
    hat_sich_geaendert,
    plane_rueckweg,
    rueckbefehl,
    szene_gilt_noch,
    zielzustand,
)

KINO = [
    {"entity_id": "cast.stube", "command": "play"},
    {"entity_id": "hue.stube", "command": "turn_off"},
    {"entity_id": "tv.stube", "command": "turn_off"},
]


def geraet(kind, commands, state):
    return {"kind": kind, "commands": commands, "state": state}


def test_der_fernseher_der_schon_aus_war_bleibt_aus() -> None:
    """Der Kern der Sache.

    Ginge er beim zweiten Druck an, hätte man ein Gerät eingeschaltet,
    das den ganzen Abend aus war - und zwar durch einen Knopf, der
    «rückgängig» heisst.
    """
    stand = {
        "cast.stube": geraet("media_player", ["play", "pause"], {"state": "idle"}),
        "hue.stube": geraet(
            "light", ["turn_on", "turn_off", "set_brightness"],
            {"state": "on", "brightness": 60},
        ),
        "tv.stube": geraet("media_player", ["turn_on", "turn_off"], {"state": "off"}),
    }
    weg = plane_rueckweg(KINO, stand)
    assert [b["entity_id"] for b in weg] == ["hue.stube", "cast.stube"]
    assert weg[0] == {
        "entity_id": "hue.stube",
        "command": "set_brightness",
        "data": {"brightness": 60},
    }
    assert weg[1] == {"entity_id": "cast.stube", "command": "pause"}


def test_der_fernseher_der_an_war_kommt_zurueck() -> None:
    stand = {
        "cast.stube": geraet("media_player", ["play", "pause"], {"state": "idle"}),
        "hue.stube": geraet("light", ["turn_on", "turn_off"], {"state": "off"}),
        "tv.stube": geraet("media_player", ["turn_on", "turn_off"], {"state": "on"}),
    }
    weg = plane_rueckweg(KINO, stand)
    # Das Licht war schon aus - nichts geändert, nichts zurückzunehmen.
    assert [b["entity_id"] for b in weg] == ["tv.stube", "cast.stube"]
    assert weg[0]["command"] == "turn_on"


def test_die_reihenfolge_ist_umgekehrt() -> None:
    """Was zuletzt geschaltet wurde, wird zuerst zurückgenommen.

    Bei Geräten, die voneinander abhängen - erst Fernseher an, dann App
    starten -, ist das die richtige Richtung.
    """
    actions = [
        {"entity_id": "a", "command": "turn_off"},
        {"entity_id": "b", "command": "turn_off"},
    ]
    stand = {
        "a": geraet("switch", ["turn_on", "turn_off"], {"state": "on"}),
        "b": geraet("switch", ["turn_on", "turn_off"], {"state": "on"}),
    }
    assert [b["entity_id"] for b in plane_rueckweg(actions, stand)] == ["b", "a"]


def test_storen_kommen_auf_ihre_position_zurueck() -> None:
    actions = [{"entity_id": "store", "command": "close"}]
    stand = {
        "store": geraet(
            "cover", ["open", "close", "set_position"],
            {"state": "open", "position": 70},
        )
    }
    assert plane_rueckweg(actions, stand) == [
        {"entity_id": "store", "command": "set_position", "data": {"position": 70}}
    ]


def test_eine_tuere_wird_beim_zuruecknehmen_nie_geoeffnet() -> None:
    """Sonst wäre der Rückweg ein Sicherheitsloch."""
    actions = [{"entity_id": "nuki", "command": "lock"}]
    stand = {"nuki": geraet("lock", ["lock", "unlock"], {"state": "unlocked"})}
    assert plane_rueckweg(actions, stand) == []
    # Umgekehrt schon: abgeschlossen war, wird wieder abgeschlossen.
    assert rueckbefehl("lock", ["lock"], {"state": "locked"}) == {"command": "lock"}


def test_alarm_und_saugroboter_bleiben_aussen_vor() -> None:
    """Ein Saugroboter, der mitten im Raum umkehrt, hilft niemandem."""
    assert rueckbefehl("alarm", ["arm_away", "disarm"], {"state": "scharf"}) is None
    assert rueckbefehl("vacuum", ["start", "dock"], {"state": "cleaning"}) is None


def test_was_sich_nicht_vorhersagen_laesst_bleibt_unangetastet() -> None:
    """«Umschalten» sagt nicht, was danach ist - dann lieber nicht raten."""
    assert zielzustand({"command": "toggle"}) == {}
    assert hat_sich_geaendert({"state": "on"}, {}) is False
    actions = [{"entity_id": "x", "command": "toggle"}]
    stand = {"x": geraet("switch", ["turn_on", "turn_off", "toggle"], {"state": "on"})}
    assert plane_rueckweg(actions, stand) == []


def test_ein_geraet_zweimal_in_der_szene_zaehlt_einmal() -> None:
    """Der Vorzustand ist der vor der ersten Aktion."""
    actions = [
        {"entity_id": "hue", "command": "turn_on"},
        {"entity_id": "hue", "command": "set_brightness", "data": {"brightness": 15}},
    ]
    stand = {
        "hue": geraet(
            "light", ["turn_on", "turn_off", "set_brightness"], {"state": "off"}
        )
    }
    assert plane_rueckweg(actions, stand) == [
        {"entity_id": "hue", "command": "turn_off"}
    ]


def test_szene_gilt_noch_solange_niemand_von_hand_eingreift() -> None:
    """Danach entscheidet sich, ob der Knopf gefüllt aussieht."""
    passt = {
        "cast.stube": geraet("media_player", ["play"], {"state": "playing"}),
        "hue.stube": geraet("light", ["turn_off"], {"state": "off"}),
        "tv.stube": geraet("media_player", ["turn_off"], {"state": "off"}),
    }
    assert szene_gilt_noch(KINO, passt) is True

    # Jemand schaltet das Licht wieder an - die Szene ist verlassen.
    verlassen = dict(passt)
    verlassen["hue.stube"] = geraet("light", ["turn_off"], {"state": "on"})
    assert szene_gilt_noch(KINO, verlassen) is False

    # Ohne prüfbare Aktion lieber nicht behaupten, sie gelte.
    assert szene_gilt_noch([{"entity_id": "x", "command": "toggle"}], {}) is False
    assert szene_gilt_noch([], {}) is False


def test_ein_paar_prozent_daneben_sind_kein_verlassen() -> None:
    """Dimmer runden, und Storen halten selten genau auf dem Wert."""
    actions = [{"entity_id": "store", "command": "set_position", "data": {"position": 50}}]
    stand = {"store": geraet("cover", ["set_position"], {"position": 51})}
    assert szene_gilt_noch(actions, stand) is True
    stand["store"]["state"]["position"] = 80
    assert szene_gilt_noch(actions, stand) is False
