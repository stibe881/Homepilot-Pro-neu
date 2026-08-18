"""Bremse für fehlgeschlagene Anmeldeversuche.

Im eigenen Netz war das entbehrlich: Wer im WLAN steht, hat schon einen
Schlüssel zum Haus. Steht der Hub aber im offenen Internet, klopft binnen
Stunden der erste Scanner an, und dann zählt zweierlei:

  - **Nicht auszulesen.** Die Tokens sind lang und zufällig, Raten ist
    aussichtslos – aber eine Bremse macht aus «aussichtslos» ein
    «unmöglich in Menschenzeit».
  - **Nicht kaputtzuspielen.** Ohne Bremse kostet jeder Versuch den Hub
    Arbeit. Ein Dauerbeschuss legt sonst die Steuerung lahm, auch ohne je
    hineinzukommen.

Bewusst nur *fehlgeschlagene* Versuche zählen: Wer ein gültiges Token
hat, soll die App bedienen können, so oft er will.

Absichtlich einfach und im Arbeitsspeicher: Ein Neustart vergisst die
Sperren. Das ist der richtige Handel für ein Haus – lieber einmal zu
grosszügig als eine ausgesperrte Familie, weil eine Datei kaputt ist.
"""

from __future__ import annotations

import time

# So viele Fehlversuche gehen durch, bevor gesperrt wird. Grosszügig
# genug, dass ein abgelaufener Gastzugang nicht sofort in die Sperre
# läuft, und immer noch weit unter allem, was ein Angriff bräuchte.
LIMIT = 10
# Über diesen Zeitraum wird gezählt.
WINDOW = 300.0
# So lange bleibt eine Adresse danach draussen.
BLOCK = 900.0
# Mehr Adressen merkt sich der Hub nicht. Ein verteilter Beschuss soll
# nicht den Speicher füllen; die ältesten fliegen dann raus.
MAX_TRACKED = 5000


class Throttle:
    def __init__(
        self, limit: int = LIMIT, window: float = WINDOW, block: float = BLOCK
    ) -> None:
        self.limit = limit
        self.window = window
        self.block = block
        # Adresse → (Anzahl Fehlversuche, Beginn des Zeitfensters).
        self._failures: dict[str, tuple[int, float]] = {}
        # Adresse → Zeitpunkt, ab dem sie wieder darf.
        self._blocked: dict[str, float] = {}

    def blocked_for(self, address: str, now: float | None = None) -> float:
        """Wie lange diese Adresse noch draussen bleibt – 0, wenn sie darf."""
        moment = time.time() if now is None else now
        until = self._blocked.get(address)
        if until is None:
            return 0.0
        if until <= moment:
            self._blocked.pop(address, None)
            self._failures.pop(address, None)
            return 0.0
        return until - moment

    def failed(self, address: str, now: float | None = None) -> bool:
        """Einen Fehlversuch zählen. True, wenn die Adresse jetzt gesperrt ist."""
        moment = time.time() if now is None else now
        self._prune(moment)
        count, started = self._failures.get(address, (0, moment))
        # Zeitfenster abgelaufen: von vorne zählen. Sonst würde ein
        # Vertipper von heute morgen abends noch mitzählen.
        if moment - started > self.window:
            count, started = 0, moment
        count += 1
        self._failures[address] = (count, started)
        if count >= self.limit:
            self._blocked[address] = moment + self.block
            return True
        return False

    def succeeded(self, address: str) -> None:
        """Ein gültiges Token räumt die Fehlversuche weg."""
        self._failures.pop(address, None)

    def _prune(self, now: float) -> None:
        for address, until in list(self._blocked.items()):
            if until <= now:
                self._blocked.pop(address, None)
                self._failures.pop(address, None)
        for address, (_, started) in list(self._failures.items()):
            if now - started > self.window:
                self._failures.pop(address, None)
        # Notbremse gegen einen verteilten Beschuss: Die ältesten zuerst.
        while len(self._failures) > MAX_TRACKED:
            oldest = min(self._failures, key=lambda key: self._failures[key][1])
            self._failures.pop(oldest, None)

    def __len__(self) -> int:
        return len(self._blocked)


def client_address(request) -> str:
    """Von welcher Adresse kommt die Anfrage? (rein genug, testbar)

    Hinter einem Reverse Proxy steht in ``request.client`` immer der Proxy.
    Die echte Adresse steht in ``X-Forwarded-For`` – und zwar ganz vorne;
    alles dahinter hat der Proxy angehängt und ist nicht vertrauenswürdig.

    Ohne diesen Kopf sperrte die Bremse sonst den Proxy aus, und mit ihm
    das ganze Haus.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    client = getattr(request, "client", None)
    return getattr(client, "host", "") or "unbekannt"
