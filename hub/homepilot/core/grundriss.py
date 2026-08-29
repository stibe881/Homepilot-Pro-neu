"""Der Grundriss: ein Bild der Wohnung, darauf die Geräte als Punkte.

Fürs Wandpanel gedacht: Wer im Flur aufs iPad schaut, denkt nicht in
einer Kachelliste, sondern in «das Licht da hinten links». Ein Foto des
Wohnungsplans mit antippbaren Punkten beantwortet das direkt.

Das Bild liegt als Datei neben der Datendatei (wie die Rezeptbilder,
Punkt 193) - in ``hub.data`` ginge es bei jedem Öffnen komplett über
die Leitung. Die Punkte dagegen sind ein paar Zahlen und liegen in
``hub.data``: Sie überleben so den Neustart und jede Auslieferung.

Die Positionen sind Brüche (0…1) der Bildkanten, keine Pixel: Das
Panel im Flur, das iPhone und der Browser zeigen dasselbe Bild in
verschiedenen Grössen, und ein Punkt «bei 0.3/0.7» sitzt überall auf
derselben Türe.
"""

from __future__ import annotations

from typing import Any

#: Wo die Punkte liegen (siehe persistence.py).
STORE_KEY = "grundriss_punkte"

#: Mehr Geräte hat kein Haushalt sinnvoll auf einem Plan - die Grenze
#: schützt die Datendatei vor einer ausser Kontrolle geratenen App.
MAX_PUNKTE = 200


def punkte_bereinigen(roh: Any) -> list[dict[str, Any]]:
    """Aus dem, was die App schickt, die gültigen Punkte (rein, testbar).

    Behalten wird nur, was vollständig und plausibel ist: eine
    Entitäts-Kennung und beide Koordinaten im Bild (0…1). Alles andere
    fällt still weg statt gespeichert zu werden - ein Punkt bei x=7
    läge ausserhalb jedes Bildes und wäre auf keinem Gerät je zu sehen,
    also auch nie zu korrigieren.

    Je Gerät gilt der letzte Punkt: Wer beim Anpassen zweimal auf den
    Plan tippt, meint die zweite Stelle.
    """
    if not isinstance(roh, list):
        return []
    punkte: dict[str, dict[str, Any]] = {}
    for eintrag in roh:
        if not isinstance(eintrag, dict):
            continue
        entity_id = str(eintrag.get("entity_id") or "").strip()
        if not entity_id or len(entity_id) > 100:
            continue
        try:
            x = float(eintrag.get("x"))
            y = float(eintrag.get("y"))
        except (TypeError, ValueError):
            continue
        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
            continue
        # Vier Nachkommastellen: auf einem 13-Zoll-Panel ein Zehntel
        # Millimeter - genauer tippt niemand, und die Datendatei bleibt
        # lesbar.
        punkte[entity_id] = {
            "entity_id": entity_id,
            "x": round(x, 4),
            "y": round(y, 4),
        }
    return list(punkte.values())[:MAX_PUNKTE]
