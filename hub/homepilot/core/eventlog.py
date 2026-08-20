"""Ereignisprotokoll je Gerät: wann schaltete es, und wer war es.

Der Verlauf auf der Startseite zeigt alles durcheinander und lebt nur in
der App - nach dem nächsten Öffnen ist er leer. Für die Frage «warum ging
dieses Licht um drei Uhr an?» braucht es das Gedächtnis auf dem Hub: je
Gerät, mit Quelle (Benutzer, Ablauf, Szene, Simulation - oder das Gerät
selbst, wenn jemand am Schalter gedrückt hat).

Bewusst im Speicher, nicht auf der Platte: 2000 Einträge decken bei einem
normalen Haushalt mehrere Tage, und ein Protokoll, das jede Minute auf
die Platte schreibt, wäre genau die Sorte Dauerlast, vor der der
Speicherplatz-Wächter warnt. Nach einem Neustart beginnt es leer - das
steht auch so in der App.
"""

from __future__ import annotations

import time
from collections import deque
from typing import Any

# So viele Ereignisse insgesamt. Ein Ringpuffer: Das älteste fällt raus.
LIMIT = 2000

# Nur Gerätearten, bei denen ein Zustandswechsel eine Handlung ist.
# Sensoren (Temperatur, Helligkeit) ändern sich im Minutentakt und würden
# den Puffer fluten, ohne die Warum-Frage je zu beantworten - für sie
# gibt es die Messwert-Kurve.
KINDS = frozenset(
    {
        "light",
        "switch",
        "cover",
        "lock",
        "climate",
        "vacuum",
        "appliance",
        "media_player",
        "binary_sensor",
        "alarm",
    }
)


def worth_recording(kind: str, old: dict[str, Any], new: dict[str, Any]) -> bool:
    """Gehört dieser Wechsel ins Protokoll? (rein, testbar)

    Nur echte Zustandswechsel («on» → «off»), keine Attribut-Zappelei wie
    eine neue Helligkeit beim ohnehin brennenden Licht.
    """
    if kind not in KINDS:
        return False
    return str(old.get("state")) != str(new.get("state"))


class EventLog:
    def __init__(self) -> None:
        self._events: deque[dict[str, Any]] = deque(maxlen=LIMIT)

    def record(self, _event_type: str, data: dict[str, Any]) -> None:
        """Bus-Listener für state_changed - still bei allem Unpassenden."""
        entity = data.get("entity") or {}
        kind = str(entity.get("kind") or "")
        old = data.get("old_state") or {}
        new = data.get("new_state") or {}
        if not worth_recording(kind, old, new):
            return
        source = data.get("source") or {}
        self._events.append(
            {
                "entity_id": str(data.get("entity_id") or ""),
                "state": new.get("state"),
                "at": time.time(),
                "source": {
                    "kind": source.get("kind"),
                    "label": source.get("label"),
                },
            }
        )

    def all(self) -> list[dict[str, Any]]:
        """Alle gemerkten Ereignisse, älteste zuerst.

        Für die Musterkennung (core/suggest.py). Der Ring hält rund 2000
        Ereignisse und überlebt keinen Neustart - was hier steht, ist die
        jüngere Vergangenheit, nicht das Archiv.
        """
        return list(self._events)

    def for_entity(self, entity_id: str, limit: int = 50) -> list[dict[str, Any]]:
        """Die letzten Ereignisse eines Geräts, jüngste zuerst."""
        found = [
            event for event in self._events if event["entity_id"] == entity_id
        ]
        return list(reversed(found))[:limit]
