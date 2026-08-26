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

import asyncio
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
# So lange hält die Auslieferung eine Anfrage hin, wenn die Adresse zwar
# vergeben, das Bild aber noch nicht da ist. Apple gibt der Erweiterung,
# die das Bild lädt, rund dreissig Sekunden - so viel davon zu belegen
# ist unbedenklich, alles darüber wäre es nicht.
GEDULD = 16.0


class SnapshotStore:
    def __init__(self, ttl: float = TTL, limit: int = LIMIT) -> None:
        self.ttl = ttl
        self.limit = limit
        # Token → (Bild, Ablaufzeitpunkt). Einfügereihenfolge zählt: Beim
        # Überlaufen fliegt das älteste zuerst. Das Bild darf ``None``
        # sein - siehe ``reserve``.
        self._items: dict[str, tuple[bytes | None, float]] = {}
        # Zu jedem reservierten Platz eines: Es geht auf, sobald feststeht,
        # was dort liegt - auch dann, wenn das «nichts» ist. Wer wartet,
        # soll nicht in die Frist laufen, wenn die Antwort längst da ist.
        self._bereit: dict[str, asyncio.Event] = {}

    def put(self, image: bytes, now: float | None = None) -> str:
        """Ein Bild ablegen und die Kennung dafür zurückgeben."""
        moment = time.time() if now is None else now
        self.purge(moment)
        token = secrets.token_urlsafe(32)
        self._items[token] = (image, moment + self.ttl)
        while len(self._items) > self.limit:
            self._vergessen(next(iter(self._items)))
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
            self._vergessen(token)
            return None
        # Ein reservierter, noch leerer Platz sieht von aussen aus wie
        # keiner. Wer das Bild wirklich braucht, nimmt ``warten``.
        return image

    def reserve(self, now: float | None = None) -> str:
        """Eine Adresse vergeben, bevor es das Bild gibt.

        Der Grund steht in ``core/personenbild.py``: Das beste Bild ist
        nicht das vom Moment des Auslösers, sondern das vom Moment, in dem
        die Kamera wirklich jemanden sieht - und der kommt ein paar
        Sekunden später. Die Nachricht darf darauf nicht warten, sie trägt
        ja nur die Adresse. Also wird die Adresse zuerst vergeben und das
        Bild danach nachgereicht.

        Wer die Adresse abruft, bevor ``fuellen`` gelaufen ist, wartet in
        ``warten`` kurz mit - und bekommt dann das fertige Bild statt
        eines leeren Kastens.
        """
        moment = time.time() if now is None else now
        self.purge(moment)
        token = secrets.token_urlsafe(32)
        self._items[token] = (None, moment + self.ttl)
        self._bereit[token] = asyncio.Event()
        while len(self._items) > self.limit:
            self._vergessen(next(iter(self._items)))
        return token

    def fuellen(self, token: str, image: bytes | None) -> None:
        """Das nachgereichte Bild einsetzen - oder eingestehen, dass keines kommt.

        ``None`` ist ausdrücklich erlaubt und wichtig: Es weckt die
        Wartenden sofort, statt sie in die Frist laufen zu lassen. Eine
        Nachricht ohne Bild soll schnell ohne Bild dastehen.

        Ein Platz, den es nicht mehr gibt - abgelaufen, überschrieben,
        Hub neu gestartet -, wird stillschweigend übergangen. Der
        Hintergrundlauf, der hier ankommt, darf daran nicht scheitern.
        """
        found = self._items.get(token)
        if found is None:
            return
        if image is not None:
            self._items[token] = (image, found[1])
        ereignis = self._bereit.get(token)
        if ereignis is not None:
            ereignis.set()

    async def warten(
        self, token: str, geduld: float = GEDULD, now: float | None = None
    ) -> bytes | None:
        """Das Bild - notfalls, indem man kurz darauf wartet.

        Für die Auslieferung an das Telefon. Liegt das Bild schon da,
        kostet das nichts. Ist die Adresse reserviert und noch leer, hält
        diese Anfrage so lange still, bis das Bild kommt, höchstens aber
        ``geduld`` Sekunden.

        ``now`` friert die Uhr für den ganzen Aufruf ein. Das ist für
        Tests gedacht und harmlos: Gültig ist eine Adresse zehn Minuten,
        gewartet wird Sekunden.
        """
        bild = self.get(token, now)
        if bild is not None:
            return bild
        ereignis = self._bereit.get(token)
        if ereignis is None:
            # Nie vergeben, längst abgelaufen oder schon beantwortet -
            # von aussen alles dasselbe, und das soll es auch bleiben.
            return None
        try:
            await asyncio.wait_for(ereignis.wait(), geduld)
        except TimeoutError:
            return None
        return self.get(token, now)

    def _vergessen(self, token: str) -> None:
        """Einen Platz räumen und alle wecken, die darauf warten.

        Ohne das Wecken hinge eine Anfrage auf ein Bild, das durch
        Ablauf oder Überlauf gerade verschwunden ist, bis zur vollen
        Frist - für eine Antwort, die schon feststeht.
        """
        self._items.pop(token, None)
        ereignis = self._bereit.pop(token, None)
        if ereignis is not None:
            ereignis.set()

    def purge(self, now: float | None = None) -> None:
        moment = time.time() if now is None else now
        for token in [
            token for token, (_, expires) in self._items.items() if expires <= moment
        ]:
            self._vergessen(token)

    def __len__(self) -> int:
        return len(self._items)


def media_type(data: bytes) -> str:
    """Womit hat man es zu tun? (rein, testbar)

    Aus den ersten Bytes statt aus einem Dateinamen – den gibt es hier
    nicht. Drei Fälle genügen: JPEG und PNG von den Kameras, MP4 vom
    Mitschnitt.
    """
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if len(data) > 11 and data[4:8] == b"ftyp":
        return "video/mp4"
    return "image/jpeg"


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
