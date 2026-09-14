"""Farbe an Hue-Lampen - und die Rechnung, die dafür nötig ist.

Aus dem Haus, mit Bild der Büro-Kacheln: «Man kann bei den Lichtern die
Farbe und die Weissheit nicht einstellen in den Kacheln. Es soll aber
auch nur da gehen, wo die Lampen dies unterstützen.»

Die App zeigte die Farbreihe schon immer - aber nur, wenn das Gerät
`set_color` kann. Die Hue-Anbindung bot diesen Befehl nie an: Sie las
`color_temperature` aus der Bridge und sonst nichts, und die Bridge
nimmt ohnehin kein Hex entgegen, sondern einen Farbort in CIE xy.
Beides steht jetzt hier.
"""

from homepilot.core.farbraum import hex_lesen, hex_zu_xy, xy_zu_hex
from homepilot.integrations.hue import light_body, xy_aus

# ── Der Farbraum für sich ──────────────────────────────────────────────────


def test_hex_und_zurueck_bleibt_dieselbe_farbe():
    """Der Weg hin und zurück ist die Grundlage dafür, dass in der App
    derselbe Punkt markiert ist, den man vorher getippt hat.

    Auf eine Stufe genau und nicht aufs Bit: Der Farbort wird auf vier
    Nachkommastellen gerundet, weil die Bridge ihn so führt - aus
    #ffd9a0 wird dabei #ffd9a1. Das ist keine Ungenauigkeit, die jemand
    sieht; die Wahl in der App vergleicht ohnehin nachsichtig.
    """
    for farbe in ("#ff0000", "#00ff00", "#ffffff", "#ffd9a0"):
        xy = hex_zu_xy(farbe)
        assert xy is not None
        zurueck = hex_lesen(xy_zu_hex(*xy))
        vorher = hex_lesen(farbe)
        assert zurueck is not None and vorher is not None
        assert all(abs(a - b) <= 1 for a, b in zip(zurueck, vorher, strict=True)), (
            farbe,
            xy_zu_hex(*xy),
        )


def test_ein_gedimmtes_rot_bleibt_rot():
    """xy trägt nur den Farbton; wie hell es wird, sagt `dimming`. Ohne
    die Normierung käme aus dunklem Rot ein Braun, und in der App wäre
    kein Punkt mehr markiert."""
    assert xy_zu_hex(*hex_zu_xy("#800000")) == "#ff0000"


def test_was_keine_farbe_ist_wird_auch_keine():
    """Lieber nichts schicken als die Lampe auf ein erfundenes Weiss
    stellen."""
    assert hex_zu_xy("kaputt") is None
    assert hex_zu_xy(None) is None
    assert hex_zu_xy("") is None
    # Schwarz hat keinen Farbort - dafür schaltet man aus.
    assert hex_zu_xy("#000000") is None


def test_kurzschreibweise_und_raute_sind_egal():
    assert hex_lesen("#f00") == (255, 0, 0)
    assert hex_lesen("ff0000") == (255, 0, 0)
    assert hex_lesen("#GG0000") is None


# ── Was die Bridge zu sehen bekommt ────────────────────────────────────────


def test_ein_farbtipp_schaltet_die_lampe_auch_ein():
    """So steht es in der App an der Farbreihe: «Ein Tipp schaltet ein
    und stellt die Farbe in einem Zug» - beim Sternenprojektor am Abend
    ist das der ganze Sinn. Ohne das bliebe die Lampe dunkel und die
    Farbe ein Versprechen fürs nächste Einschalten."""
    body = light_body("set_color", {"color": "#2e7cff"}, war_an=False)
    assert body["on"] == {"on": True}
    assert body["color"]["xy"]["x"] == 0.1507
    assert body["color"]["xy"]["y"] == 0.1356


def test_die_farbe_reist_im_selben_put_wie_das_einschalten():
    """Dieselbe Überlegung wie beim Weisston (Punkt 645): zwei PUTs
    heissen zwei Übergänge an der Lampe, und der zweite geht auf der
    Funkstrecke manchmal unter."""
    body = light_body("turn_on", {"brightness": 60, "color": "#ff0000"}, war_an=False)
    assert body == {
        "on": {"on": True},
        "dimming": {"brightness": 60.0},
        "color": {"xy": {"x": 0.7006, "y": 0.2993}},
    }


def test_farbe_schlaegt_weisston():
    """Eine Lampe leuchtet entweder bunt oder weiss. Kämen beide im
    selben PUT, entschiede die Bridge - und zwar je nach Lampe
    verschieden."""
    body = light_body("set_color", {"color": "#ff0000", "color_temp": 370}, war_an=True)
    assert "color" in body
    assert "color_temperature" not in body


def test_ohne_farbe_bleibt_der_put_wie_er_war():
    """Kein erfundenes Feld - und der Weisston-Weg bleibt unberührt."""
    assert light_body("turn_on", {"color_temp": 200}, war_an=False) == {
        "on": {"on": True},
        "color_temperature": {"mirek": 200},
    }
    assert light_body("turn_off", {"color": "#ff0000"}, war_an=True) == {
        "on": {"on": False}
    }


def test_eine_unlesbare_farbe_wird_nicht_geschickt():
    """Was aus einer von Hand geschriebenen config.yaml kommt, ist nicht
    immer eine Farbe."""
    assert xy_aus({"color": "himmelblau"}) is None
    assert xy_aus({}) is None
    assert light_body("set_color", {"color": "himmelblau"}, war_an=True) == {}
