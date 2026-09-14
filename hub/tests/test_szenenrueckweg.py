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


def test_zocken_schaltet_die_app_um_und_kommt_zurueck() -> None:
    """Der gemeldete Fall (Punkt 644): «Zocken» aktiviert bleibt in der
    App nicht aktiv - ein zweiter Druck löst die Szene bloss erneut aus,
    statt zur vorherigen App zurückzukehren.

    Der Grund: `launch_app` trägt die rohe Paket-ID (`data.app`), der
    Zustand vorher nur den übersetzten Anzeigenamen (`app`) - die beiden
    liessen sich nie vergleichen, und die Szene galt darum nie als «noch
    aktiv». Seit Punkt 644 führt der Zustand die Paket-ID zusätzlich roh
    mit (`app_id`, androidtv.tv_state), und genau die wird verglichen.
    """
    actions = [{"entity_id": "tv.stube", "command": "launch_app", "data": {"app": "com.sony.ps5"}}]
    lief_schon_ps5 = {
        "tv.stube": geraet(
            "media_player", ["turn_on", "turn_off", "launch_app"],
            {"state": "on", "app": "Netflix", "app_id": "com.sony.ps5"},
        )
    }
    lief_netflix = {
        "tv.stube": geraet(
            "media_player", ["turn_on", "turn_off", "launch_app"],
            {"state": "on", "app": "Netflix", "app_id": "com.netflix.ninja"},
        )
    }
    # Die Vorschau, die `ist_aktiv` befragt: Läuft die PS5 schon, gilt
    # die Szene als aktiv - lief noch Netflix, nicht.
    assert szene_gilt_noch(actions, lief_schon_ps5) is True
    assert szene_gilt_noch(actions, lief_netflix) is False
    # Nichts geändert, nichts zum Zurücknehmen.
    assert hat_sich_geaendert(lief_schon_ps5["tv.stube"]["state"], zielzustand(actions[0])) is False
    # Lief vorher Netflix, geht der zweite Druck dorthin zurück - nicht
    # bloss «Fernseher an», was das Spiel weiterlaufen liesse.
    assert plane_rueckweg(actions, lief_netflix) == [
        {"entity_id": "tv.stube", "command": "launch_app", "data": {"app": "com.netflix.ninja"}}
    ]


def test_eine_bridge_szene_gilt_nach_dem_aufruf_als_aktiv() -> None:
    """Derselbe Fehler wie bei «Zocken» (Punkt 644), diesmal bei einer
    Bridge-Szene: Der gemeldete Fall «Zocken / Kino» besteht nur aus
    `google_cast: turn_off` und `hue: activate` - und `activate` kannte
    `zielzustand` nicht. War der Cast schon aus, blieb kein einziges
    vorhersagbares Feld übrig, und die Szene galt nie als aktiv (Punkt
    650 der Werkbank).

    Die Hue-Szene selbst meldet sich nach dem Aufruf mit `state: "active"`
    (hue.py, demo.py) - genau das prüft `zielzustand` jetzt mit.
    """
    actions = [
        {"entity_id": "cast.wohnzimmer", "command": "turn_off"},
        {"entity_id": "hue.szene_kino", "command": "activate"},
    ]
    stand = {
        "cast.wohnzimmer": geraet("media_player", ["turn_off"], {"state": "off"}),
        "hue.szene_kino": geraet("scene", ["activate"], {"state": "active"}),
    }
    assert szene_gilt_noch(actions, stand) is True
    # Ist eine andere Szene inzwischen aktiv, gilt «Zocken / Kino» nicht
    # mehr - genau der Fall, den der Knopf anzeigen soll.
    stand["hue.szene_kino"]["state"]["state"] = "inactive"
    assert szene_gilt_noch(actions, stand) is False


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


def test_eine_nie_spielende_box_gilt_nach_pause_trotzdem_als_ruhig() -> None:
    """Der zweite Teil des gemeldeten Falls «Kino» (Punkt 650).

    Die Szene pausiert eine Cast-Box, die schon vor dem Aufruf nichts
    abspielte - «pausieren» ist an ihr ein Leerlauf, und sie meldet
    weiterhin `idle` oder `standby`, nie `paused`
    (integrations/google_cast.py, handle_command). Ohne die
    Gleichsetzung galt die Szene nie als aktiv, und ihr Rückweg hätte
    die Box fälschlich «angehalten».
    """
    actions = [{"entity_id": "cast.stube", "command": "pause"}]
    for ruhezustand in ("idle", "standby", "paused"):
        stand = {"cast.stube": geraet("media_player", ["play", "pause"], {"state": ruhezustand})}
        assert szene_gilt_noch(actions, stand) is True
    # Läuft die Box wirklich, hat die Szene sie verlassen.
    laeuft = {"cast.stube": geraet("media_player", ["play", "pause"], {"state": "playing"})}
    assert szene_gilt_noch(actions, laeuft) is False

    # Und beim Zurücknehmen: Eine Box, die schon ruhte, bleibt unangetastet.
    assert hat_sich_geaendert({"state": "idle"}, zielzustand(actions[0])) is False
    assert hat_sich_geaendert({"state": "standby"}, zielzustand(actions[0])) is False
    assert hat_sich_geaendert({"state": "playing"}, zielzustand(actions[0])) is True
    # Rückweg aus «standby»: dieselbe Gruppe wie «idle», derselbe Befehl.
    assert rueckbefehl("media_player", ["pause"], {"state": "standby"}) == {"command": "pause"}


def test_eine_cast_box_meldet_nach_turn_off_standby_nicht_aus() -> None:
    """Der dritte Teil des gemeldeten Falls «Zocken / Kino» (Punkt 653).

    `test_eine_bridge_szene_gilt_nach_dem_aufruf_als_aktiv` liess die
    Cast-Box nach `turn_off` `state: "off"` melden - das kommt bei einer
    echten Box nie vor. Sie kennt kein «aus», nur den Standby
    (integrations/google_cast.py, cast_state_name). `zielzustand`
    erwartet nach `turn_off` aber genau `"off"` - ohne Gleichsetzung
    scheiterte szene_gilt_noch an diesem einen Feld, selbst wenn die
    Hue-Szene (Punkt 650) längst als aktiv galt.
    """
    actions = [
        {"entity_id": "cast.wohnzimmer", "command": "turn_off"},
        {"entity_id": "hue.szene_kino", "command": "activate"},
    ]
    stand = {
        "cast.wohnzimmer": geraet("media_player", ["turn_off"], {"state": "standby"}),
        "hue.szene_kino": geraet("scene", ["activate"], {"state": "active"}),
    }
    assert szene_gilt_noch(actions, stand) is True
    # Lief die Box noch, hat die Szene sie nicht (mehr) im Griff.
    stand["cast.wohnzimmer"]["state"]["state"] = "playing"
    assert szene_gilt_noch(actions, stand) is False

    # War sie schon vor der Szene im Standby, hat «turn_off» nichts
    # geändert - nichts zum Zurücknehmen.
    assert hat_sich_geaendert({"state": "standby"}, zielzustand(actions[0])) is False
    assert hat_sich_geaendert({"state": "playing"}, zielzustand(actions[0])) is True
