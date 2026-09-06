"""Zigbee-Funkqualität: den Abstieg sehen, bevor das Gerät verstummt.

Jede Zigbee-Meldung trägt eine ``linkquality`` mit (0-255), und bisher
las sie niemand (Punkt 230 der Werkbank). Dabei ist sie die Frühwarnung
schlechthin: Ein Gerät, dessen Wert seit Wochen fällt - die neue
Metalltüre, das umgestellte Regal, der ausgesteckte Repeater -,
verstummt irgendwann ganz. Und dann sucht man den Fehler bei der
Batterie, denn die ist es sonst immer.

Die Bauart ist die der Batterieprognose (batterieprognose.py): **ein
Stand je Gerät und Woche**, defensiv gelesen, und eine Aussage erst,
wenn die Reihe sie trägt. Zwei Unterschiede, beide mit Grund:

- Je Woche zählt das **Mittel**, nicht der letzte Wert. Ein Batteriestand
  fällt ruhig; linkquality springt zwischen zwei Meldungen desselben
  Geräts um Dutzende Punkte (Mehrwege, jemand steht im Weg). Der letzte
  Wert der Woche wäre ein Münzwurf.
- Ein Sprung nach oben beginnt **keine** neue Reihe. Bei der Batterie
  heisst er «gewechselt», und die alte sagt nichts über die neue; der
  Funkweg bleibt derselbe, und die Erholung gehört zum Verlauf.
"""

from __future__ import annotations

from datetime import date
from typing import Any

#: Wo die Wochenmittel liegen (hub.data).
STORE_KEY = "linkquality_verlauf"

#: Wo steht, was schon gemeldet wurde. Der Schlüssel wohnt hier wie bei
#: batterie.py: Wächter und Routen brauchen ihn beide.
MELDUNG_KEY = "linkquality_gemeldet"

#: So viele Wochenwerte je Gerät bleiben stehen - ein halbes Jahr, wie
#: bei den Batterien: Funkwege verschlechtern sich über Wochen, nicht
#: über Stunden, und mehr Verlauf braucht die Rechnung nicht.
WOCHEN = 26

#: So viele Wochen gehen höchstens in jede Seite des Vergleichs
#: (Anfang der Reihe gegen Ende). Vier Wochen glätten den einzelnen
#: schlechten Tag weg, ohne den Abstieg zu verschleppen.
FENSTER = 4

#: Erst ab so vielen Wochenwerten über mindestens so viele Tage gibt es
#: eine Aussage. Unter drei Wochen Daten wäre der Trend geraten - die-
#: selbe Vorsicht wie bei der Batterieprognose (zwei Punkte, keine Kurve).
MIN_WERTE = 3
MIN_TAGE = 21

#: Unter diesem Wert (von 255) gilt der Funk als kritisch: Dort beginnen
#: in der Praxis Meldungen zu verschwinden, bevor das Gerät ganz
#: verstummt - genau der Zustand, vor dem gewarnt werden soll.
KRITISCH = 30

#: Fällt das Mittel unter diesen Anteil des Ausgangswerts, ist das ein
#: Abstieg und kein Rauschen - die Hälfte, wie in Punkt 230 angedacht.
ANTEIL = 0.5

#: Eine Halbierung zählt aber nur, wenn sie *unter* diesem Wert landet:
#: Von 255 auf 127 ist immer noch ein grundsolider Funkweg, und eine
#: Meldung darüber wäre Lärm, den man abbestellt. Unter 100 beginnt der
#: Bereich, in dem einzelne Meldungen schon einmal verloren gehen.
GENUG = 100

#: Erst ab diesem Unterschied (Punkte) ist eine Richtung eine Richtung.
#: linkquality wackelt von Natur aus; wer feiner liest, liest Rauschen.
MIN_SCHRITT = 10


def _woche(tag: date) -> str:
    jahr, woche, _ = tag.isocalendar()
    return f"{jahr}-W{woche:02d}"


def _zahl(wert: Any) -> float:
    try:
        return float(wert or 0)
    except (TypeError, ValueError):
        return 0.0


def aufnehmen(
    rows: Any, entity_id: str, wert: float, heute: date
) -> list[dict[str, Any]]:
    """Den Wochenstand eines Geräts vermerken (rein, testbar).

    Innerhalb der Woche wird laufend gemittelt (``lqi`` ist das Mittel,
    ``n`` zählt die Stichproben) - warum das Mittel und nicht der letzte
    Wert, steht im Kopf der Datei.
    """
    woche = _woche(heute)
    eigene = [
        row
        for row in (rows or [])
        if isinstance(row, dict) and row.get("entity_id") == entity_id
    ]
    fremde = [
        row
        for row in (rows or [])
        if isinstance(row, dict) and row.get("entity_id") != entity_id
    ]
    if eigene and eigene[-1].get("week") == woche:
        letzte = eigene[-1]
        try:
            n = max(1, int(letzte.get("n") or 1))
        except (TypeError, ValueError):
            n = 1
        mittel = _zahl(letzte.get("lqi"))
        neu = mittel + (float(wert) - mittel) / (n + 1)
        eigene[-1] = {**letzte, "lqi": round(neu, 1), "n": n + 1}
    else:
        eigene.append(
            {"entity_id": entity_id, "week": woche, "lqi": float(wert), "n": 1}
        )
    return fremde + eigene[-WOCHEN:]


def _tage(von: str, bis: str) -> float:
    """Abstand zweier ISO-Wochen in Tagen (rein)."""
    try:
        jahr1, woche1 = von.split("-W")
        jahr2, woche2 = bis.split("-W")
        start = date.fromisocalendar(int(jahr1), int(woche1), 4)
        ende = date.fromisocalendar(int(jahr2), int(woche2), 4)
        return float((ende - start).days)
    except (ValueError, TypeError):
        return 0.0


def mittelwerte(rows: Any, entity_id: str) -> tuple[float, float] | None:
    """Ausgangs- und aktuelles Wochenmittel der Reihe (rein, testbar).

    None heisst «keine Aussage»: zu wenig Verlauf. Die beiden Fenster
    (Anfang und Ende der Reihe, je höchstens ``FENSTER`` Wochen)
    überlappen nie - bei einer jungen Reihe entschieden sonst dieselben
    Werte über beide Seiten, und jeder Abstieg mittelte sich selbst weg.
    """
    eigene = [
        row
        for row in (rows or [])
        if isinstance(row, dict) and row.get("entity_id") == entity_id
    ]
    if len(eigene) < MIN_WERTE:
        return None
    erste = str(eigene[0].get("week") or "")
    letzte = str(eigene[-1].get("week") or "")
    if _tage(erste, letzte) < MIN_TAGE:
        return None
    werte = [_zahl(row.get("lqi")) for row in eigene]
    halbe = max(1, min(FENSTER, len(werte) // 2))
    von = sum(werte[:halbe]) / halbe
    auf = sum(werte[-halbe:]) / halbe
    return (von, auf)


def bewertung(rows: Any, entity_id: str) -> dict[str, int] | None:
    """«Funk wird schwach»? Dann die Entwicklung, sonst None (rein, testbar).

    Zwei Wege dorthin, beide im Kopf der Datei begründet: Das aktuelle
    Mittel liegt unter der kritischen Schwelle - oder es ist unter die
    Hälfte des Ausgangswerts gefallen *und* unter ``GENUG`` gelandet.
    """
    mittel = mittelwerte(rows, entity_id)
    if mittel is None:
        return None
    von, auf = mittel
    if auf < KRITISCH or (auf <= von * ANTEIL and auf < GENUG):
        return {"von": round(von), "auf": round(auf)}
    return None


def richtung(rows: Any, entity_id: str) -> str | None:
    """Fällt, hält oder steigt der Funk? (rein, testbar)

    None bei jungen Reihen. «steady» ist mit Absicht grosszügig: Erst
    ein Fünftel des Ausgangswerts (und mindestens ``MIN_SCHRITT``
    Punkte) Unterschied ist eine Richtung und kein Rauschen.
    """
    mittel = mittelwerte(rows, entity_id)
    if mittel is None:
        return None
    von, auf = mittel
    schritt = max(float(MIN_SCHRITT), von * 0.2)
    if auf <= von - schritt:
        return "falling"
    if auf >= von + schritt:
        return "rising"
    return "steady"


def erholt(rows: Any, entity_id: str, gemeldet_auf: Any) -> bool:
    """Hat sich der Funk deutlich erholt? Erst dann wird wieder scharf
    gestellt (rein, testbar).

    «Deutlich» heisst: mindestens das Doppelte des gemeldeten Werts und
    klar über der kritischen Schwelle. Wer nur knapp über die Schwelle
    zurückkriecht, pendelt sonst um sie herum - und jede Pendelbewegung
    würde zur nächsten Nachricht.
    """
    mittel = mittelwerte(rows, entity_id)
    if mittel is None:
        return False
    _, auf = mittel
    return auf >= max(2 * _zahl(gemeldet_auf), float(KRITISCH + 20))


def satz(von: float, auf: float) -> str:
    """Die Entwicklung als Satz (rein, testbar).

    Mit beiden Zahlen, wenn wirklich etwas gefallen ist - «von 180 auf
    40» sagt mehr als jedes Adjektiv. War der Funk schon immer schwach,
    gibt es keinen erfundenen Absturz zu erzählen.
    """
    von_i, auf_i = round(von), round(auf)
    if von_i - auf_i >= MIN_SCHRITT:
        return f"Funkqualität von {von_i} auf {auf_i} gefallen."
    return f"Funkqualität seit Wochen schwach ({auf_i} von 255)."


# ── Das Gedächtnis: was schon gemeldet wurde ─────────────────────────────
# Dasselbe Muster wie batterie.py: Zeilen rein, Zeilen raus, defensiv
# gelesen. Wo sie liegen (MELDUNG_KEY), weiss der Wächter.

#: So lange bleibt eine Zeile liegen, auch wenn das Gerät längst weg ist.
TAGE = 180

#: Obergrenze, damit ein Fehler in einer Schleife die Datei nicht sprengt.
HOECHSTENS = 500


def _zeilen(rows: Any) -> list[dict[str, Any]]:
    return [row for row in rows or [] if isinstance(row, dict) and row.get("entity_id")]


def gemeldet_zeile(rows: Any, entity_id: str) -> dict[str, Any] | None:
    """Was zu diesem Gerät gemeldet wurde – oder nichts (rein, testbar)."""
    for row in _zeilen(rows):
        if row.get("entity_id") == entity_id:
            return row
    return None


def merke_meldung(
    rows: Any, entity_id: str, auf: float, at: float
) -> list[dict[str, Any]]:
    """Diese Warnung ist raus (rein, testbar).

    ``auf`` reist mit: Daran misst ``erholt``, ob der Funk sich wirklich
    berappelt hat - und nicht nur an einer festen Schwelle.
    """
    grenze = at - TAGE * 24 * 3600
    behalten = [
        row
        for row in _zeilen(rows)
        if row.get("entity_id") != entity_id and _zahl(row.get("at")) >= grenze
    ]
    return [{"entity_id": entity_id, "at": at, "auf": float(auf)}, *behalten][:HOECHSTENS]


def vergiss(rows: Any, entity_ids: Any) -> list[dict[str, Any]]:
    """Der Funk hat sich erholt – die Warnung ist wieder scharf (rein, testbar)."""
    weg = set(entity_ids or [])
    return [row for row in _zeilen(rows) if row.get("entity_id") not in weg]
