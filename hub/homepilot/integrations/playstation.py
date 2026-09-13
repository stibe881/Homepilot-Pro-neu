"""PlayStation 5 (und 4) – Zustand, laufendes Spiel, Aufwecken, Standby und Tasten.

Punkt 643 der Werkbank.

Konfiguration:
  - integration: playstation
    devices:
      - host: 192.168.1.60
        name: PlayStation 5
        # konsole: PS4   # nur nötig, wenn es eine PS4 ist und sie beim
        #                # ersten Anlauf nicht von selbst antwortet

Voraussetzung (nur für Standby und Tasten):
    pip install "homepilot[playstation]"

Was ohne die Bibliothek geht: Der Zustand (an, Standby, welches Spiel
läuft) und das Aufwecken. Beides läuft über das Discovery-Protokoll der
Konsole (DDP, UDP 9302 bei der PS5, 987 bei der PS4) – unverschlüsselt,
lokal, ohne Anmeldung. Die Textteile davon stehen hier als reine
Funktionen, damit die Tests ohne Bibliothek und ohne Konsole laufen.

Was die Bibliothek braucht: Standby und Tasten. Beides gibt es nur
innerhalb einer Remote-Play-Sitzung, und die ist verschlüsselt und an
ein PSN-Konto gebunden – ``pyremoteplay`` baut sie auf, wir nutzen sie
ohne Video (``receiver=None``) und trennen sie nach einer halben Minute
ohne weitere Taste wieder (SITZUNG_LEERLAUF). Eine Dauer-Sitzung hielte
die Konsole auf «Remote Play verbunden», und das steht dann im
Bildschirm-Eck, während jemand spielt.

Einrichtung (einmalig, in der App unter Einstellungen → Verbindungen,
Abschnitt «PlayStation»; siehe docs/playstation.md):
  1. Den Geräteblock wie oben in die config.yaml eintragen, Hub starten.
  2. PSN-Anmeldung: Die App öffnet die Anmeldeseite von Sony; nach dem
     Anmelden landet man auf einer «redirect»-Seite, deren Adresse man
     in die App einfügt (api/routes/playstation.py, pair_account). Der
     Hub holt daraus die Kontokennung und legt sie in
     playstation-token.json neben die Datendatei.
  3. Registrierung: Auf der Konsole unter Einstellungen → System →
     Remote Play → «Gerät verbinden» steht ein achtstelliger Code; die
     App nimmt ihn entgegen (pair_pin). Die Konsole muss dabei an sein.
     Die Registrierung liegt danach in playstation-profile.json.

Bekannte Grenzen: Das Protokoll kann kein Spiel und keine App starten,
nur sehen, was läuft. Ganz ausgeschaltet (nicht Ruhemodus) antwortet die
Konsole nicht und lässt sich auch nicht wecken.
"""

from __future__ import annotations

import asyncio
import contextlib
import re
import socket
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..core import tokenstore
from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.extras import vorhanden
from ..core.integration import Integration

# ── Das Discovery-Protokoll (DDP) als reine Textfunktionen ─────────────────

#: Der UDP-Port, auf dem die Konsole Anfragen entgegennimmt - je Bauart
#: ein anderer.
DDP_PORTS: dict[str, int] = {"PS5": 9302, "PS4": 987}
#: Der Port, von dem aus gefragt wird. Die PS5 antwortet nur auf Anfragen
#: von diesem Port (so auch pyremoteplay: «Necessary for PS5»); ist er
#: belegt, bleibt ein zufälliger - dann antwortet eine PS4 weiterhin.
DDP_QUELLPORT = 9303
DDP_VERSION = "00030010"
#: So lange wartet der Hub auf eine Antwort. Lokal, ein Paket hin, eines
#: zurück - zwei Sekunden sind grosszügig.
DDP_TIMEOUT = 2.0

#: So lange bleibt eine Remote-Play-Sitzung ohne weitere Taste offen.
#: Wer durch ein Menü tippt, drückt alle paar Sekunden; wer aufhört,
#: soll die Konsole nicht mit «Remote Play verbunden» zurücklassen.
SITZUNG_LEERLAUF = 30.0
#: So lange darf der Aufbau einer Sitzung dauern.
SITZUNG_AUFBAU = 15.0


def ddp_anfrage(art: str, daten: dict[str, str] | None = None) -> bytes:
    """Eine DDP-Nachricht bauen (rein, testbar).

    Das Format ist HTTP-ähnlich: Statuszeile, dann ``schlüssel:wert``-
    Zeilen, zuletzt die Protokollversion. Ohne die Versionszeile
    antwortet die Konsole nicht.
    """
    zeilen = [f"{art} * HTTP/1.1"]
    for schluessel, wert in (daten or {}).items():
        zeilen.append(f"{schluessel}:{wert}")
    zeilen.append(f"device-discovery-protocol-version:{DDP_VERSION}")
    return ("\n".join(zeilen) + "\n").encode("utf-8")


def ddp_suche() -> bytes:
    """Die Statusanfrage (rein, testbar)."""
    return ddp_anfrage("SRCH")


def ddp_wecken(credential: str) -> bytes:
    """Die Weck-Nachricht (rein, testbar).

    Die übrigen Felder sind das, was die Remote-Play-App mitschickt; die
    Konsole prüft nur die Kennung, aber ohne den Rest wirft sie das
    Paket weg.
    """
    return ddp_anfrage(
        "WAKEUP",
        {
            "user-credential": credential,
            "client-type": "vr",
            "auth-type": "R",
            "model": "w",
            "app-type": "r",
        },
    )


_STATUSZEILE = re.compile(r"HTTP/1\.1 (?P<code>\d+) ?(?P<status>.*)")


def ddp_antwort(roh: bytes | str) -> dict[str, Any]:
    """Eine DDP-Antwort lesen (rein, testbar).

    Ergebnis: ``status_code`` (200 = an, 620 = Ruhemodus) und ``status``
    aus der ersten Zeile, dazu jede ``schlüssel:wert``-Zeile unverändert
    (``host-name``, ``host-type``, ``host-id``, ``running-app-name``,
    ``running-app-titleid`` …). Ein Spielname darf Doppelpunkte enthalten
    («Ratchet & Clank: Rift Apart») - getrennt wird deshalb nur am
    ersten. Ein leeres Wörterbuch heisst: Das war keine Antwort.
    """
    if isinstance(roh, bytes):
        try:
            text = roh.decode("utf-8")
        except UnicodeDecodeError:
            return {}
    else:
        text = roh
    daten: dict[str, Any] = {}
    for zeile in text.splitlines():
        zeile = zeile.strip()
        if not zeile:
            continue
        treffer = _STATUSZEILE.match(zeile)
        if treffer:
            daten["status_code"] = int(treffer.group("code"))
            daten["status"] = treffer.group("status").strip()
            continue
        schluessel, trenner, wert = zeile.partition(":")
        if not trenner:
            continue
        daten[schluessel.strip()] = wert.strip()
    return daten


def konsolenzustand(antwort: dict[str, Any]) -> dict[str, Any]:
    """Aus der gelesenen Antwort der Zustand der Kachel (rein, testbar).

    ``state`` ist nur «on» oder «off», damit die Fernseher-Karte
    (core/livekarten.py, TV_AN) und die Kachel der App die Konsole wie
    einen Fernseher nehmen. Der Ruhemodus ist «off», steht aber
    zusätzlich als ``standby`` da: Nur daraus lässt sie sich wecken.
    Der Spielname geht auch als ``track`` hinaus - die
    Media-Player-Kachel zeigt dieses Feld als Hauptzeile.
    """
    code = antwort.get("status_code")
    an = code == 200
    app = str(antwort.get("running-app-name") or "").strip() or None
    title_id = str(antwort.get("running-app-titleid") or "").strip() or None
    zustand: dict[str, Any] = {
        "state": "on" if an else "off",
        "standby": code == 620,
        "app": app if an else None,
        "title_id": title_id if an else None,
        "track": app if an else None,
    }
    bauart = str(antwort.get("host-type") or "").strip().upper()
    if bauart in DDP_PORTS:
        zustand["konsole"] = bauart
    return zustand


def ddp_ports(konsole: str | None) -> list[int]:
    """An welche Ports eine Anfrage geht (rein, testbar).

    Solange die Bauart unbekannt ist, an beide - die erste Antwort sagt
    dann, was es ist.
    """
    if konsole and konsole.upper() in DDP_PORTS:
        return [DDP_PORTS[konsole.upper()]]
    return [DDP_PORTS["PS5"], DDP_PORTS["PS4"]]


# ── Kopplung und Kennungen ─────────────────────────────────────────────────

#: Die Anmeldeseite von Sony - dieselbe Adresse, die pyremoteplay
#: benutzt, hier noch einmal, damit Schritt 1 auch ohne die Bibliothek
#: angezeigt werden kann. Die Zeichenfolge in ``client_id`` ist die
#: öffentliche Kennung der Remote-Play-App.
LOGIN_URL = (
    "https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/authorize"
    "?service_entity=urn:service-entity:psn&response_type=code"
    "&client_id=ba495a24-818c-472b-b12d-ff231c1b5745"
    "&redirect_uri=https://remoteplay.dl.playstation.net/remoteplay/redirect"
    "&scope=psn:clientapp&request_locale=en_US&ui=pr&service_logo=ps"
    "&layout_type=popup&smcid=remoteplay&prompt=always"
    "&PlatformPrivacyWs1=minimal&no_captcha=true&"
)
#: Wo die Anmeldung landet - nur eine Adresse, die so beginnt, trägt den
#: Code, den der Hub braucht.
REDIRECT_PREFIX = "https://remoteplay.dl.playstation.net/remoteplay/redirect"


def login_url() -> str:
    """Die Anmeldeseite - aus der Bibliothek, wenn sie da ist, sonst die Kopie."""
    try:
        from pyremoteplay import oauth
    except ImportError:
        return LOGIN_URL
    return str(oauth.get_login_url())


def redirect_pruefen(redirect_url: str) -> str:
    """Die eingefügte Adresse prüfen (rein, testbar) - oder ValueError.

    Der häufigste Fehler beim Einfügen: Man kopiert die Anmeldeseite
    statt der Seite *danach*. Die Meldung sagt deshalb, woran man die
    richtige erkennt.
    """
    adresse = str(redirect_url or "").strip()
    if not adresse.startswith(REDIRECT_PREFIX):
        raise ValueError(
            "Das ist nicht die Seite nach der Anmeldung – die richtige beginnt mit "
            f"{REDIRECT_PREFIX} und zeigt meist nur «redirect»."
        )
    if "code=" not in adresse:
        raise ValueError("In der Adresse fehlt der Code (…?code=…).")
    return adresse


def pin_pruefen(pin: Any) -> str:
    """Den Code von der Konsole prüfen (rein, testbar) - oder ValueError.

    Acht Ziffern, auf der Konsole in zwei Vierergruppen angezeigt -
    Leerzeichen und Bindestriche aus der Eingabe gehören weg.
    """
    ziffern = re.sub(r"[\s-]", "", str(pin or ""))
    if not ziffern.isdigit() or len(ziffern) != 8:
        raise ValueError(
            "Der Code hat acht Ziffern – er steht auf der Konsole unter "
            "Einstellungen → System → Remote Play → «Gerät verbinden»."
        )
    return ziffern


def konto_aus_antwort(account: dict[str, Any] | None) -> dict[str, str]:
    """Was vom PSN-Konto dauerhaft bleibt (rein, testbar) - oder ValueError.

    Nur die vier Kennungen, kein Token: ``user_rpid`` ist die Kennung
    für die Registrierung, ``credentials`` der Schlüssel zum Wecken
    ohne Registrierung, ``online_id`` der Name für die Anzeige.
    """
    if not account or not account.get("user_rpid") or not account.get("online_id"):
        raise ValueError(
            "Sony hat kein Konto geliefert – die Adresse ist vielleicht abgelaufen; "
            "bitte noch einmal anmelden."
        )
    return {
        "user_rpid": str(account["user_rpid"]),
        "user_id": str(account.get("user_id") or ""),
        "online_id": str(account["online_id"]),
        "credentials": str(account.get("credentials") or ""),
    }


def registriert(
    profile: dict[str, Any] | None, online_id: str | None, host_id: str | None
) -> bool:
    """Ist diese Konsole für dieses Konto registriert? (rein, testbar)

    Die Profildatei von pyremoteplay: ``{online_id: {"id": …, "hosts":
    {host_id: {"data": {"RegistKey": …, …}, "type": "PS5"}}}}``. Solange
    die Konsole noch nie geantwortet hat, ist ihre ``host_id`` unbekannt -
    dann zählt, ob das Konto überhaupt eine Konsole kennt.
    """
    if not profile or not online_id:
        return False
    hosts = (profile.get(online_id) or {}).get("hosts") or {}
    if not isinstance(hosts, dict):
        return False
    if host_id:
        return bool(hosts.get(host_id))
    return bool(hosts)


def regist_key_zahl(regist_key: str) -> str:
    """Den RegistKey in die Zahl übersetzen, die das Weck-Paket trägt (rein, testbar).

    Der Schlüssel liegt doppelt hex-kodiert in der Profildatei: aussen
    die Bytes einer Hex-Zeichenkette, innen die eigentlichen acht Bytes.
    Dieselbe Rechnung wie ``pyremoteplay.util.format_regist_key``, hier
    noch einmal, damit das Wecken ohne die Bibliothek geht.
    """
    innen = bytes.fromhex(regist_key).decode("ascii")
    return str(int.from_bytes(bytes.fromhex(innen), "big"))


def weck_kennung(
    profile: dict[str, Any] | None,
    online_id: str | None,
    host_id: str | None,
    konto: dict[str, Any] | None,
) -> str | None:
    """Womit die Konsole geweckt wird (rein, testbar).

    Zuerst der RegistKey der Registrierung - das ist, was die
    Remote-Play-App und pyremoteplay schicken, und es ist an dieser PS5
    geprüft. Ohne Registrierung bleibt die Konto-Kennung
    (``credentials``): So weckt die zweite Bildschirm-App eine PS4, und
    sie ist der Grund, warum das Wecken schon vor Schritt 2 versucht
    wird. ``None`` heisst: Es gibt gar nichts, womit man klopfen könnte.
    """
    if profile and online_id and host_id:
        hosts = (profile.get(online_id) or {}).get("hosts") or {}
        daten = (hosts.get(host_id) or {}).get("data") or {}
        schluessel = daten.get("RegistKey")
        if schluessel:
            try:
                return regist_key_zahl(str(schluessel))
            except ValueError:
                pass
    if konto and konto.get("credentials"):
        return str(konto["credentials"])
    return None


# ── Tasten ─────────────────────────────────────────────────────────────────

#: Kommando der App → Tastenname in pyremoteplay. ``ok``, ``back`` und
#: ``home`` sind Aliasse für Kreuz, Kreis und PS-Taste, damit die
#: bestehende Fernbedienung der App ohne Änderung funktioniert.
TASTEN: dict[str, str] = {
    "dpad_up": "UP",
    "dpad_down": "DOWN",
    "dpad_left": "LEFT",
    "dpad_right": "RIGHT",
    "cross": "CROSS",
    "circle": "CIRCLE",
    "triangle": "TRIANGLE",
    "square": "SQUARE",
    "options": "OPTIONS",
    "share": "SHARE",
    "ps": "PS",
    "ok": "CROSS",
    "back": "CIRCLE",
    "home": "PS",
}

#: Was die Kachel anbietet - die Reihenfolge ist die des Vertrags mit der App.
COMMANDS: list[str] = [
    "turn_on", "turn_off", "toggle",
    "dpad_up", "dpad_down", "dpad_left", "dpad_right",
    "ok", "back", "home", "ps",
    "cross", "circle", "triangle", "square", "options", "share",
]


def taste(command: str) -> str | None:
    """Welche Taste ein Kommando drückt (rein, testbar) - None für Nicht-Tasten."""
    return TASTEN.get(command)


# ── Absagen ────────────────────────────────────────────────────────────────

NICHT_ERREICHBAR = (
    "PlayStation nicht erreichbar – ist sie am Strom und im selben Netz? "
    "Ganz ausgeschaltet antwortet sie nicht; aus dem Ruhemodus schon."
)
NICHT_GEKOPPELT = (
    "PlayStation nicht gekoppelt – unter Einstellungen → Verbindungen "
    "«PlayStation koppeln» antippen und mit dem PSN-Konto anmelden."
)
NICHT_REGISTRIERT = (
    "PlayStation noch nicht mit dem Konto verbunden – unter Einstellungen → "
    "Verbindungen den Code von der Konsole eintragen (Einstellungen → System → "
    "Remote Play → «Gerät verbinden»)."
)
BIBLIOTHEK_FEHLT = 'pyremoteplay fehlt - installieren mit: pip install "homepilot[playstation]"'
NICHT_AN = "PlayStation ist nicht eingeschaltet – zuerst wecken."
SITZUNG_FEHLGESCHLAGEN = (
    "Remote Play kam nicht zustande – läuft auf der Konsole gerade eine andere "
    "Remote-Play-Sitzung, oder ist sie unter Einstellungen → System → Remote Play "
    "abgeschaltet?"
)


def absage(
    erreichbar: bool,
    konto: bool,
    registriert: bool = True,
    bibliothek: bool = True,
) -> str | None:
    """Warum ein Befehl nicht ausgeführt wird (rein, testbar) - None, wenn nichts fehlt.

    In der Reihenfolge der nächsten Schritte: Eine Konsole ohne Strom
    braucht keinen Code, ein fehlendes Konto keine Bibliothek. Wer die
    Absage liest, soll genau eine Sache tun müssen.
    """
    if not erreichbar:
        return NICHT_ERREICHBAR
    if not konto:
        return NICHT_GEKOPPELT
    if not bibliothek:
        return BIBLIOTHEK_FEHLT
    if not registriert:
        return NICHT_REGISTRIERT
    return None


def remote_play_verfuegbar() -> bool:
    """Liegt pyremoteplay installiert bereit? (ohne es zu laden)"""
    return vorhanden("pyremoteplay")


# ── Der UDP-Kanal ──────────────────────────────────────────────────────────


class DdpKanal(asyncio.DatagramProtocol):
    """Ein Socket für alle Konsolen - Antworten nach Absender verteilt.

    Warum nicht je Anfrage ein Socket: Die PS5 antwortet nur auf Anfragen
    vom Quellport 9303 (DDP_QUELLPORT). Zwei Konsolen, zwei Sockets auf
    demselben Port - und der Kernel liefert die Antwort an irgendeinen
    von beiden. Ein Kanal, der die Antwort am Absender erkennt, hat das
    Problem nicht.
    """

    def __init__(self) -> None:
        self._transport: asyncio.DatagramTransport | None = None
        self._offen: dict[str, asyncio.Future[bytes]] = {}

    @classmethod
    async def oeffnen(cls) -> DdpKanal:
        loop = asyncio.get_running_loop()
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setblocking(False)
        if hasattr(socket, "SO_REUSEPORT"):
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        try:
            sock.bind(("0.0.0.0", DDP_QUELLPORT))
        except OSError:
            # Port belegt (etwa von einem zweiten Hub auf demselben Rechner):
            # ein zufälliger tut es für die PS4, die PS5 schweigt dann.
            sock.bind(("0.0.0.0", 0))
        kanal = cls()
        transport, _ = await loop.create_datagram_endpoint(lambda: kanal, sock=sock)
        kanal._transport = transport
        return kanal

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self._transport = transport  # type: ignore[assignment]

    def datagram_received(self, data: bytes, addr: Any) -> None:
        absender = str(addr[0]) if addr else ""
        warten = self._offen.get(absender)
        if warten is None and len(self._offen) == 1:
            # Ein Name statt einer IP in der config.yaml: Der Absender
            # ist dann nicht der Schlüssel - aber wenn nur einer wartet,
            # ist es seiner.
            warten = next(iter(self._offen.values()))
        if warten is not None and not warten.done():
            warten.set_result(data)

    def error_received(self, exc: Exception) -> None:
        # «Port unreachable» kommt, wenn die Konsole ganz aus ist - dann
        # läuft die Anfrage in ihren Timeout, das genügt.
        return None

    def senden(self, host: str, port: int, nachricht: bytes) -> None:
        if self._transport is None:
            raise ConnectionError("DDP-Kanal ist nicht offen")
        self._transport.sendto(nachricht, (host, port))

    async def anfragen(
        self, host: str, ports: list[int], nachricht: bytes, timeout: float = DDP_TIMEOUT
    ) -> bytes | None:
        """Anfragen und auf die erste Antwort warten - None, wenn keine kommt."""
        loop = asyncio.get_running_loop()
        warten: asyncio.Future[bytes] = loop.create_future()
        self._offen[host] = warten
        try:
            for port in ports:
                self.senden(host, port, nachricht)
            return await asyncio.wait_for(warten, timeout)
        except (TimeoutError, OSError):
            return None
        finally:
            if self._offen.get(host) is warten:
                self._offen.pop(host, None)

    def schliessen(self) -> None:
        if self._transport is not None:
            self._transport.close()
            self._transport = None


@dataclass
class Sitzung:
    """Eine offene Remote-Play-Sitzung samt ihrem Wecker."""

    device: Any
    wecker: asyncio.Task | None = None


class PlaystationIntegration(Integration):
    name = "playstation"

    def __init__(self, hub: Any, config: dict[str, Any]) -> None:
        """Die Tabellen entstehen hier und nicht in ``setup`` - aus
        demselben Grund wie beim Android TV: Ein Befehl kann eintreffen,
        bevor das Setup durch ist."""
        super().__init__(hub, config)
        # Was zu jeder Konsole bekannt ist: host, name, konsole (Bauart),
        # host_id (aus der ersten Antwort), ip.
        self._geraete: dict[str, dict[str, Any]] = {}
        # Die letzte gelesene DDP-Antwort je Konsole.
        self._status: dict[str, dict[str, Any]] = {}
        self._erreichbar: dict[str, bool] = {}
        self._ddp: DdpKanal | None = None
        # Wer den Kanal öffnet - im Test eine Attrappe (Fehler aus dem
        # Haus, siehe _port_frei).
        self._kanal_fabrik: Callable[[], Awaitable[DdpKanal]] = DdpKanal.oeffnen
        # Ein Schloss um den Quellport 9303: Solange die Bibliothek ihn
        # braucht, darf die Geräteschleife ihn nicht neu belegen.
        self._ddp_schloss = asyncio.Lock()
        self._konto: dict[str, str] | None = None
        self._profile: dict[str, Any] = {}
        self._token_datei: Path = Path("playstation-token.json")
        self._profil_datei: Path = Path("playstation-profile.json")
        self._sitzungen: dict[str, Sitzung] = {}
        # Je Konsole nur ein Sitzungsaufbau auf einmal: Zwei schnelle
        # Tasten hintereinander sollen dieselbe Sitzung nutzen.
        self._schloss: dict[str, asyncio.Lock] = {}

    # ── Aufbau ─────────────────────────────────────────────────────────────

    async def setup(self) -> None:
        devices = self.config.get("devices") or []
        if not devices:
            raise ConfigError("playstation braucht mindestens ein Gerät unter 'devices'")

        data_file = getattr(self.hub.config, "data_file", None)
        self._token_datei = tokenstore.token_file(data_file, self.config, "playstation")
        # Die Profildatei von pyremoteplay: bewusst neben die Datendatei
        # und nicht ins Home-Verzeichnis des Containers - das überlebt
        # kein Update.
        self._profil_datei = Path(
            str(self.config.get("profile_file") or "")
            or Path(data_file or "homepilot-data.json").parent / "playstation-profile.json"
        )
        self._konto_laden()
        self._profile_laden()

        for device in devices:
            host = device.get("host")
            if not host:
                raise ConfigError("playstation: jedes Gerät braucht einen 'host'")
            name = str(device.get("name") or "PlayStation")
            konsole = str(device.get("konsole") or "").upper() or None
            entity = await self.add_entity(
                str(host).replace(".", "_"),
                EntityKind.MEDIA_PLAYER,
                name,
                state={
                    "state": "off",
                    # Wie der Fernseher: nicht in die Boxenwahl des
                    # Musikplayers, dafür auf die Fernseher-Karte.
                    "has_screen": True,
                    # Keine App-Liste - das Protokoll kann nichts starten.
                    "apps": [],
                    "app": None,
                    "title_id": None,
                    "track": None,
                    "standby": False,
                    "konsole": konsole or "PS5",
                    "paired": False,
                    "remote_play": remote_play_verfuegbar(),
                },
                commands=list(COMMANDS),
                available=False,
            )
            self._geraete[entity.id] = {
                "host": str(host),
                "ip": str(host),
                "name": name,
                "konsole": konsole,
                "host_id": None,
            }
            await self._push_gekoppelt(entity.id)
            self._starte_loop(entity.id)

    def _starte_loop(self, entity_id: str) -> None:
        """Die Geräteschleife: alle paar Sekunden eine DDP-Anfrage."""
        self.start_polling(
            lambda: self._refresh(entity_id), interval=self.scan_interval(), sofort=True
        )

    async def teardown(self) -> None:
        await super().teardown()
        for entity_id in list(self._sitzungen):
            self._sitzung_trennen(entity_id)
        if self._ddp is not None:
            self._ddp.schliessen()
            self._ddp = None

    # ── Konto und Registrierung ────────────────────────────────────────────

    def _konto_laden(self) -> None:
        daten = tokenstore.load(self._token_datei)
        self._konto = konto_aus_antwort(daten) if daten and daten.get("user_rpid") else None

    def _profile_laden(self) -> None:
        self._profile = tokenstore.load(self._profil_datei) or {}

    def _online_id(self) -> str | None:
        return self._konto["online_id"] if self._konto else None

    def _ist_registriert(self, entity_id: str) -> bool:
        geraet = self._geraete.get(entity_id) or {}
        return registriert(self._profile, self._online_id(), geraet.get("host_id"))

    def _ist_gekoppelt(self, entity_id: str) -> bool:
        return self._konto is not None and self._ist_registriert(entity_id)

    async def _push_gekoppelt(self, entity_id: str) -> None:
        await self.hub.registry.update_state(
            entity_id,
            {"paired": self._ist_gekoppelt(entity_id), "remote_play": remote_play_verfuegbar()},
        )

    def playstation_id(self, entity_id: str) -> str | None:
        """Gehört diese Kachel zu einer Konsole? Sonst None."""
        return entity_id if entity_id in self._geraete else None

    def pair_stand(self, entity_id: str) -> dict[str, Any]:
        """Wo die Kopplung steht - für die Seite unter Verbindungen."""
        return {
            "account": self._konto is not None,
            "paired": self._ist_gekoppelt(entity_id),
            "online_id": self._online_id(),
            "remote_play": remote_play_verfuegbar(),
        }

    async def pair_start(self, entity_id: str, neu: bool = False) -> str:
        """Schritt 1 beginnen: die Anmeldeseite liefern.

        ``neu`` verwirft Konto und Registrierung - für den Fall, dass die
        Konsole zurückgesetzt wurde oder ein anderes Konto her soll.
        Beiseite gelegt, nicht gelöscht: Wer abbricht, kann zurück.
        """
        if entity_id not in self._geraete:
            raise ValueError("Dieses Gerät ist keine PlayStation")
        if neu:
            for datei in (self._token_datei, self._profil_datei):
                if datei.exists():
                    datei.rename(datei.with_name(datei.name + ".alt"))
                    self.log.info("PlayStation: %s → %s.alt", datei, datei)
            self._konto = None
            self._profile = {}
            for eid in self._geraete:
                self._sitzung_trennen(eid)
                await self._push_gekoppelt(eid)
        return login_url()

    async def pair_account(self, entity_id: str, redirect_url: str) -> str:
        """Schritt 1 abschliessen: aus der eingefügten Adresse das Konto holen."""
        if entity_id not in self._geraete:
            raise ValueError("Dieses Gerät ist keine PlayStation")
        adresse = redirect_pruefen(redirect_url)
        try:
            from pyremoteplay import oauth
            from pyremoteplay.profile import Profiles, format_user_account
        except ImportError as err:
            raise ConnectionError(BIBLIOTHEK_FEHLT) from err
        try:
            account = await oauth.async_get_user_account(adresse)
        except asyncio.CancelledError:
            raise
        except Exception as err:
            raise ConnectionError(f"Sony antwortet nicht: {err}") from err
        konto = konto_aus_antwort(account)
        tokenstore.save(self._token_datei, konto)
        # Und ins Profil von pyremoteplay, das die Registrierung später
        # ergänzt. Mit ausdrücklichem Pfad: ``Profiles.save()`` ohne Pfad
        # schreibt ins Home-Verzeichnis, den Standardpfad beachtet nur
        # ``load``.
        profiles = Profiles.load(str(self._profil_datei))
        profil = format_user_account(dict(account))
        if profil is not None:
            profiles.update_user(profil)
            profiles.save(str(self._profil_datei))
        self._konto = konto
        self._profile_laden()
        for eid in self._geraete:
            await self._push_gekoppelt(eid)
        self.log.info("PlayStation: PSN-Konto %s hinterlegt", konto["online_id"])
        return konto["online_id"]

    async def pair_pin(self, entity_id: str, pin: Any) -> None:
        """Schritt 2: den Code von der Konsole eintragen (sie muss an sein)."""
        geraet = self._geraete.get(entity_id)
        if geraet is None:
            raise ValueError("Dieses Gerät ist keine PlayStation")
        code = pin_pruefen(pin)
        if self._konto is None:
            raise ValueError(NICHT_GEKOPPELT)
        try:
            from pyremoteplay import RPDevice
            from pyremoteplay.profile import Profiles
        except ImportError as err:
            raise ConnectionError(BIBLIOTHEK_FEHLT) from err
        device = RPDevice(geraet["host"])
        async with self._port_frei():
            try:
                status = await device.async_get_status()
            except asyncio.CancelledError:
                raise
            except Exception as err:
                # Ein Fehler der Bibliothek soll als Satz ankommen, nicht als
                # 500 - der Grund gehört auf den Bildschirm, nicht nur ins Log.
                self.log.exception("PlayStation %s: Statusabfrage gescheitert", geraet["host"])
                raise ConnectionError(f"Statusabfrage gescheitert: {err}") from err
            if not status:
                raise ConnectionError(NICHT_ERREICHBAR)
            if status.get("status-code") != 200:
                raise ValueError(NICHT_AN)
            profiles = Profiles.load(str(self._profil_datei))
            try:
                profil = await device.async_register(
                    self._konto["online_id"], code, profiles=profiles, save=False
                )
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.exception("PlayStation %s: Registrierung gescheitert", geraet["host"])
                raise ConnectionError(f"Registrierung fehlgeschlagen: {err}") from err
        if profil is None:
            raise ConnectionError(
                "Die Konsole hat die Registrierung abgelehnt – stimmt der Code, und "
                "steht «Gerät verbinden» noch auf dem Bildschirm?"
            )
        profiles.save(str(self._profil_datei))
        with contextlib.suppress(OSError):
            self._profil_datei.chmod(0o600)
        self._profile_laden()
        if status.get("host-id"):
            geraet["host_id"] = str(status["host-id"])
        await self._push_gekoppelt(entity_id)
        self.log.info("PlayStation %s registriert", geraet["host"])

    # ── Gerät → Hub ────────────────────────────────────────────────────────

    async def _kanal(self) -> DdpKanal:
        if self._ddp is None:
            self._ddp = await self._kanal_fabrik()
        return self._ddp

    @contextlib.asynccontextmanager
    async def _port_frei(self) -> AsyncIterator[None]:
        """Den Quellport 9303 der Bibliothek überlassen - und danach zurückholen.

        Der Fall aus dem Haus, beim allerersten Koppeln: Der Hub hält den
        Port für seine eigenen Statusanfragen offen (DdpKanal), und
        ``pyremoteplay`` bindet für ``async_get_status`` und die
        Registrierung denselben Port ein zweites Mal - «Address already
        in use», und weil das weder Wert- noch Verbindungsfehler war,
        stand in der App nur «im Hub ist etwas schiefgegangen». Die
        Bibliothek nimmt keinen fremden Socket entgegen; also bekommt sie
        den Port für die Dauer ihres Aufrufs ganz, die Geräteschleife
        wartet am Schloss, und danach öffnet der Hub seinen Kanal neu.
        """
        async with self._ddp_schloss:
            if self._ddp is not None:
                self._ddp.schliessen()
                self._ddp = None
            try:
                yield
            finally:
                with contextlib.suppress(OSError):
                    self._ddp = await self._kanal_fabrik()

    async def _ddp_status(self, entity_id: str) -> dict[str, Any] | None:
        """Eine Statusanfrage an die Konsole - None, wenn sie schweigt."""
        geraet = self._geraete[entity_id]
        async with self._ddp_schloss:
            kanal = await self._kanal()
            roh = await kanal.anfragen(
                geraet["ip"], ddp_ports(geraet.get("konsole")), ddp_suche()
            )
        if roh is None:
            return None
        antwort = ddp_antwort(roh)
        return antwort or None

    async def _refresh(self, entity_id: str) -> None:
        """Eine Runde der Geräteschleife."""
        geraet = self._geraete[entity_id]
        antwort = await self._ddp_status(entity_id)
        if antwort is None:
            if self._erreichbar.get(entity_id, True):
                self.log.info("PlayStation %s antwortet nicht", geraet["host"])
            self._erreichbar[entity_id] = False
            self._sitzung_trennen(entity_id)
            await self.hub.registry.update_state(
                entity_id,
                {"state": "off", "standby": False, "app": None, "title_id": None, "track": None},
                available=False,
            )
            return
        if not self._erreichbar.get(entity_id, False):
            self.log.info("PlayStation %s erreichbar", geraet["host"])
        self._erreichbar[entity_id] = True
        self._status[entity_id] = antwort
        if antwort.get("host-id"):
            geraet["host_id"] = str(antwort["host-id"])
        zustand = konsolenzustand(antwort)
        if zustand.get("konsole"):
            geraet["konsole"] = zustand["konsole"]
        zustand["paired"] = self._ist_gekoppelt(entity_id)
        if zustand["state"] == "off":
            # Im Ruhemodus gibt es keine Sitzung mehr - der Wecker
            # bräuchte sie nicht mehr zu trennen.
            self._sitzung_trennen(entity_id)
        await self.hub.registry.update_state(entity_id, zustand, available=True)

    # ── Hub → Gerät ────────────────────────────────────────────────────────

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        geraet = self._geraete.get(entity.id)
        if geraet is None:
            raise ValueError("Dieses Gerät ist keine PlayStation")
        an = entity.state.get("state") == "on"
        if command == "toggle":
            command = "turn_off" if an else "turn_on"

        if command == "turn_on":
            if an:
                return
            await self._wecken(entity)
            return

        if command == "turn_off":
            if not an:
                # Wie beim Fernseher: «Mach sie aus» an eine Konsole, die
                # schon ruht, ist ein erfüllter Wunsch - und darf keinen
                # Ablauf («niemand mehr zuhause») anhalten.
                self.log.info("%s ruht schon - «turn_off» gilt als erledigt", entity.label)
                return
            await self._standby(entity)
            return

        name = taste(command)
        if name is None:
            raise ValueError(f"Unbekanntes Kommando für die PlayStation: {command}")
        await self._taste(entity, name)

    async def _wecken(self, entity: Entity) -> None:
        """Aufwecken über DDP - geht auch ohne Bibliothek."""
        geraet = self._geraete[entity.id]
        erreichbar = self._erreichbar.get(entity.id, False)
        grund = absage(erreichbar, self._konto is not None)
        if grund:
            raise ConnectionError(grund)
        kennung = weck_kennung(
            self._profile, self._online_id(), geraet.get("host_id"), self._konto
        )
        if kennung is None:
            raise ConnectionError(NICHT_GEKOPPELT)
        kanal = await self._kanal()
        for port in ddp_ports(geraet.get("konsole")):
            kanal.senden(geraet["ip"], port, ddp_wecken(kennung))
        # Auch das Gelingen protokollieren - ein leeres Log unterscheidet
        # nicht zwischen «alles gut» und «kam nie an».
        self.log.info("Weck-Paket an PlayStation %s gesendet", geraet["host"])

    def _sitzung_pruefen(self, entity_id: str) -> None:
        """Was für Standby und Tasten alles da sein muss - sonst ConnectionError."""
        grund = absage(
            self._erreichbar.get(entity_id, False),
            self._konto is not None,
            self._ist_registriert(entity_id),
            remote_play_verfuegbar(),
        )
        if grund:
            raise ConnectionError(grund)

    async def _standby(self, entity: Entity) -> None:
        """In den Ruhemodus - nur über eine Remote-Play-Sitzung."""
        self._sitzung_pruefen(entity.id)
        sitzung = await self._sitzung(entity.id)
        try:
            ergebnis = await sitzung.device.session.async_standby()
            self.log.info(
                "PlayStation %s in den Ruhemodus geschickt (%s)",
                self._geraete[entity.id]["host"],
                ergebnis,
            )
        finally:
            self._sitzung_trennen(entity.id)
        # Die nächste DDP-Runde bestätigt es; bis dahin soll die Kachel
        # nicht so tun, als wäre nichts geschehen.
        await self.hub.registry.update_state(
            entity.id, {"state": "off", "standby": True, "app": None, "title_id": None, "track": None}
        )

    async def _taste(self, entity: Entity, name: str) -> None:
        """Eine Taste drücken - in einer kurzlebigen Sitzung."""
        self._sitzung_pruefen(entity.id)
        if entity.state.get("state") != "on":
            raise ConnectionError(NICHT_AN)
        sitzung = await self._sitzung(entity.id)
        try:
            await sitzung.device.controller.async_button(name)
        except asyncio.CancelledError:
            raise
        except Exception as err:
            self._sitzung_trennen(entity.id)
            raise ConnectionError(f"Taste {name} ging ins Leere: {err}") from err
        self.log.info("Taste %s an %s gesendet", name, entity.id)
        self._wecker_stellen(entity.id)

    # ── Die Remote-Play-Sitzung ────────────────────────────────────────────

    async def _sitzung(self, entity_id: str) -> Sitzung:
        """Die offene Sitzung dieser Konsole - oder eine neue."""
        schloss = self._schloss.setdefault(entity_id, asyncio.Lock())
        async with schloss:
            offen = self._sitzungen.get(entity_id)
            if offen is not None and self._sitzung_lebt(offen):
                return offen
            if offen is not None:
                self._sitzung_trennen(entity_id)
            sitzung = Sitzung(device=await self._sitzung_aufbauen(entity_id))
            self._sitzungen[entity_id] = sitzung
            self._wecker_stellen(entity_id)
            return sitzung

    @staticmethod
    def _sitzung_lebt(sitzung: Sitzung) -> bool:
        session = getattr(sitzung.device, "session", None)
        return session is not None and bool(getattr(session, "is_ready", False))

    async def _sitzung_aufbauen(self, entity_id: str) -> Any:
        """Remote Play ohne Video verbinden und auf «bereit» warten."""
        from pyremoteplay import RPDevice
        from pyremoteplay.profile import Profiles

        geraet = self._geraete[entity_id]
        konto = self._konto or {}
        device = RPDevice(geraet["host"])
        # Auch hier braucht die Bibliothek den Quellport 9303 für ihre
        # eigene Statusabfrage (siehe _port_frei).
        async with self._port_frei():
            try:
                status = await device.async_get_status()
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.exception("PlayStation %s: Statusabfrage gescheitert", geraet["host"])
                raise ConnectionError(f"Statusabfrage gescheitert: {err}") from err
            if not status:
                raise ConnectionError(NICHT_ERREICHBAR)
            if status.get("status-code") != 200:
                raise ConnectionError(NICHT_AN)
            profiles = Profiles.load(str(self._profil_datei))
            session = device.create_session(
                konto.get("online_id", ""), profiles=profiles, receiver=None
            )
            if session is None:
                raise ConnectionError(NICHT_REGISTRIERT)
            try:
                verbunden = await asyncio.wait_for(device.connect(), SITZUNG_AUFBAU)
                bereit = verbunden and await session.async_wait(SITZUNG_AUFBAU)
            except TimeoutError:
                bereit = False
        if not bereit:
            fehler = str(getattr(session, "error", "") or "").strip()
            with contextlib.suppress(Exception):
                device.disconnect()
            raise ConnectionError(f"{SITZUNG_FEHLGESCHLAGEN} ({fehler})" if fehler else SITZUNG_FEHLGESCHLAGEN)
        self.log.info("Remote-Play-Sitzung mit %s offen", geraet["host"])
        return device

    def _wecker_stellen(self, entity_id: str) -> None:
        """Nach jeder Taste neu: In SITZUNG_LEERLAUF Sekunden wird getrennt."""
        sitzung = self._sitzungen.get(entity_id)
        if sitzung is None:
            return
        if sitzung.wecker is not None:
            sitzung.wecker.cancel()
        sitzung.wecker = self.start_task(self._sitzung_verfaellt(entity_id, sitzung))

    async def _sitzung_verfaellt(self, entity_id: str, sitzung: Sitzung) -> None:
        await asyncio.sleep(SITZUNG_LEERLAUF)
        if self._sitzungen.get(entity_id) is sitzung:
            self.log.info("Remote-Play-Sitzung mit %s getrennt (keine Taste mehr)", entity_id)
            self._sitzung_trennen(entity_id)

    def _sitzung_trennen(self, entity_id: str) -> None:
        sitzung = self._sitzungen.pop(entity_id, None)
        if sitzung is None:
            return
        if sitzung.wecker is not None and sitzung.wecker is not asyncio.current_task():
            sitzung.wecker.cancel()
        with contextlib.suppress(Exception):
            sitzung.device.disconnect()

    def health(self) -> dict[str, Any]:
        """Für die Systemseite: Konto, Registrierung, Bibliothek."""
        return {
            "account": self._online_id(),
            "remote_play": remote_play_verfuegbar(),
            "paired": {eid: self._ist_gekoppelt(eid) for eid in self._geraete},
        }


INTEGRATION = PlaystationIntegration


# ── Vor Ort nachsehen ──────────────────────────────────────────────────────
# Aufruf:  python -m homepilot.integrations.playstation 192.168.1.60
# Schickt eine Statusanfrage und zeigt roh, was die Konsole antwortet -
# die erste Frage, wenn die Kachel «nicht erreichbar» sagt.


async def _nachsehen(host: str) -> int:
    kanal = await DdpKanal.oeffnen()
    try:
        roh = await kanal.anfragen(host, ddp_ports(None), ddp_suche())
    finally:
        kanal.schliessen()
    if roh is None:
        print(f"✗ {host} antwortet nicht (ganz aus, anderes Netz, oder Port 9303 belegt?)")
        return 1
    print(roh.decode("utf-8", "replace"))
    print("→", konsolenzustand(ddp_antwort(roh)))
    return 0


if __name__ == "__main__":  # pragma: no cover
    import sys

    if len(sys.argv) != 2:
        print("Aufruf: python -m homepilot.integrations.playstation <host>")
        raise SystemExit(2)
    raise SystemExit(asyncio.run(_nachsehen(sys.argv[1])))
