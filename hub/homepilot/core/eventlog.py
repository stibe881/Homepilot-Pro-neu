"""Ereignisprotokoll je Gerät: wann schaltete es, und wer war es.

Der Verlauf auf der Startseite zeigt alles durcheinander und lebt nur in
der App - nach dem nächsten Öffnen ist er leer. Für die Frage «warum ging
dieses Licht um drei Uhr an?» braucht es das Gedächtnis auf dem Hub: je
Gerät, mit Quelle (Benutzer, Ablauf, Szene, Simulation - oder das Gerät
selbst, wenn jemand am Schalter gedrückt hat).

Gehalten wird es im Speicher und gesichert in einer eigenen Datei neben
der Datendatei. Hier stand einmal, das Protokoll sei bewusst flüchtig -
ein Schreibvorgang je Ereignis wäre Dauerlast. Das stimmt, beantwortet
aber die falsche Frage: Nicht jedes Ereignis muss auf die Platte,
sondern der Stand alle paar Minuten. Und ohne das war der Verlauf nach
jedem Update leer - also genau dann, wenn man ihn braucht, weil sich
etwas geändert hat.

Eine eigene Datei und nicht `hub.data`: Zweitausend Einträge sind ein
paar hundert Kilobyte, und die Datendatei wird bei jeder Kleinigkeit neu
geschrieben. Ein Protokoll gehört nicht in denselben Zug.
"""

from __future__ import annotations

import json
import logging
import time
from collections import deque
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# So viele Ereignisse insgesamt. Ein Ringpuffer: Das älteste fällt raus.
LIMIT = 2000

# So selten wird gesichert. Fünf Minuten heisst: Im schlimmsten Fall
# fehlen nach einem harten Absturz fünf Minuten Protokoll - und die
# Platte sieht statt Dauerlast einen Schreibvorgang je Kaffeepause.
SICHERUNGS_TAKT = 300.0

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
    def __init__(self, path: Path | str | None = None) -> None:
        self._events: deque[dict[str, Any]] = deque(maxlen=LIMIT)
        # Wann dieses Protokoll zu zählen begann. Ohne diesen Zeitpunkt
        # lässt sich «nichts aufgezeichnet» nicht von «nichts passiert»
        # unterscheiden: Beides sieht in der App gleich aus, meint aber
        # Gegenteiliges - einmal fehlt das Gedächtnis, einmal die Handlung.
        self.started = time.time()
        self._path = Path(path) if path else None
        self._letzte_sicherung = 0.0
        self._schmutzig = False
        if self._path is not None:
            self.load()

    # ── Auf die Platte und zurück ──────────────────────────────────────

    def load(self) -> None:
        """Das Protokoll des letzten Laufs holen.

        Ein kaputter oder halb geschriebener Stand ist kein Grund, den
        Hub nicht zu starten - dann beginnt das Protokoll eben leer, wie
        früher immer.
        """
        if self._path is None or not self._path.is_file():
            return
        try:
            roh = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as err:
            log.warning("Verlauf nicht lesbar (%s) - er beginnt neu", err)
            return
        ereignisse = roh.get("events") if isinstance(roh, dict) else None
        if not isinstance(ereignisse, list):
            return
        self._events.extend(
            eintrag for eintrag in ereignisse if isinstance(eintrag, dict)
        )
        # Der Anfang ist jetzt der des *ersten* Laufs, nicht dieses hier -
        # sonst behauptete die App, alles Ältere sei nie passiert.
        beginn = roh.get("started") if isinstance(roh, dict) else None
        if isinstance(beginn, (int, float)) and beginn > 0:
            self.started = float(beginn)
        log.info("Verlauf mit %d Einträgen geladen", len(self._events))

    def save(self, force: bool = False) -> None:
        """Den Stand sichern - gedrosselt, ausser beim Herunterfahren."""
        if self._path is None or not self._schmutzig:
            return
        jetzt = time.time()
        if not force and jetzt - self._letzte_sicherung < SICHERUNGS_TAKT:
            return
        self._letzte_sicherung = jetzt
        self._schmutzig = False
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            # Erst daneben, dann umbenennen: Ein Stromausfall mitten im
            # Schreiben soll nicht die Datei zerstören, die er sichern soll.
            neben = self._path.with_suffix(".tmp")
            neben.write_text(
                json.dumps(
                    {"started": self.started, "events": list(self._events)},
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            neben.replace(self._path)
        except OSError as err:
            log.warning("Verlauf nicht schreibbar: %s", err)

    def record(self, _event_type: str, data: dict[str, Any]) -> None:
        """Bus-Listener für state_changed - still bei allem Unpassenden."""
        entity = data.get("entity") or {}
        kind = str(entity.get("kind") or "")
        old = data.get("old_state") or {}
        new = data.get("new_state") or {}
        if not worth_recording(kind, old, new):
            return
        source = data.get("source") or {}
        self._schmutzig = True
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

    def span(self) -> dict[str, Any]:
        """Wie weit das Protokoll zurückreicht - und warum nicht weiter.

        Eine Kurve ohne diese Angabe ist nicht zu lesen: Zwei Einträge
        heissen entweder «hier passiert wenig» oder «der Hub lief erst
        zehn Minuten», und die App kann das von sich aus nicht wissen.

        `full` sagt, ob der Ring bereits übergelaufen ist. Dann ist der
        Anfang nicht mehr der Start des Hubs, sondern die Kante des
        Puffers - und älteres ist endgültig weg.
        """
        oldest = self._events[0]["at"] if self._events else None
        return {
            "started": self.started,
            "oldest": oldest,
            "count": len(self._events),
            "limit": LIMIT,
            "full": len(self._events) >= LIMIT,
        }
