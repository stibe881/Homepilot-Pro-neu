"""Ein Prüfstand für die Häufigkeit einer Meldung.

Es gibt Tests dafür, *ob* eine Push kommt und wie sie heisst. Keinen
einzigen dafür, wie *oft*. Genau daran ist die Akku-Warnung
durchgerutscht: «Bines Telefon hat noch 0 %» kam alle paar Minuten,
während in der App daneben 65 % standen. Jeder einzelne Durchgang war
für sich richtig – erst die Reihe ergab den Fehler, und eine Reihe hat
niemand geprüft.

Der Prüfstand lässt den Wächter mehrere Runden laufen, lässt die Welt
sich dazwischen ändern und zählt, was dabei herauskommt. Damit ist
«genau einmal» eine Zusage, die man aufschreiben kann.

Benutzt wird er so:

    stand = Pushstand(hub)
    stand.welt([entity])
    await stand.runden(6, lambda n: entity.state.update(battery=0 if n % 2 else None))
    assert stand.wie_oft("Telefon fast leer") == 1

Bewusst über `watchdog.check()` und nicht über die einzelne Regel: Die
Meldung entsteht aus dem Zusammenspiel von Regel, Merker und Zustand,
und genau dort sass der Fehler – nicht in der Regel selbst.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any


def entitaet(
    entity_id: str,
    *,
    name: str | None = None,
    integration: str = "demo",
    available: bool = True,
    kind: str = "sensor",
    **zustand: Any,
) -> Any:
    """Eine Entität, wie der Wächter sie liest.

    Ein leichtes Objekt statt der echten Klasse: Der Wächter fragt nur
    nach `id`, `label`, `state` und `available` – und ein Test, der
    dafür ein halbes Haus aufbauen muss, wird nicht geschrieben.
    """
    return type(
        "E",
        (),
        {
            "id": entity_id,
            "name": name or entity_id,
            "label": name or entity_id,
            "kind": kind,
            "integration": integration,
            "available": available,
            "state": dict(zustand),
        },
    )()


class Geofence:
    """Ein Geofence, der nur weiss, welche Zone zu welcher Entität gehört.

    Mehr fragt der Wächter nicht ab. Den echten hochzufahren hiesse,
    Zonen, Koordinaten und einen Verlauf mitzuschleppen, von denen keiner
    zur Frage «wie oft kommt die Meldung» beiträgt.
    """

    def __init__(self, zonen: dict[str, str]) -> None:
        self._zonen = zonen

    def zone_ids(self) -> list[str]:
        return list(self._zonen)

    def zone_entity(self, zone_id: str) -> str | None:
        return self._zonen.get(zone_id)

    async def teardown(self) -> None:
        """Der Hub räumt beim Anhalten jede Integration ab – auch diese."""


class Pushstand:
    """Lässt den Wächter laufen und zählt, was er meldet."""

    def __init__(self, hub: Any) -> None:
        self.hub = hub
        self.meldungen: list[tuple[str, str]] = []

        async def sammeln(tokens, title, body, data=None, **_):
            self.meldungen.append((title, body))
            return len(tokens)

        hub.push.send = sammeln  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[pruefstand]", "Prüfstand")

    def welt(self, entities: list[Any]) -> None:
        """Welche Geräte der Wächter sieht.

        Auch `get` wird umgelegt, nicht nur `all`: Der Ortungs-Teil sucht
        seine Entitäten einzeln über die Zonen-Kennung.
        """
        nach_id = {entity.id: entity for entity in entities}
        self.hub.registry.all = lambda: list(entities)  # type: ignore[assignment]
        self.hub.registry.get = nach_id.get  # type: ignore[assignment]

    def geofence(self, zonen: dict[str, str]) -> None:
        """Einen Geofence unterschieben, der nur die Zonen kennt.

        Über die interne Tabelle des Verwalters, nicht über `setup_all`:
        Der echte Geofence brächte Koordinaten, einen Verlauf und eine
        Datei mit – nichts davon trägt zur Frage bei, wie oft eine
        Meldung kommt.
        """
        self.hub.integrations._integrations["geofence"] = Geofence(zonen)

    async def runden(
        self, anzahl: int, vorher: Callable[[int], None] | None = None
    ) -> None:
        """`anzahl` Runden des Wächters, dazwischen darf sich die Welt ändern.

        `vorher` bekommt die Rundennummer (ab 1) – so lässt sich ein
        Wechselspiel nachstellen: einmal ein Wert, einmal keiner, wieder
        ein Wert. Genau daran hing der Fehler.
        """
        for nummer in range(1, anzahl + 1):
            if vorher:
                vorher(nummer)
            await self.hub.watchdog.check()

    def wie_oft(self, titel: str) -> int:
        """Wie oft eine Meldung mit diesem Titel kam."""
        return sum(1 for gemeldet, _ in self.meldungen if gemeldet == titel)

    def titel(self) -> list[str]:
        """Alle Titel in der Reihenfolge, in der sie kamen."""
        return [gemeldet for gemeldet, _ in self.meldungen]

    def texte(self, titel: str) -> list[str]:
        return [text for gemeldet, text in self.meldungen if gemeldet == titel]
