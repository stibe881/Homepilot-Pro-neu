"""Nuki Smart Lock – auf-/abschliessen und aufziehen (unlatch).

Konfiguration:
  - integration: nuki
    token: "${NUKI_TOKEN}"
    scan_interval: 60

Einmalige Einrichtung (~2 Minuten):
  1. In der Nuki-App sicherstellen, dass «Nuki Web» aktiviert ist
     (Smart Lock → Einstellungen → Funktionen & Konfiguration → Nuki Web).
  2. Auf https://web.nuki.io anmelden → Menü «API» → Token erzeugen.
     Haken bei den Smart-Lock-Berechtigungen (Anzeigen + Bedienen) setzen.
  3. Token als NUKI_TOKEN in die .env eintragen, Hub neu starten.

Das Smart Lock Pro (4./5. Generation) hängt selbst im WLAN – der Hub spricht
über die Nuki-Web-API mit ihm. Kommandos: lock, unlock und unlatch
(aufschliessen UND die Falle ziehen, die Tür geht auf).
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Any

import aiohttp

from ..core import heimgruss, pushziel
from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration
from .geofence import zonenkennung

API = "https://api.nuki.io"

# Zustandscodes der Web-API (smartlock.state.state).
STATES: dict[int, str] = {
    0: "uncalibrated",
    1: "locked",
    2: "unlocking",
    3: "unlocked",
    4: "locking",
    5: "unlatched",
    6: "unlocked",       # lock'n'go aktiv
    7: "unlatching",
    254: "motor_blocked",
    255: "unknown",
}

# App-Kommando → Aktionscode der Web-API.
ACTIONS: dict[str, int] = {
    "unlock": 1,
    "lock": 2,
    "unlatch": 3,
}

# Gerätetyp 2 ist der Nuki Opener (Gegensprechanlage) – dafür haben wir Ring.
OPENER_TYPE = 2

# ── Das Protokoll des Schlosses (Punkt 616 der Werkbank) ─────────────────
#
# /smartlock liefert Zustand, Batterie und Türsensor - aber nicht, *wer*
# aufgeschlossen hat. Das steht in /smartlock/{id}/log: je Eintrag die
# Aktion, der Auslöser (Keypad, App, Auto-Unlock, Knopf …) und der Name
# des Berechtigten. Ein Kind mit Keypad-Code kommt heim, und das Haus
# erfuhr es bisher nur über das Telefon, das es nicht hat.

#: Aktionscodes im Protokoll, die ein Aufschliessen sind. 4 und 5 sind
#: «Lock 'n' Go» - die enden abgeschlossen und zählen deshalb nicht.
LOG_UNLOCK_ACTIONS: dict[int, str] = {1: "unlock", 3: "unlatch"}

#: Der Weg, auf dem aufgeschlossen wurde, aus dem Feld ``trigger``:
#: 0 = System (Nuki-App über Bluetooth), 1 = von Hand (Schlüssel oder
#: Drehknopf), 2 = Knopf am Schloss, 3 = Zeitplan, 4 = Nuki Web (auch
#: HomePilot), 5 = App, 6 = Auto-Lock, 7 = Zubehör, 255 = Keypad.
TRIGGER_WEGE: dict[int, str] = {
    0: "App",
    1: "von Hand",
    2: "Knopf",
    3: "Zeitplan",
    4: "Web",
    5: "App",
    6: "Auto-Lock",
    7: "Zubehör",
    255: "Code",
}

#: Genauer als der Auslöser, wo das Feld ``source`` gesetzt ist: Am
#: Keypad 2.0 unterscheidet Nuki den Code vom Fingerabdruck.
SOURCE_WEGE: dict[int, str] = {1: "Code", 2: "Fingerabdruck"}

#: Wege, die von draussen kommen - nur dann ist ein Aufschliessen ein
#: Heimkommen, auf das der Anrufbeantworter des Hauses antworten darf
#: (core/heimgruss.py). Wer von innen den Knopf drückt oder vom Sofa
#: aus per App öffnet, kommt nicht heim.
ANKUNFT_WEGE = frozenset({"Code", "Fingerabdruck", "Auto-Unlock"})

#: So viele Einträge holt der Poll - mehr passieren in einer Minute nicht.
LOG_LIMIT = 20


def log_zeitpunkt(wert: Any) -> float | None:
    """Das ``date`` eines Protokolleintrags als Unix-Zeit (rein, testbar).

    Nuki schreibt ISO mit «Z» (``2026-09-13T13:42:07.000Z``); Python 3.11
    liest das direkt. Was sich nicht lesen lässt, ist kein Eintrag.
    """
    if not isinstance(wert, str) or not wert:
        return None
    try:
        return datetime.fromisoformat(wert.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def log_weg(eintrag: dict[str, Any]) -> str:
    """Wie aufgeschlossen wurde, in einem Wort (rein, testbar)."""
    if eintrag.get("autoUnlock"):
        return "Auto-Unlock"
    try:
        quelle = SOURCE_WEGE.get(int(eintrag.get("source") or 0))
    except (TypeError, ValueError):
        quelle = None
    if quelle:
        return quelle
    try:
        return TRIGGER_WEGE.get(int(eintrag.get("trigger") or 0), "unbekannt")
    except (TypeError, ValueError):
        return "unbekannt"


def log_eintraege(payload: Any, seit: float | None) -> list[dict[str, Any]]:
    """Die neuen, geglückten Aufschliess-Einträge, älteste zuerst (rein, testbar).

    ``seit`` ist der Zeitpunkt des zuletzt gesehenen Eintrags; was nicht
    jünger ist, wurde schon gemeldet. ``state`` 0 heisst geglückt - ein
    blockierter Motor (1) hat nichts aufgeschlossen und meldet auch
    niemanden als angekommen.
    """
    gefunden: list[dict[str, Any]] = []
    for eintrag in payload if isinstance(payload, list) else []:
        if not isinstance(eintrag, dict):
            continue
        try:
            aktion = LOG_UNLOCK_ACTIONS.get(int(eintrag.get("action") or 0))
        except (TypeError, ValueError):
            continue
        if aktion is None or int(eintrag.get("state") or 0) != 0:
            continue
        at = log_zeitpunkt(eintrag.get("date"))
        if at is None or (seit is not None and at <= seit):
            continue
        gefunden.append(
            {
                "by": str(eintrag.get("name") or "").strip(),
                "via": log_weg(eintrag),
                "at": at,
                "action": aktion,
            }
        )
    gefunden.sort(key=lambda e: e["at"])
    return gefunden


def neuester_zeitpunkt(payload: Any) -> float | None:
    """Der jüngste Eintrag im Protokoll, gleich welcher Art (rein, testbar).

    Der Anfang der Zählung beim Start: Was vor dem Hub war, wird nicht
    nachgemeldet - sonst käme nach jedem Neustart die Türe von gestern.
    """
    zeiten = [
        at
        for eintrag in (payload if isinstance(payload, list) else [])
        if isinstance(eintrag, dict)
        for at in [log_zeitpunkt(eintrag.get("date"))]
        if at is not None
    ]
    return max(zeiten) if zeiten else None


def unlock_satz(eintrag: dict[str, Any], label: str) -> tuple[str, str]:
    """Titel und Text der Nachricht (rein, testbar).

    «Haustüre aufgeschlossen» / «Livia hat um 15:42 per Code
    aufgeschlossen.» - wer, womit, wann; mehr braucht die Zeile nicht.
    """
    wer = eintrag.get("by") or "Jemand"
    uhr = datetime.fromtimestamp(float(eintrag.get("at") or 0)).strftime("%H:%M")
    womit = {
        "Code": "per Code",
        "Fingerabdruck": "per Fingerabdruck",
        "App": "per App",
        "Web": "per App",
        "Auto-Unlock": "per Auto-Unlock",
        "von Hand": "von Hand",
        "Knopf": "am Knopf",
        "Zeitplan": "nach Zeitplan",
    }.get(str(eintrag.get("via") or ""))
    verb = "geöffnet" if eintrag.get("action") == "unlatch" else "aufgeschlossen"
    text = f"{wer} hat um {uhr} {womit} {verb}." if womit else f"{wer} hat um {uhr} {verb}."
    return f"{label} {verb}", text


def action_error(status: int, body: str) -> str:
    """Aus einer abgelehnten Aktion einen brauchbaren Satz machen (rein).

    Nuki antwortet im Fehlerfall mit einem Java-Stapelabbild
    (``{"stackTrace":[],"suppressedExceptions":[]}``). Das in die App zu
    reichen hilft niemandem - man liest es dreimal und weiss danach
    gleich viel. Der Statuscode dagegen sagt ziemlich genau, woran es
    liegt.
    """
    if status == 423:
        return (
            "Das Schloss ist gerade nicht erreichbar. Den Zustand liefert "
            "Nuki aus dem Zwischenspeicher, zum Schalten braucht es aber "
            "eine lebende Verbindung - Bridge stromlos, WLAN weg oder das "
            "Schloss antwortet nicht."
        )
    if status == 401:
        return (
            "Der Nuki-Zugang gilt nicht mehr. Im Nuki-Web-Konto unter "
            "«API» ein neues Token erzeugen und als NUKI_TOKEN hinterlegen."
        )
    if status == 403:
        return (
            "Der Nuki-Zugang darf diese Aktion nicht. Beim Token fehlt das "
            "Recht «smartlock.action»."
        )
    if status == 404:
        return (
            "Nuki kennt dieses Schloss nicht mehr - wurde es neu gekoppelt "
            "oder aus dem Konto entfernt?"
        )
    if status == 429:
        return "Zu viele Anfragen an Nuki. Kurz warten und nochmals."
    if status >= 500:
        return f"Der Nuki-Dienst hat ein Problem (HTTP {status})."
    # Unbekanntes ehrlich durchreichen - aber ohne das leere Stapelabbild,
    # das in jeder Antwort steht und nie etwas beiträgt. Über den Parser
    # statt über Textersatz: Sonst bleiben Kommas zurück, wo die
    # entfernten Felder standen.
    text = body.strip()
    try:
        payload = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        payload = None
    if isinstance(payload, dict):
        rest = {
            key: value
            for key, value in payload.items()
            if key not in ("stackTrace", "suppressedExceptions") and value not in ([], {}, None, "")
        }
        text = json.dumps(rest, ensure_ascii=False) if rest else ""
    if not text or text == "{}":
        return f"Nuki lehnt die Aktion ab (HTTP {status})."
    return f"Nuki lehnt die Aktion ab (HTTP {status}): {text[:160]}"


def lock_state(payload: dict[str, Any]) -> dict[str, Any]:
    """Übersetzt einen /smartlock-Eintrag in Entitäts-Attribute (rein, testbar)."""
    state = payload.get("state") or {}
    code = state.get("state")
    result: dict[str, Any] = {
        "state": STATES.get(int(code), "unknown") if code is not None else "unknown",
    }
    battery = state.get("batteryCharge")
    if isinstance(battery, (int, float)):
        result["battery"] = round(battery)
    if state.get("batteryCritical"):
        result["battery_critical"] = True
    # Türsensor (Pro-Modelle): 2 = zu, 3 = offen.
    door = state.get("doorState")
    if door in (2, 3):
        result["door"] = "closed" if door == 2 else "open"
    return result


class NukiIntegration(Integration):
    name = "nuki"

    async def setup(self) -> None:
        token = self.config.get("token")
        if not token:
            raise ConfigError(
                "nuki braucht 'token' – auf web.nuki.io unter «API» erzeugen "
                "(Nuki Web muss in der Nuki-App aktiviert sein)"
            )
        self._headers = {"Authorization": f"Bearer {token}"}
        self._interval = self.scan_interval()
        self._session = self.http_session(timeout=aiohttp.ClientTimeout(total=20))

        # entity_id → smartlockId
        self._ids: dict[str, int] = {}
        # entity_id → Zeitpunkt des zuletzt gesehenen Protokolleintrags
        # (Punkt 616). Wer fehlt, bekommt beim ersten Lesen nur den
        # Anfang gesetzt und noch keine Meldung.
        self._log_seit: dict[str, float] = {}
        try:
            locks = await self._fetch_locks()
        except Exception as err:
            raise ConfigError(f"Nuki-Web-API nicht erreichbar: {err}") from err
        if not locks:
            raise ConfigError(
                "Kein Smart Lock im Nuki-Konto gefunden – ist Nuki Web in der "
                "Nuki-App aktiviert?"
            )

        for lock in locks:
            if lock.get("type") == OPENER_TYPE:
                continue
            smartlock_id = int(lock["smartlockId"])
            entity = await self.add_entity(
                str(smartlock_id),
                EntityKind.LOCK,
                lock.get("name") or "Wohnungstüre",
                state=lock_state(lock),
                commands=list(ACTIONS),
            )
            self._ids[entity.id] = smartlock_id
            self.log.info(
                "Nuki: %s (%s)", lock.get("name"), lock_state(lock)["state"]
            )

        self.start_polling(self._refresh, interval=self._interval)

    async def _fetch_locks(self) -> list[dict[str, Any]]:
        async with self._session.get(
            f"{API}/smartlock", headers=self._headers
        ) as response:
            if response.status == 401:
                raise ConfigError(
                    "Nuki-Token ungültig – auf web.nuki.io ein neues erzeugen"
                )
            response.raise_for_status()
            return await response.json()

    async def _refresh(self) -> None:
        try:
            locks = await self._fetch_locks()
        except Exception as err:
            self.log.warning("Nuki nicht erreichbar: %s", err)
            for entity_id in self._ids:
                await self.hub.registry.update_state(entity_id, {}, available=False)
            return
        by_id = {int(lock["smartlockId"]): lock for lock in locks}
        for entity_id, smartlock_id in self._ids.items():
            lock = by_id.get(smartlock_id)
            if lock is None:
                await self.hub.registry.update_state(entity_id, {}, available=False)
                continue
            await self.hub.registry.update_state(
                entity_id, lock_state(lock), available=True
            )
            await self._log_pruefen(entity_id, smartlock_id)

    # ── Wer hat aufgeschlossen? (Punkt 616 der Werkbank) ───────────────────

    async def _log_holen(self, smartlock_id: int) -> Any:
        async with self._session.get(
            f"{API}/smartlock/{smartlock_id}/log",
            headers=self._headers,
            params={"limit": LOG_LIMIT},
        ) as response:
            response.raise_for_status()
            return await response.json()

    async def _log_pruefen(self, entity_id: str, smartlock_id: int) -> None:
        """Das Protokoll ab dem letzten gesehenen Eintrag lesen und melden.

        Ein Fehler hier ist keiner für das Schloss: Der Zustand steht
        schon, und das Protokoll kommt beim nächsten Durchgang wieder.
        """
        try:
            payload = await self._log_holen(smartlock_id)
        except Exception as err:  # noqa: BLE001 - ein verpasstes Protokoll ist kein Grund
            self.log.debug("Nuki-Protokoll nicht lesbar: %s", err)
            return
        if entity_id not in self._log_seit:
            # Der Anfang der Zählung: Was vor dem Hub war, wird nicht
            # nachgemeldet - sonst käme nach jedem Neustart die Türe von
            # gestern.
            self._log_seit[entity_id] = neuester_zeitpunkt(payload) or 0.0
            return
        neue = log_eintraege(payload, self._log_seit[entity_id])
        if not neue:
            return
        self._log_seit[entity_id] = max(e["at"] for e in neue)
        entity = self.hub.registry.get(entity_id)
        label = entity.label if entity else "Türe"
        # Der letzte Eintrag im Zustand - so zeigt die Kachel «Aufgeschlossen
        # · Livia (Code) · 15:42», und der Zustands-Auslöser der Abläufe kann
        # auf last_unlock reagieren.
        letzter = neue[-1]
        await self.hub.registry.update_state(
            entity_id,
            {"last_unlock": {"by": letzter["by"], "via": letzter["via"], "at": letzter["at"]}},
        )
        for eintrag in neue:
            await self._aufschliessen_melden(entity_id, label, eintrag)

    async def _aufschliessen_melden(
        self, entity_id: str, label: str, eintrag: dict[str, Any]
    ) -> None:
        await self.hub.bus.publish(
            "door_unlocked", {"entity_id": entity_id, "name": label, **eintrag}
        )
        titel, text = unlock_satz(eintrag, label)
        try:
            tokens = self.hub.push.recipients(self.hub.users.users, "all", "door")
            if tokens:
                await self.hub.push.send(
                    tokens,
                    title=titel,
                    body=text,
                    data={
                        "type": "door",
                        "entity_id": entity_id,
                        "ziel": pushziel.ziel_fuer("door", entity_id),
                    },
                    category="door",
                )
        except Exception as err:  # noqa: BLE001
            self.log.warning("Nuki: Aufschliessen nicht gemeldet: %s", err)
        # Der Anrufbeantworter des Hauses (core/heimgruss.py): Wer per Code
        # heimkommt, hat kein Telefon dabei - genau dafür gibt es das Band.
        # Die Zonenkennung wie beim Geofence, damit der Hinterleger seine
        # eigene Nachricht nicht verbraucht.
        if eintrag.get("by") and eintrag.get("via") in ANKUNFT_WEGE:
            try:
                await heimgruss.bei_ankunft(
                    self.hub, zonenkennung(str(eintrag["by"])), str(eintrag["by"])
                )
            except Exception as err:  # noqa: BLE001
                self.log.warning("Heimgruss bei %s nicht abgespielt: %s", eintrag["by"], err)

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        action = ACTIONS.get(command)
        if action is None:
            raise ConfigError(f"Nuki kennt das Kommando '{command}' nicht")
        smartlock_id = self._ids[entity.id]
        async with self._session.post(
            f"{API}/smartlock/{smartlock_id}/action",
            headers=self._headers,
            json={"action": action},
        ) as response:
            if response.status >= 400:
                detail = await response.text()
                message = action_error(response.status, detail)
                self.log.warning(
                    "Nuki '%s': %s (HTTP %d, Antwort: %s)",
                    entity.label,
                    command,
                    response.status,
                    detail[:200],
                )
                raise ConnectionError(message)
        # Optimistisch den Zwischenzustand melden; danach nachfassen, bis
        # das Schloss wirklich steht.
        moving = {"unlock": "unlocking", "lock": "locking", "unlatch": "unlatching"}
        await self.hub.registry.update_state(entity.id, {"state": moving[command]})
        self.start_task(self._settle(entity.id))

    # Zustände, bei denen das Schloss noch dreht - solange lohnt das
    # Nachfragen.
    MOVING_STATES = frozenset({"locking", "unlocking", "unlatching"})
    # Wann nach einem Befehl nachgesehen wird, in Sekunden ab dem Befehl.
    # Ein Nuki braucht rund fünf Sekunden für eine Umdrehung; die eine
    # Abfrage nach drei Sekunden, die hier früher stand, traf es also
    # mitten in der Bewegung - und danach kam bis zum nächsten regulären
    # Durchgang eine Minute lang nichts mehr. Genau so fühlt sich die
    # Kachel an, als hinge sie.
    SETTLE_DELAYS = (3, 3, 4, 5, 8)

    async def _settle(self, entity_id: str) -> None:
        """Nach einem Befehl mehrmals nachsehen, bis das Schloss steht."""
        for delay in self.SETTLE_DELAYS:
            await asyncio.sleep(delay)
            try:
                await self._refresh()
            except Exception as err:  # eine verpasste Abfrage ist kein Grund
                self.log.debug("Nuki-Nachfrage fehlgeschlagen: %s", err)
                continue
            entity = self.hub.registry.get(entity_id)
            if entity is None:
                return
            if str(entity.state.get("state")) not in self.MOVING_STATES:
                return


INTEGRATION = NukiIntegration
