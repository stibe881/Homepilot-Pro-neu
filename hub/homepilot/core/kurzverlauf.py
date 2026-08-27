"""Die letzten Stunden eines Messwerts – für die Funkenlinie auf der Kachel.

«21.5 °C» sagt nicht, ob es gerade wärmer oder kühler wird. Die kleine
Linie auf der Kachel sagt es – und dafür braucht es keinen
Datenbank-Verlauf (der hängt an Supabase und ist zwei Griffe entfernt),
sondern nur die letzten Stunden, im Speicher.

Bewusst flüchtig: Nach einem Neustart ist die Linie leer und füllt sich
wieder. Das ist der richtige Handel – ein Kurzverlauf, der eine eigene
Datei pflegt, wäre eine zweite Datenbank für eine Zierlinie.

Aufgenommen wird gedrosselt (alle paar Minuten ein Punkt): Ein Sensor,
der im Sekundentakt zappelt, soll die Linie nicht in Rauschen ertränken.
"""

from __future__ import annotations

import time
from typing import Any

#: So weit zurück reicht die Linie.
SPANNE = 3 * 3600.0
#: Frühestens alle so viele Sekunden ein neuer Punkt.
ABSTAND = 300.0
#: Obergrenze je Gerät - SPANNE/ABSTAND plus Luft.
HOECHSTENS = 48


def messwert(kind: str, state: dict[str, Any]) -> float | None:
    """Der Wert, den die Kachel gross zeigt (rein, testbar).

    Nur Sensoren: Bei ihnen *ist* der Zustand die Zahl. Ein Licht mit
    Helligkeit 80 ist keine Messreihe, sondern ein Schalter.
    """
    if kind != "sensor":
        return None
    try:
        return float(state.get("state"))
    except (TypeError, ValueError):
        return None


def aufnehmen(
    reihe: list[list[float]], wert: float, jetzt: float
) -> list[list[float]]:
    """Einen Punkt anhängen – gedrosselt und beschnitten (rein, testbar).

    Innerhalb des Abstands ersetzt der neue Wert den letzten Punkt,
    statt einen weiteren anzuhängen: So endet die Linie immer beim
    aktuellen Wert, ohne dass ein Zappel-Sensor sie flutet.
    """
    frisch = [punkt for punkt in reihe if jetzt - punkt[0] <= SPANNE]
    if frisch and jetzt - frisch[-1][0] < ABSTAND:
        frisch[-1] = [frisch[-1][0], wert]
    else:
        frisch.append([jetzt, wert])
    return frisch[-HOECHSTENS:]


class Kurzverlauf:
    """Hält die Reihen und hört auf dem Bus mit."""

    def __init__(self) -> None:
        self._reihen: dict[str, list[list[float]]] = {}

    async def record(self, _event_type: str, data: dict[str, Any]) -> None:
        entity = data.get("entity") or {}
        wert = messwert(str(entity.get("kind") or ""), data.get("new_state") or {})
        if wert is None:
            return
        entity_id = str(data.get("entity_id") or "")
        self._reihen[entity_id] = aufnehmen(
            self._reihen.get(entity_id, []), wert, time.time()
        )

    def alle(self) -> dict[str, list[list[float]]]:
        """Nur Reihen mit mindestens zwei Punkten - eine Linie aus einem
        Punkt ist keine."""
        return {
            entity_id: reihe
            for entity_id, reihe in self._reihen.items()
            if len(reihe) >= 2
        }
