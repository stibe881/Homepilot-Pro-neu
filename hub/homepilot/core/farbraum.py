"""Farben zwischen Hex und CIE xy umrechnen.

Die Philips-Hue-Bridge kennt kein «#FF8A00». Sie nimmt einen Punkt im
Farbraum CIE 1931 (``x``/``y``) entgegen und gibt ihn genauso zurück -
alle anderen Anbindungen im Haus (Zigbee2MQTT, Tuya, die Demo) sprechen
dagegen Hex, und die App tut es auch. Zwischen beidem steht diese
Datei, und sie steht in ``core/`` und nicht in ``integrations/hue.py``,
weil xy nicht Hue gehört: Es ist der Farbraum, den jede Zigbee-Lampe
darunter benutzt, und die nächste Anbindung, die ihn spricht, soll
nicht zweimal dieselbe Matrix hinschreiben.

Was hier bewusst **nicht** passiert: das Beschneiden auf den Farbraum
der einzelnen Lampe (das «Gamut»-Dreieck aus dem Datenblatt). Eine
Lampe kann kein reines Blau, sie kann ihr bestes Blau - und welches das
ist, weiss sie besser als wir. Die Bridge rechnet einen Punkt ausserhalb
selbst auf den nächstgelegenen erreichbaren; ihn hier vorher zu
verbiegen hiesse, dieselbe Rechnung ein zweites Mal zu machen, mit
Zahlen aus einer Tabelle, die veraltet, sobald eine neue Lampe
dazukommt.

Reines Rechnen, ohne Netz und ohne Hub.
"""

from __future__ import annotations

#: Helligkeit gehört nicht in die Farbe.
#:
#: xy trägt nur den Farbton; wie hell es wird, sagt bei Hue ``dimming``
#: und bei Zigbee ``brightness``. Beim Rückweg wird deshalb auf die
#: hellste Fassung derselben Farbe normiert - sonst käme aus einem
#: gedimmten Rot ein dunkles Braun, und in der App wäre kein Punkt mehr
#: markiert.
HELL = 1.0


def _linear(kanal: float) -> float:
    """sRGB-Gamma herausrechnen (rein, testbar)."""
    return (
        ((kanal + 0.055) / 1.055) ** 2.4 if kanal > 0.04045 else kanal / 12.92
    )


def _gamma(kanal: float) -> float:
    """Und wieder hinein (rein, testbar)."""
    return (
        1.055 * (kanal ** (1 / 2.4)) - 0.055 if kanal > 0.0031308 else 12.92 * kanal
    )


def hex_lesen(wert: object) -> tuple[int, int, int] | None:
    """«#ff8a00» → (255, 138, 0) (rein, testbar).

    Nachsichtig gegenüber dem, was aus einer config.yaml oder von der
    App kommt: mit und ohne Raute, drei- oder sechsstellig. Was keine
    Farbe ist, ergibt ``None`` statt einer erfundenen.
    """
    if not isinstance(wert, str):
        return None
    text = wert.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(zeichen * 2 for zeichen in text)
    if len(text) != 6:
        return None
    try:
        return (
            int(text[0:2], 16),
            int(text[2:4], 16),
            int(text[4:6], 16),
        )
    except ValueError:
        return None


def hex_zu_xy(wert: object) -> tuple[float, float] | None:
    """Eine Hex-Farbe als Punkt im CIE-Farbraum (rein, testbar).

    ``None`` heisst: Das war keine Farbe - dann soll der Aufrufer nichts
    schicken, statt die Lampe auf ein erfundenes Weiss zu stellen.
    """
    rgb = hex_lesen(wert)
    if rgb is None:
        return None
    rot, gruen, blau = (_linear(kanal / 255.0) for kanal in rgb)
    # Die Matrix aus Philips' eigener Anleitung («Wide RGB D65»).
    x_gross = rot * 0.664511 + gruen * 0.154324 + blau * 0.162028
    y_gross = rot * 0.283881 + gruen * 0.668433 + blau * 0.047685
    z_gross = rot * 0.000088 + gruen * 0.072310 + blau * 0.986039
    summe = x_gross + y_gross + z_gross
    if summe <= 0:
        # Schwarz hat keinen Farbort. Eine Lampe schaltet man dafür aus,
        # und genau das soll der Aufrufer tun - nicht «Schwarz leuchten».
        return None
    return (round(x_gross / summe, 4), round(y_gross / summe, 4))


def xy_zu_hex(x: float, y: float) -> str:
    """Der Rückweg, auf die hellste Fassung normiert (rein, testbar).

    Für die App: Sie markiert den Punkt in der Farbreihe, der dem
    gemeldeten Farbort am nächsten liegt - dafür braucht sie Hex.
    """
    try:
        x_wert = float(x)
        y_wert = float(y)
    except (TypeError, ValueError):
        return "#ffffff"
    if y_wert <= 0:
        return "#ffffff"
    z_wert = 1.0 - x_wert - y_wert
    y_gross = HELL
    x_gross = (y_gross / y_wert) * x_wert
    z_gross = (y_gross / y_wert) * z_wert
    rot = x_gross * 1.656492 - y_gross * 0.354851 - z_gross * 0.255038
    gruen = -x_gross * 0.707196 + y_gross * 1.655397 + z_gross * 0.036152
    blau = x_gross * 0.051713 - y_gross * 0.121364 + z_gross * 1.011530
    kanaele = [_gamma(max(0.0, kanal)) for kanal in (rot, gruen, blau)]
    groesster = max(kanaele)
    if groesster > 1.0:
        # Nicht abschneiden, sondern gleichmässig herunterziehen:
        # Abschneiden verschöbe den Farbton (aus Rot würde Rosa).
        kanaele = [kanal / groesster for kanal in kanaele]
    return "#" + "".join(
        f"{max(0, min(255, round(kanal * 255))):02x}" for kanal in kanaele
    )
