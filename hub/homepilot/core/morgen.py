"""Die Morgen-Zusammenfassung: eine Nachricht statt sieben.

Der Wächter meldet jede Sache für sich, und das ist nachts richtig - ein
Wassermelder wartet nicht bis acht. Am Morgen ist es das Gegenteil: Sechs
Mitteilungen über schwache Batterien, ein offenes Fenster und einen
Ablauf, der nicht lief, wischt man weg, ohne sie zu lesen. Zusammen
gelesen ergeben dieselben sechs ein Bild.

Was hineingehört, richtet sich danach, was man am Morgen ändern kann:
ein Fenster schliessen, eine Batterie kaufen, einem stummen Gerät
nachgehen. Was in der Nacht schon gemeldet und erledigt wurde, gehört
nicht noch einmal hin.

Alles Rechnen steht hier als reine Funktion; wann sie läuft, entscheidet
der Wächter.
"""

from __future__ import annotations

import time
from typing import Any

#: Ereignisarten, die im Rückblick auf die Nacht etwas erklären. Ein
#: Licht, das um drei anging, ist eine Auskunft; eine Store, die um sechs
#: hochfuhr, ist der Ablauf, den man selbst gebaut hat.
NACHT_ARTEN = frozenset({"lock", "binary_sensor", "alarm"})


def in_der_nacht(
    ereignisse: list[dict[str, Any]],
    arten: dict[str, str],
    von: float,
    bis: float,
) -> list[dict[str, Any]]:
    """Was zwischen `von` und `bis` passierte (rein, testbar).

    Gefiltert auf das, was nachts etwas bedeutet: Türen, Fenster,
    Schlösser, die Alarmanlage. Ein Kühlschrank, der taktet, und eine
    Heizung, die regelt, gehören nicht in einen Rückblick - sie tun das
    jede Nacht.
    """
    raus: list[dict[str, Any]] = []
    for eintrag in ereignisse:
        wann = eintrag.get("at")
        if not isinstance(wann, (int, float)) or not von <= wann <= bis:
            continue
        if arten.get(str(eintrag.get("entity_id") or "")) not in NACHT_ARTEN:
            continue
        raus.append(eintrag)
    return sorted(raus, key=lambda eintrag: eintrag["at"])


def zeilen(
    *,
    offen: list[str],
    schwach: list[str],
    stumm: list[str],
    nacht: int,
    stille_ablaeufe: list[str],
    uv: str | None = None,
    regen: str | None = None,
    winter: str | None = None,
) -> list[str]:
    """Die Zeilen der Zusammenfassung (rein, testbar).

    Jede Zeile ist eine Sache, die man tun kann. Leere Abschnitte fallen
    weg - «0 offene Fenster» ist keine Auskunft, sondern Füllung.
    """
    raus: list[str] = []
    if offen:
        raus.append(
            ("Noch offen: " if len(offen) > 1 else "Noch offen: ") + ", ".join(offen)
        )
    if schwach:
        raus.append("Schwacher Akku: " + ", ".join(schwach))
    if stumm:
        raus.append("Meldet sich nicht: " + ", ".join(stumm))
    if nacht:
        raus.append(
            f"{nacht} Bewegung in der Nacht" if nacht == 1 else f"{nacht} Ereignisse in der Nacht"
        )
    if stille_ablaeufe:
        raus.append("Lief nicht: " + ", ".join(stille_ablaeufe))
    if winter:
        # Vor UV und Regen: Wer kratzen muss, muss als Erstes früher
        # los - das ist die Zeile, die den Morgen umstellt (Punkt 585).
        raus.append(winter)
    if uv:
        # Zuletzt: Das Fenster, das noch offen steht, ist der Handgriff
        # vor der Haustüre - die Sonnencreme kommt danach.
        raus.append(uv)
    if regen:
        # Und nach derselben Regel die Regenjacke (Punkt 584 der
        # Werkbank): nur an Tagen, an denen etwas in den Thek gehört.
        raus.append(regen)
    return raus


#: Ab so viel Neuschnee über Nacht kommt die Winterzeile (Punkt 585) -
#: derselbe Wert, ab dem der Losfahr-Wecker länger rechnet
#: (core/losfahren.py).
SCHNEE_AB_CM = 2.0

#: Wettercodes für gefrierenden Niesel und Regen (WMO 56/57, 66/67):
#: Glatteis kommt ohne einen Zentimeter Schnee.
GEFRIEREND = frozenset({56, 57, 66, 67})


def winter_hinweis(schnee_cm: Any, code: Any = None) -> str | None:
    """«Über Nacht 6 cm Schnee - Auto freikratzen, früher los» (rein, testbar).

    Ab zwei Zentimetern - darunter ist es ein Hauch, den die Sonne um
    acht wegnimmt. Gefrierender Regen zählt auch ohne Schnee: Dann ist
    die Strasse das Problem, nicht das Autodach. Sonst None - eine
    Winterzeile im Juli bestellte man ab.
    """
    try:
        cm = float(schnee_cm or 0)
    except (TypeError, ValueError):
        cm = 0.0
    try:
        gefrierend = int(code) in GEFRIEREND
    except (TypeError, ValueError):
        gefrierend = False
    if cm >= SCHNEE_AB_CM:
        zahl = f"{cm:.0f}" if cm == int(cm) else f"{cm:.1f}"
        return f"Über Nacht {zahl} cm Schnee - Auto freikratzen, früher los"
    if gefrierend:
        return "Gefrierender Regen - Glatteis, früher los"
    return None


def satz(zeilen_liste: list[str]) -> tuple[str, str] | None:
    """Titel und Text - oder None, wenn es nichts zu sagen gibt.

    Eine Zusammenfassung, die «alles in Ordnung» meldet, ist eine
    Nachricht, die man abbestellt. Sie kommt nur, wenn etwas dasteht.
    """
    if not zeilen_liste:
        return None
    titel = "Guten Morgen" if len(zeilen_liste) > 1 else "Am Morgen"
    return titel, "\n".join(f"· {zeile}" for zeile in zeilen_liste)


def nacht_fenster(jetzt: float, stunden: int = 12) -> tuple[float, float]:
    """Von wann bis wann «die Nacht» reicht (rein, testbar).

    Zurück bis zum Abend davor - nicht bis Mitternacht: Was um 23 Uhr
    aufging und noch offen ist, gehört in den Bericht.
    """
    return jetzt - max(1, stunden) * 3600, jetzt


def stille_ablaeufe(
    ablaeufe: list[dict[str, Any]],
    laeufe: list[dict[str, Any]],
    jetzt: float,
    tage: int = 7,
) -> list[str]:
    """Eingeschaltete Abläufe, die seit Tagen nicht liefen (rein, testbar).

    Nur eingeschaltete: Ein bewusst ausgeschalteter Ablauf soll nicht
    jeden Morgen daran erinnern, dass er aus ist. Und nur solche mit
    Auslöser - ein Ablauf, den man von Hand startet, läuft eben nur,
    wenn man ihn startet.
    """
    grenze = jetzt - max(1, tage) * 86400
    zuletzt: dict[str, float] = {}
    for lauf in laeufe:
        kennung = str(lauf.get("automation_id") or "")
        wann = lauf.get("at")
        if kennung and isinstance(wann, (int, float)):
            zuletzt[kennung] = max(zuletzt.get(kennung, 0.0), float(wann))
    raus: list[str] = []
    for ablauf in ablaeufe:
        if ablauf.get("enabled") is False or not ablauf.get("triggers"):
            continue
        kennung = str(ablauf.get("id") or "")
        if zuletzt.get(kennung, 0.0) < grenze:
            raus.append(str(ablauf.get("alias") or kennung))
    return raus


def faellig(stunde: int, jetzt: float | None = None) -> bool:
    """Ist die Meldestunde erreicht? (rein, testbar)"""
    stand = time.localtime(jetzt) if jetzt is not None else time.localtime()
    return stand.tm_hour == max(0, min(23, int(stunde)))
