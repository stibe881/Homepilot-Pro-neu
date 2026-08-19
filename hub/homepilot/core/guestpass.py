"""Einmal-Türöffnung: ein Link, der genau einmal und nur kurz gilt.

Der Fall: Der Paketbote steht vor der Türe, man selbst ist im Zug. Ein
Gastzugang wäre dafür zu viel – der könnte alles sehen und stünde noch
Tage später herum. Was gebraucht wird, ist ein Zettel mit genau einer
Befugnis, der sich nach Gebrauch selbst zerreisst.

Deshalb: eine zufällige Adresse, ein Gebrauch, ein Ablauf in Minuten.
Bewusst nur im Speicher – nach einem Neustart gilt kein einziger davon
mehr, und das ist die sichere Richtung.

Ein Link kann mehrere Türen öffnen. Wer im Mehrfamilienhaus wohnt,
braucht für ein Paket beides: Haustüre und Wohnungstüre. Zwei getrennte
Links wären hier nicht sicherer, nur unbrauchbar – der Bote bekäme zwei
Adressen und müsste im Treppenhaus die richtige erwischen.
"""

from __future__ import annotations

import secrets
import time
from typing import Any

# Voreinstellung und Obergrenze der Gültigkeit.
DEFAULT_MINUTES = 15
MAX_MINUTES = 120
# Mehr als das kann niemand sinnvoll gleichzeitig offen haben; älteste
# fliegen zuerst raus, damit ein Versehen den Speicher nicht füllt.
MAX_OPEN = 20


class Pass:
    __slots__ = ("token", "targets", "expires", "used_at", "created_by", "label")

    def __init__(
        self,
        token: str,
        targets: list[tuple[str, str]],
        expires: float,
        created_by: str,
        label: str = "",
    ) -> None:
        self.token = token
        # [(entity_id, command), …] – in dieser Reihenfolge ausgelöst.
        # Bei zwei Türen also erst die Haustüre, dann die Wohnungstüre;
        # umgekehrt stünde der Bote vor einer offenen Wohnung im
        # verschlossenen Haus.
        self.targets = list(targets)
        self.expires = expires
        self.used_at: float | None = None
        self.created_by = created_by
        self.label = label

    @property
    def entity_id(self) -> str:
        """Das erste Ziel – für Protokoll und Anzeige, wo eines genügt."""
        return self.targets[0][0] if self.targets else ""

    @property
    def command(self) -> str:
        return self.targets[0][1] if self.targets else ""

    def as_dict(self, base_url: str | None = None) -> dict[str, Any]:
        row: dict[str, Any] = {
            "token": self.token,
            "targets": [
                {"entity_id": entity_id, "command": command}
                for entity_id, command in self.targets
            ],
            "entity_id": self.entity_id,
            "command": self.command,
            "expires": self.expires,
            "seconds_left": max(0, round(self.expires - time.time())),
            "used_at": self.used_at,
            "created_by": self.created_by,
            "label": self.label,
        }
        if base_url:
            row["url"] = f"{base_url.rstrip('/')}/einmal/{self.token}"
        return row


class PassStore:
    def __init__(self) -> None:
        self._passes: dict[str, Pass] = {}

    def create(
        self,
        targets: list[tuple[str, str]],
        created_by: str,
        minutes: int = DEFAULT_MINUTES,
        label: str = "",
    ) -> Pass:
        if not targets:
            raise ValueError("Ein Einmal-Link ohne Ziel öffnet nichts")
        self.purge()
        minutes = max(1, min(MAX_MINUTES, int(minutes)))
        # 32 Byte Zufall: Raten ist damit keine Angriffsart, auch wenn die
        # Adresse ohne jede Anmeldung funktioniert.
        entry = Pass(
            token=secrets.token_urlsafe(32),
            targets=targets,
            expires=time.time() + minutes * 60,
            created_by=created_by,
            label=label,
        )
        self._passes[entry.token] = entry
        while len(self._passes) > MAX_OPEN:
            oldest = min(self._passes.values(), key=lambda item: item.expires)
            self._passes.pop(oldest.token, None)
        return entry

    def purge(self) -> None:
        now = time.time()
        for token, entry in list(self._passes.items()):
            # Gebrauchte bleiben kurz sichtbar, damit die App «benutzt um
            # 14:32» zeigen kann – danach weg wie die abgelaufenen.
            if entry.expires < now:
                self._passes.pop(token, None)

    def get(self, token: str) -> Pass | None:
        self.purge()
        return self._passes.get(token)

    def redeem(self, token: str) -> Pass:
        """Einlösen – wirft, wenn es ihn nicht gibt, er abgelaufen oder
        schon gebraucht ist. Von aussen sind alle drei ununterscheidbar."""
        entry = self.get(token)
        if entry is None or entry.used_at is not None or entry.expires < time.time():
            raise KeyError("Dieser Link gilt nicht mehr")
        entry.used_at = time.time()
        return entry

    def revoke(self, token: str) -> bool:
        return self._passes.pop(token, None) is not None

    def all(self) -> list[Pass]:
        self.purge()
        return sorted(self._passes.values(), key=lambda item: item.expires, reverse=True)
