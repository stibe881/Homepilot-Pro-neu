"""Die reine Tuya-Logik: Datenpunkte, Farben, Helligkeiten (rein, testbar).

Herausgelöst aus tuya.py (Punkt 43 der Werkbank): alles, was sich ohne
Gerät entscheiden lässt - Zuordnungstabellen, Prozent- und
Mired-Umrechnung, das Farbformat, Fehlertexte. Die Integration daneben
spricht das Protokoll: Verbindung, Worker-Thread, Befehle.
"""

from __future__ import annotations

import ipaddress
from typing import Any

from ..core.entity import EntityKind
from ..core.errors import ConfigError

DEFAULT_DPS = {
    "switch": 20,
    "mode": 21,
    "brightness": 22,
    "color_temp": 23,
    "color": 24,
    "scene": 25,
}
LEGACY_DPS = {
    "switch": 1,
    "mode": 2,
    "brightness": 3,
    "color_temp": 4,
    "color": 5,
    "scene": 6,
}

# Tuya rechnet Helligkeit in 10..1000 (neuere Geräte) bzw. 25..255
# (ältere). Unten wird nicht auf 0 gegangen: Eine Lampe mit Helligkeit 0
# ist bei Tuya nicht aus, sondern kaputt anzusehen.
BRIGHTNESS_RANGE = (10, 1000)
LEGACY_BRIGHTNESS_RANGE = (25, 255)

# Farbtemperatur: Tuya zählt 0 (warm) bis 1000 (kalt), der Hub rechnet wie
# Hue in Mired. 2700 K sind 370 Mired, 6500 K sind 153.
MIRED_WARM = 370
MIRED_COLD = 153

# Wie oft ein Lebenszeichen nötig ist, damit das Gerät die Verbindung
# offen lässt. Tuya wirft nach etwa 30 Sekunden Stille hinaus.
HEARTBEAT_SECONDS = 9
# Vollständige Abfrage - nur als Rückfall. Der Regelfall ist, dass das
# Gerät Änderungen von selbst meldet.
REFRESH_SECONDS = 60


def dps_map(config: dict[str, Any]) -> dict[str, int]:
    """Welche Nummer welche Eigenschaft ist (rein, testbar).

    Voreingestellt ist die verbreitete Belegung; `legacy: true` schaltet
    auf die alte Zählweise um, und einzelne Nummern lassen sich darüber
    hinaus überschreiben. `null` schaltet eine Eigenschaft ab - nützlich
    für Geräte, die zwar eine Nummer belegen, aber Unsinn darunter führen.
    """
    basis = dict(LEGACY_DPS if config.get("legacy") else DEFAULT_DPS)
    for schluessel, wert in (config.get("dps") or {}).items():
        if wert is None:
            basis.pop(schluessel, None)
        else:
            basis[schluessel] = int(wert)
    return basis


def brightness_range(config: dict[str, Any]) -> tuple[int, int]:
    """Der Zahlenbereich der Helligkeit (rein, testbar)."""
    roh = config.get("brightness_range")
    if isinstance(roh, (list, tuple)) and len(roh) == 2:
        return (int(roh[0]), int(roh[1]))
    return LEGACY_BRIGHTNESS_RANGE if config.get("legacy") else BRIGHTNESS_RANGE


def to_percent(raw: Any, bereich: tuple[int, int]) -> int | None:
    """Tuya-Helligkeit in Prozent (rein, testbar)."""
    try:
        wert = float(raw)
    except (TypeError, ValueError):
        return None
    unten, oben = bereich
    if oben <= unten:
        return None
    anteil = (wert - unten) / (oben - unten)
    return max(0, min(100, round(anteil * 100)))


def from_percent(percent: Any, bereich: tuple[int, int]) -> int:
    """Prozent in Tuya-Helligkeit (rein, testbar)."""
    try:
        wert = float(percent)
    except (TypeError, ValueError):
        wert = 100.0
    wert = max(0.0, min(100.0, wert))
    unten, oben = bereich
    return round(unten + (oben - unten) * wert / 100)


def to_mired(raw: Any) -> int | None:
    """Tuya-Farbtemperatur (0 warm .. 1000 kalt) in Mired (rein, testbar)."""
    try:
        wert = float(raw)
    except (TypeError, ValueError):
        return None
    anteil = max(0.0, min(1.0, wert / 1000.0))
    return round(MIRED_WARM - anteil * (MIRED_WARM - MIRED_COLD))


def from_mired(mired: Any) -> int:
    """Mired in Tuya-Farbtemperatur (rein, testbar)."""
    try:
        wert = float(mired)
    except (TypeError, ValueError):
        wert = MIRED_WARM
    wert = max(MIRED_COLD, min(MIRED_WARM, wert))
    anteil = (MIRED_WARM - wert) / (MIRED_WARM - MIRED_COLD)
    return round(anteil * 1000)


def hsv_to_hex(h: float, s: float, v: float) -> str:
    """HSV in «#RRGGBB» (rein, testbar). h in Grad, s und v in 0..1."""
    h = h % 360
    s = max(0.0, min(1.0, s))
    v = max(0.0, min(1.0, v))
    c = v * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = v - c
    reihen = [(c, x, 0.0), (x, c, 0.0), (0.0, c, x), (0.0, x, c), (x, 0.0, c), (c, 0.0, x)]
    r, g, b = reihen[int(h // 60) % 6]
    return "#" + "".join(f"{round((wert + m) * 255):02X}" for wert in (r, g, b))


def hex_to_hsv(farbe: str) -> tuple[float, float, float]:
    """«#RRGGBB» in HSV (rein, testbar). h in Grad, s und v in 0..1."""
    text = str(farbe).strip().lstrip("#")
    if len(text) == 3:
        text = "".join(zeichen * 2 for zeichen in text)
    if len(text) != 6:
        raise ValueError(f"'{farbe}' ist keine Farbe der Form #RRGGBB")
    r, g, b = (int(text[i : i + 2], 16) / 255 for i in (0, 2, 4))
    gross, klein = max(r, g, b), min(r, g, b)
    spanne = gross - klein
    if spanne == 0:
        h = 0.0
    elif gross == r:
        h = (60 * ((g - b) / spanne)) % 360
    elif gross == g:
        h = 60 * ((b - r) / spanne) + 120
    else:
        h = 60 * ((r - g) / spanne) + 240
    return (h, 0.0 if gross == 0 else spanne / gross, gross)


def decode_color(roh: Any) -> str | None:
    """Tuyas Farbzeichenkette in «#RRGGBB» (rein, testbar).

    Zwei Formate sind im Umlauf: zwölf Zeichen (HHHH SSSS VVVV, neuere
    Geräte) und vierzehn (RRGGBB HHHH SS VV, ältere). Beim langen wären
    die ersten sechs Zeichen schon die Antwort - gerechnet wird trotzdem
    aus HSV, weil manche Geräte das RGB-Feld nicht mitführen.
    """
    text = str(roh or "").strip()
    try:
        if len(text) == 12:
            h = int(text[0:4], 16)
            s = int(text[4:8], 16) / 1000
            v = int(text[8:12], 16) / 1000
        elif len(text) == 14:
            h = int(text[6:10], 16)
            s = int(text[10:12], 16) / 255
            v = int(text[12:14], 16) / 255
        else:
            return None
    except ValueError:
        return None
    return hsv_to_hex(h, min(s, 1.0), min(v, 1.0))


def encode_color(farbe: str, *, legacy: bool = False) -> str:
    """«#RRGGBB» in Tuyas Farbzeichenkette (rein, testbar)."""
    h, s, v = hex_to_hsv(farbe)
    if legacy:
        roh = str(farbe).strip().lstrip("#").upper()
        if len(roh) == 3:
            roh = "".join(zeichen * 2 for zeichen in roh)
        return f"{roh}{round(h):04x}{round(s * 255):02x}{round(v * 255):02x}"
    return f"{round(h):04x}{round(s * 1000):04x}{round(v * 1000):04x}"


def light_state(
    dps: dict[str, Any], nummern: dict[str, int], bereich: tuple[int, int]
) -> dict[str, Any]:
    """Die gemeldeten Datenpunkte in einen Entitätszustand (rein, testbar).

    Nur was das Gerät wirklich schickt, landet im Zustand. Tuya meldet bei
    einer Änderung oft nur den einen geänderten Punkt - würde hier für
    jeden fehlenden ein Standardwert entstehen, überschriebe die nächste
    Meldung «heller» die Farbe mit Weiss.
    """
    zustand: dict[str, Any] = {}
    for name, nummer in nummern.items():
        schluessel = str(nummer)
        if schluessel not in dps:
            continue
        wert = dps[schluessel]
        if name == "switch":
            zustand["state"] = "on" if wert else "off"
        elif name == "brightness":
            prozent = to_percent(wert, bereich)
            if prozent is not None:
                zustand["brightness"] = prozent
        elif name == "color_temp":
            mired = to_mired(wert)
            if mired is not None:
                zustand["color_temp"] = mired
        elif name == "color":
            farbe = decode_color(wert)
            if farbe:
                zustand["color"] = farbe
        elif name == "mode":
            zustand["mode"] = str(wert)
    return zustand


# Was Tuya im Fehlerfall zurückgibt, ist eine Nummer. Die drei, die man
# beim Einrichten wirklich trifft, in Klartext - sonst sucht man nach
# «Err 914» und findet Forenbeiträge von 2019.
TUYA_ERRORS = {
    "901": "Das Gerät hat die Verbindung abgewiesen – meist ist die IP falsch.",
    "905": "Das Gerät antwortet nicht. Ist es am Strom und im selben Netz?",
    "914": (
        "Schlüssel oder Protokollfassung passen nicht. Zuerst die Länge des "
        "Schlüssels prüfen: genau 16 Zeichen, nicht 32 (das wäre die UUID). "
        "Sonst hilft --probe, alle Fassungen durchzuprobieren, und --cloud "
        "holt den Schlüssel frisch."
    ),
}


def error_hint(antwort: Any) -> str | None:
    """Aus Tuyas Fehlernummer einen brauchbaren Satz machen (rein, testbar)."""
    if not isinstance(antwort, dict):
        return None
    nummer = str(antwort.get("Err") or "").strip()
    return TUYA_ERRORS.get(nummer)


def is_error(antwort: Any) -> bool:
    """Ist das eine Fehlermeldung statt eines Zustands? (rein, testbar)

    Wichtig, weil tinytuya Fehler nicht wirft, sondern zurückgibt - und
    zwar sofort. Wer das für eine leere Antwort hält und weiterschleift,
    dreht sich tausendmal je Sekunde im Kreis.
    """
    return isinstance(antwort, dict) and bool(antwort.get("Error"))


def error_text(antwort: Any) -> str:
    """Was in der Warnung stehen soll (rein, testbar)."""
    hinweis = error_hint(antwort)
    if hinweis:
        return hinweis
    if isinstance(antwort, dict):
        return str(antwort.get("Error") or antwort)
    return str(antwort)


# Ein lokaler Tuya-Schlüssel ist ein AES-128-Schlüssel: genau sechzehn
# Zeichen. Alles andere weist tinytuya ab, noch bevor es das Gerät
# überhaupt anspricht - und antwortet mit derselben Nummer wie bei einer
# falschen Protokollfassung. Deshalb gehört die Länge geprüft, bevor
# jemand einen Abend lang Fassungen durchprobiert.
KEY_LENGTH = 16


def check_key(roh: Any) -> str:
    """Den lokalen Schlüssel prüfen, bevor irgendetwas versucht wird.

    Der häufigste Fehlgriff ist nicht ein Tippfehler, sondern das falsche
    Feld: Im Tuya-Entwicklerportal stehen neben dem lokalen Schlüssel
    auch die Geräte-UUID und ein «Secret», beide 32 Zeichen lang und
    beide sehen aus, als gehörten sie hierher. Wer eines davon einträgt,
    bekommt Fehler 914 - «Schlüssel oder Protokollfassung passen nicht» -
    und sucht danach an der Fassung.
    """
    text = str(roh or "").strip()
    if not text:
        raise ConfigError(
            "tuya: 'key' fehlt. Der lokale Schlüssel hat 16 Zeichen und "
            "kommt aus: python -m homepilot.integrations.tuya --cloud"
        )
    if len(text) != KEY_LENGTH:
        raise ConfigError(
            f"tuya: Der lokale Schlüssel hat {len(text)} Zeichen, nötig sind "
            f"{KEY_LENGTH}. Wahrscheinlich ist es die Geräte-UUID oder das "
            "«Secret» aus dem Tuya-Portal – beide sind 32 Zeichen lang und "
            "sehen genauso aus. Den richtigen zeigt: "
            "python -m homepilot.integrations.tuya --cloud (Feld 'key')."
        )
    return text


def check_address(roh: Any) -> str | None:
    """Die Adresse prüfen, bevor irgendetwas versucht wird (rein, testbar).

    «10.10.23» sieht wie eine Adresse aus und ist keine: Der Systemaufruf
    darunter macht daraus klaglos 10.10.0.23, und der Hub redet fortan
    mit dem falschen Gerät oder mit niemandem. Das Ergebnis ist eine
    Kachel, die «nie gesehen» sagt - die unbrauchbarste aller Auskünfte,
    weil sie nach einem Netzproblem aussieht.

    Leer heisst «keine Angabe», und das ist in Ordnung: Dann sucht der
    Hub das Gerät selbst.
    """
    text = str(roh or "").strip()
    if not text:
        return None
    try:
        ipaddress.ip_address(text)
    except ValueError:
        raise ConfigError(
            f"tuya: '{text}' ist keine gültige IP-Adresse. Eine IPv4-Adresse "
            "hat vier durch Punkte getrennte Zahlen (z.B. 10.10.1.23). Die "
            "richtige zeigt: python -m homepilot.integrations.tuya --scan – "
            "oder die Zeile weglassen, dann sucht der Hub das Gerät selbst."
        ) from None
    return text


def light_commands(nummern: dict[str, int], kind: str) -> list[str]:
    """Welche Kommandos das Gerät anbieten darf (rein, testbar).

    Nur was eine Nummer hat: Ein Knopf «Farbe» auf einer Steckdose wäre
    ein Versprechen, das der Hub nicht halten kann.
    """
    befehle = ["turn_on", "turn_off", "toggle"]
    if kind != EntityKind.LIGHT:
        return befehle
    if "brightness" in nummern:
        befehle.append("set_brightness")
    if "color_temp" in nummern:
        befehle.append("set_color_temp")
    if "color" in nummern:
        befehle.append("set_color")
    return befehle


