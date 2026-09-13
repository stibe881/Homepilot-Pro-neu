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

Und bewusst nur *verschiedene*: Dieselbe abgelaufene Anmeldung wieder und
wieder vorzuzeigen ist kein Rateversuch, sondern eine App, die nichts
davon weiss. Genau daran hing eine Aussperrung, die niemand mehr auflösen
konnte: Nach einer Umbenennung passte die Sitzung nicht mehr, die App
fragte im Takt weiter, nach zehn Anfragen war die Adresse gesperrt – und
die Sperre gilt auch für die Anmeldemaske. Der Besitzer sah nach dem
ersten Anmeldeversuch «Zu viele Fehlversuche», und die App füllte die
Sperre nebenher immer wieder auf. Wer rät, schickt jedes Mal etwas
anderes; der wird weiterhin nach zehn Versuchen ausgesperrt.

Absichtlich einfach und im Arbeitsspeicher: Ein Neustart vergisst die
Sperren. Das ist der richtige Handel für ein Haus – lieber einmal zu
grosszügig als eine ausgesperrte Familie, weil eine Datei kaputt ist.
"""

from __future__ import annotations

import hashlib
import ipaddress
import logging
import time
from collections.abc import Iterable

log = logging.getLogger(__name__)

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
# So viele verschiedene Fehlversuche je Adresse bleiben in Erinnerung.
# Mehr braucht es nicht: Wer über dem Limit ist, ist ohnehin gesperrt.
MAX_KENNUNGEN = 32


def fingerabdruck(wert: str) -> str:
    """Ein kurzes Kennzeichen für einen Fehlversuch (rein, testbar).

    Nie das Token selbst: Die Bremse liegt im Arbeitsspeicher eines
    Prozesses, der auch Protokolle schreibt und Ausnahmen wirft.
    """
    return hashlib.sha256(wert.encode("utf-8")).hexdigest()[:16]


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
        # Adresse → schon gesehene Fehlversuche (als Fingerabdruck).
        self._kennungen: dict[str, set[str]] = {}

    def blocked_for(self, address: str, now: float | None = None) -> float:
        """Wie lange diese Adresse noch draussen bleibt – 0, wenn sie darf."""
        moment = time.time() if now is None else now
        until = self._blocked.get(address)
        if until is None:
            return 0.0
        if until <= moment:
            self._vergessen(address)
            return 0.0
        return until - moment

    def failed(
        self, address: str, now: float | None = None, kennung: str = ""
    ) -> bool:
        """Einen Fehlversuch zählen. True, wenn die Adresse jetzt gesperrt ist.

        ``kennung`` kennzeichnet, *womit* der Versuch scheiterte – beim
        Token sein Fingerabdruck. Kommt dasselbe noch einmal, zählt es
        nicht erneut: Eine App, die ihre abgelaufene Sitzung im Takt
        weiterreicht, rät nicht. Ohne Kennung zählt jeder Versuch, wie
        bisher – so bleibt das Durchprobieren von Passwörtern gebremst.
        """
        moment = time.time() if now is None else now
        self._prune(moment)
        if kennung:
            gesehen = self._kennungen.setdefault(address, set())
            if kennung in gesehen:
                return address in self._blocked
            if len(gesehen) < MAX_KENNUNGEN:
                gesehen.add(kennung)
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
        self._kennungen.pop(address, None)

    def _vergessen(self, address: str) -> None:
        self._blocked.pop(address, None)
        self._failures.pop(address, None)
        self._kennungen.pop(address, None)

    def _prune(self, now: float) -> None:
        for address, until in list(self._blocked.items()):
            if until <= now:
                self._vergessen(address)
        for address, (_, started) in list(self._failures.items()):
            if now - started > self.window:
                self._failures.pop(address, None)
                self._kennungen.pop(address, None)
        # Notbremse gegen einen verteilten Beschuss: Die ältesten zuerst.
        while len(self._failures) > MAX_TRACKED:
            oldest = min(self._failures, key=lambda key: self._failures[key][1])
            self._failures.pop(oldest, None)

    def __len__(self) -> int:
        return len(self._blocked)


def vertrauenswuerdig(direkt: str, trusted_proxies: Iterable[str]) -> bool:
    """Darf diese Verbindung einen X-Forwarded-For mitbringen? (rein, testbar)

    Einträge sind Adressen oder Netze («172.18.0.0/16» - der Nginx Proxy
    Manager in Docker bekommt bei jedem Neustart eine andere Adresse aus
    seinem Netz). Ein unlesbarer Eintrag zählt nicht, statt alles zu
    öffnen.
    """
    try:
        adresse = ipaddress.ip_address(direkt)
    except ValueError:
        return False
    for eintrag in trusted_proxies:
        try:
            if adresse in ipaddress.ip_network(str(eintrag).strip(), strict=False):
                return True
        except ValueError:
            continue
    return False


def adresse(direkt: str, forwarded: str, trusted_proxies: Iterable[str]) -> str:
    """Von welcher Adresse kommt die Anfrage? (rein, testbar)

    Hinter einem Reverse Proxy steht in ``request.client`` immer der Proxy.
    Die echte Adresse steht in ``X-Forwarded-For`` – und zwar ganz vorne;
    alles dahinter hat der Proxy angehängt und ist nicht vertrauenswürdig.

    Der Kopf zählt aber nur, wenn die Verbindung wirklich vom Proxy kommt
    (Punkt 591 der Werkbank). Vorher galt er von jedem: Wer ihn selbst
    setzte, umging die Bremse mit einer neuen Adresse je Versuch, sperrte
    fremde Adressen aus, und dieselbe erfundene Adresse stand im
    Zugriffsprotokoll von Türe und Alarm.
    """
    if forwarded and vertrauenswuerdig(direkt, trusted_proxies):
        return forwarded.split(",")[0].strip() or direkt or "unbekannt"
    return direkt or "unbekannt"


# Die Proxys aus der Konfiguration (api.trusted_proxies). Auf Modulebene,
# weil ein Dutzend Routen ``client_address(request)`` rufen und keine
# davon die Konfiguration zur Hand hat - die Bremse selbst lebt ohnehin
# je Prozess. Gesetzt in api/server.py beim Bau der App.
_trusted_proxies: tuple[str, ...] = ()
# Je Adresse einmal warnen, wenn ein Kopf ignoriert wurde: Wer den
# Proxy vergisst einzutragen, findet den Grund so im Protokoll, statt
# dass die Bremse still das ganze Haus aussperrt.
_gewarnt: set[str] = set()


def vertraute_proxys_setzen(proxies: Iterable[str]) -> None:
    global _trusted_proxies
    _trusted_proxies = tuple(str(proxy) for proxy in proxies)
    _gewarnt.clear()


def client_address(request, trusted_proxies: Iterable[str] | None = None) -> str:
    """Von welcher Adresse kommt die Anfrage? - für Request und WebSocket.

    ``trusted_proxies`` fehlt bei den Routen; dann gilt die Liste aus der
    Konfiguration (``vertraute_proxys_setzen``).
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    client = getattr(request, "client", None)
    direkt = getattr(client, "host", "") or ""
    proxies = _trusted_proxies if trusted_proxies is None else tuple(trusted_proxies)
    ergebnis = adresse(direkt, forwarded, proxies)
    if forwarded and ergebnis == (direkt or "unbekannt") and direkt not in _gewarnt:
        _gewarnt.add(direkt)
        log.warning(
            "X-Forwarded-For von %s ignoriert - steht der Proxy in "
            "api.trusted_proxies? (docs/app-ohne-vpn.md)",
            direkt or "unbekannt",
        )
    return ergebnis
