"""Der Grill sagt Bescheid: «auf Temperatur» und «Fleisch ist so weit».

Gewünscht im Haus, mit einem Bild der Hersteller-App: «Diese Pushs will
ich auch. Wenn der Grill die Zieltemperatur erreicht hat, aber auch,
wenn ein Kerntemperaturmesser das Ziel erreicht hat.»

Zwei Momente, und sie meinen Verschiedenes:

- **Der Grill ist auf Temperatur.** Jetzt legt man das Fleisch auf.
  Erkannt an der Gartemperatur gegen den Sollwert - mit Spielraum, denn
  ein Pelletgrill pendelt um sein Ziel; ohne ihn käme die Meldung beim
  ersten Überschwinger und danach bei jedem weiteren.
- **Ein Fühler hat sein Ziel erreicht.** Jetzt nimmt man das Fleisch
  herunter, und *das* ist die Meldung, für die man beim Grillen aufs
  Telefon sieht. Ein Ziel je Fühler, denn am selben Abend liegen
  Nackenstück und Poulet nebeneinander.

**Warum die Fühlerziele beim Hub liegen.** Die Steuerplatine meldet je
Fühler nur die Temperatur (`integrations/pitboss.py`,
`probe_temperatures`). Ob sie auch ein Ziel führt, weiss erst ein Blick
auf ihren rohen Zustand - `grillcheck` druckt ihn. Solange das offen
ist, gehört das Ziel dorthin, wo es sicher überlebt: in die Datendatei
des Hubs. Wer es später von der Platine holen will, tauscht hier eine
Zeile.

Und zwar als **Zeilen**: `hub.data` führt Listen (`core/persistence.py`),
und was man ihm als Wörterbuch gibt, kommt als Liste seiner Schlüssel
zurück.

**Gemeldet wird die Flanke, nicht der Zustand.** «Ist über dem Ziel» ist
zwanzig Minuten lang wahr, und zwanzig Minuten lang jede Runde zu melden
wäre kein Hinweis, sondern ein Wecker. Gemerkt wird deshalb, was schon
gemeldet ist; zurückgesetzt wird es, wenn der Wert wieder deutlich
darunter liegt - oder wenn der Grill ausgeht.

Alle Funktionen hier sind rein; den Takt und den Versand übernimmt der
Wächter (core/watchdog.py, _check_grill).
"""

from __future__ import annotations

from typing import Any

#: Wie nah an den Sollwert der Grill heran muss, damit er als «auf
#: Temperatur» gilt.
#:
#: Ein Pelletgrill regelt über die Förderschnecke und pendelt dabei um
#: sein Ziel. Ohne Spielraum käme die Meldung erst beim ersten
#: Überschwinger - und die Live-Karte sagte derweil längst «Hält 110°».
#: Beide lesen darum dieselbe Zahl (core/livekarten.py).
SPIELRAUM = 2.0

#: Wie weit ein Wert wieder fallen muss, bevor derselbe Hinweis erneut
#: kommen darf.
#:
#: Grösser als der Spielraum, und das mit Absicht: Sonst stünde die
#: Meldung beim Pendeln um den Sollwert im Wechsel an und aus.
RUECKFALL = 8.0


def auf_temperatur(ist: Any, ziel: Any) -> bool:
    """Hat der Grill seinen Sollwert erreicht? (rein, testbar)"""
    if ist is None or ziel is None:
        return False
    try:
        return float(ist) >= float(ziel) - SPIELRAUM
    except (TypeError, ValueError):
        return False


def wieder_offen(ist: Any, ziel: Any) -> bool:
    """Ist der Wert weit genug gefallen für einen neuen Hinweis? (rein, testbar)

    Wer den Sollwert hochdreht, soll die Meldung erneut bekommen -
    deshalb gemessen am Abstand zum Ziel und nicht an einer festen
    Temperatur.
    """
    if ist is None or ziel is None:
        return True
    try:
        return float(ist) < float(ziel) - RUECKFALL
    except (TypeError, ValueError):
        return True


def grillsatz(label: str, ziel: Any, einheit: str) -> tuple[str, str]:
    """Titel und Text für «der Grill ist auf Temperatur» (rein, testbar)."""
    return (
        f"{label} ist auf Temperatur",
        f"{label} hat seine {_zahl(ziel)}{einheit} erreicht.",
    )


def fuehlersatz(
    label: str, nummer: int, ist: Any, ziel: Any, einheit: str
) -> tuple[str, str]:
    """Titel und Text für «ein Fühler hat sein Ziel erreicht» (rein, testbar).

    Der Ist-Wert steht mit im Satz: Zwischen dem Erreichen und dem Blick
    aufs Telefon liegen Minuten, und in denen steigt die Kerntemperatur
    weiter. «Ziel 63° erreicht» allein liesse offen, ob es inzwischen 70
    sind.
    """
    return (
        f"Fühler {nummer} ist so weit",
        f"{label}: Fühler {nummer} hat {_zahl(ist)}{einheit} "
        f"(Ziel {_zahl(ziel)}{einheit}).",
    )


def _zahl(wert: Any) -> str:
    """Eine Temperatur ohne Nachkommastellen (rein, testbar)."""
    try:
        return str(round(float(wert)))
    except (TypeError, ValueError):
        return "?"


def fuehlerziele(zeilen: Any, entity_id: str) -> dict[int, float]:
    """Die gesetzten Ziele eines Grills (rein, testbar).

    Als **Zeilen** und nicht als verschachteltes Wörterbuch: `hub.data`
    führt Listen von Zeilen, `get` macht aus allem anderen `list(...)`.
    Ein Wörterbuch dort abzulegen ergab beim Lesen eine Liste seiner
    Schlüssel - der Wert war weg, und die Meldung kam nie. Gesehen ist
    das am laufenden Hub, nicht im Test: Der Test hatte dasselbe
    Wörterbuch angenommen wie der Code.
    """
    ziele: dict[int, float] = {}
    for zeile in zeilen or []:
        if not isinstance(zeile, dict) or zeile.get("entity_id") != entity_id:
            continue
        try:
            nummer = int(zeile["nummer"])
            ziel = float(zeile["ziel"])
        except (KeyError, TypeError, ValueError):
            continue
        if 1 <= nummer <= 4:
            ziele[nummer] = ziel
    return ziele


def ziel_setzen(
    zeilen: Any, entity_id: str, nummer: int, ziel: float | None
) -> list[dict[str, Any]]:
    """Ein Ziel eintragen, ändern oder wegnehmen (rein, testbar).

    `ziel=None` nimmt es weg - «kein Ziel» ist ein gültiger Wunsch.
    """
    behalten = [
        zeile
        for zeile in zeilen or []
        if isinstance(zeile, dict)
        and not (
            zeile.get("entity_id") == entity_id
            and str(zeile.get("nummer")) == str(nummer)
        )
    ]
    if ziel is None:
        return behalten
    return [
        *behalten,
        {"entity_id": entity_id, "nummer": int(nummer), "ziel": float(ziel)},
    ]
