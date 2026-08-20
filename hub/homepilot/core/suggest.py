"""Szenen vorschlagen, statt sie erfinden zu lassen.

Wer jeden Abend dieselben drei Lampen einschaltet, hat längst eine
Szene – sie steht nur nirgends. Der Hub sieht das Muster ohnehin: Im
Verlauf steht, was wann von Hand geschaltet wurde.

Was hier NICHT passiert: Es wird nichts automatisch angelegt und nichts
automatisch geschaltet. Der Vorschlag ist ein Satz in der App mit einem
Knopf daneben. Eine Hausautomation, die von selbst Regeln erfindet, ist
genau die, der man nach dem zweiten Mal nicht mehr traut.

Erkannt wird bewusst grob:

- Nur Handbedienung zählt. Was ein Ablauf geschaltet hat, ist schon
  automatisiert – daraus einen Vorschlag zu bauen wäre ein Zirkel.
- Es zählt die Stunde, nicht die Minute. Niemand schaltet drei Tage
  hintereinander um exakt 19:03.
- Erst ab drei Tagen. Zweimal ist Zufall.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any

# Ab so vielen verschiedenen Tagen gilt es als Gewohnheit.
MIN_DAYS = 3
# So viele Geräte braucht ein Vorschlag mindestens - ein einzelnes Licht
# ist keine Szene, sondern ein Schalter.
MIN_ENTITIES = 2
# Und höchstens so viele, sonst wird aus «Abendlicht» ein Abbild der
# ganzen Wohnung.
MAX_ENTITIES = 8


def _local(at: Any) -> datetime | None:
    """Zeitstempel des Verlaufs (Unix-Zeit) als lokale Zeit (rein).

    Lokal und nicht UTC: «gegen sieben Uhr abends» ist eine Aussage über
    die Wohnung, nicht über Greenwich.
    """
    try:
        return datetime.fromtimestamp(float(at))
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _source_kind(event: dict[str, Any]) -> str:
    quelle = event.get("source")
    if isinstance(quelle, dict):
        return str(quelle.get("kind") or "")
    return str(event.get("source_kind") or "")


def find_pattern(
    events: list[dict[str, Any]], min_days: int = MIN_DAYS
) -> dict[str, Any] | None:
    """Die auffälligste Gewohnheit im Verlauf (rein, testbar).

    Ein Ereignis ist ein Wörterbuch mit ``entity_id``, ``at``, ``state``
    und ``source_kind``. Zurück kommt der Vorschlag oder None – und None
    ist der Normalfall: Die meisten Haushalte haben keine so klare
    Gewohnheit, und dann soll nichts vorgeschlagen werden.
    """
    # Stunde → Gerät → Menge der Tage, an denen es zu dieser Stunde von
    # Hand eingeschaltet wurde.
    tage: dict[int, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for event in events:
        # Nur Handbedienung: Was ein Ablauf geschaltet hat, ist schon
        # automatisiert - daraus einen Vorschlag zu bauen wäre ein Zirkel.
        if _source_kind(event) not in ("app", "user", ""):
            continue
        if str(event.get("state") or "").lower() not in ("on", "an"):
            continue
        zeit = _local(event.get("at"))
        gerät = str(event.get("entity_id") or "")
        if zeit is None or not gerät:
            continue
        tage[zeit.hour][gerät].add(zeit.strftime("%Y-%m-%d"))

    bester: dict[str, Any] | None = None
    for stunde, geräte in tage.items():
        treffer = sorted(
            (
                (gerät, len(tagemenge))
                for gerät, tagemenge in geräte.items()
                if len(tagemenge) >= min_days
            ),
            key=lambda paar: (-paar[1], paar[0]),
        )
        if len(treffer) < MIN_ENTITIES:
            continue
        ausgewählt = treffer[:MAX_ENTITIES]
        # Die Stärke ist die Zahl der Tage, an denen ALLE beteiligt waren -
        # das schwächste Glied entscheidet, sonst zöge ein einzelnes
        # häufiges Gerät einen schwachen Vorschlag nach oben.
        stärke = min(anzahl for _, anzahl in ausgewählt)
        if bester is None or stärke > bester["days"]:
            bester = {
                "hour": stunde,
                "entity_ids": [gerät for gerät, _ in ausgewählt],
                "days": stärke,
            }
    return bester


def describe(pattern: dict[str, Any], names: dict[str, str]) -> str:
    """Ein Satz für die App (rein)."""
    geräte = [names.get(gerät, gerät) for gerät in pattern["entity_ids"]]
    letzte = geräte[-1]
    aufzählung = (
        letzte if len(geräte) == 1 else f"{', '.join(geräte[:-1])} und {letzte}"
    )
    return (
        f"An {pattern['days']} Tagen hast du gegen {pattern['hour']:02d} Uhr "
        f"{aufzählung} eingeschaltet. Als Szene sichern?"
    )
