"""Kurzlebige Bildablage für Push-Nachrichten.

Ein Bild in der Nachricht selbst kann das Telefon nicht über die API
holen: Die Nachricht wird vom Betriebssystem angezeigt, lange bevor die App
läuft, und das Betriebssystem hat keinen Token. Die Adresse muss also ohne
Anmeldung erreichbar sein.

Der Handel, den dieses Modul macht:

  - Das Bild liegt nur im Arbeitsspeicher, nie auf der Platte.
  - Die Adresse enthält 32 zufällige Bytes. Raten ist keine Möglichkeit.
  - Nach zehn Minuten ist sie tot, und mehr als eine Handvoll Bilder
    behält der Hub nie.
  - Es ist genau das Bild, worüber der Empfänger ohnehin gerade
    benachrichtigt wird – kein Zugang zur laufenden Kamera.

Wer das nicht will, lässt ``push.public_url`` in der config.yaml weg: Dann
verschickt der Hub die Nachricht ohne Bild, so wie vorher.

Die Ablage ist absichtlich klein und ohne Nebenwirkungen – ``now`` wird
hereingereicht, damit sich das Ablaufen prüfen lässt, ohne zu warten.
"""

from __future__ import annotations

import secrets
import time
from typing import Any

# So lange ist eine Adresse gültig. Lang genug, dass man die Nachricht auch
# aus der Hosentasche noch aufzieht, kurz genug, dass ein abgefangener Link
# nichts mehr wert ist.
TTL = 600.0
# So viele Bilder behält der Hub höchstens. Ein Bild sind ein paar hundert
# Kilobyte; ein Daueralarm soll den Speicher nicht vollschreiben.
LIMIT = 10


class SnapshotStore:
    def __init__(self, ttl: float = TTL, limit: int = LIMIT) -> None:
        self.ttl = ttl
        self.limit = limit
        # Token → (Bild, Ablaufzeitpunkt). Einfügereihenfolge zählt: Beim
        # Überlaufen fliegt das älteste zuerst.
        self._items: dict[str, tuple[bytes, float]] = {}

    def put(self, image: bytes, now: float | None = None) -> str:
        """Ein Bild ablegen und die Kennung dafür zurückgeben."""
        moment = time.time() if now is None else now
        self.purge(moment)
        token = secrets.token_urlsafe(32)
        self._items[token] = (image, moment + self.ttl)
        while len(self._items) > self.limit:
            self._items.pop(next(iter(self._items)))
        return token

    def get(self, token: str, now: float | None = None) -> bytes | None:
        """Das Bild zu dieser Kennung – oder ``None``, wenn es keines
        (mehr) gibt. Abgelaufen und nie existiert sind von aussen
        ununterscheidbar, und das ist gut so."""
        moment = time.time() if now is None else now
        found = self._items.get(token)
        if found is None:
            return None
        image, expires = found
        if expires <= moment:
            self._items.pop(token, None)
            return None
        return image

    def purge(self, now: float | None = None) -> None:
        moment = time.time() if now is None else now
        for token in [
            token for token, (_, expires) in self._items.items() if expires <= moment
        ]:
            self._items.pop(token, None)

    def __len__(self) -> int:
        return len(self._items)


def image_url(public_url: Any, token: str) -> str | None:
    """Die vollständige Adresse für die Push-Nachricht (rein, testbar).

    ``None``, wenn keine von aussen erreichbare Adresse konfiguriert ist –
    dann geht die Nachricht ohne Bild raus. Eine geratene Adresse wäre
    schlimmer als keine: Das Telefon zeigte dann eine Nachricht mit einem
    leeren Kasten, wo ein Bild sein sollte.
    """
    base = str(public_url or "").strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        return None
    return f"{base}/api/push/image/{token}"
