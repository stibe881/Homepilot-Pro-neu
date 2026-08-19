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
from typing import Any

import aiohttp

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

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
        self._interval = float(self.config.get("scan_interval", 60))
        self._session = self.http_session(timeout=aiohttp.ClientTimeout(total=20))

        # entity_id → smartlockId
        self._ids: dict[str, int] = {}
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

        self.start_task(self._poll_loop())

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

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self._refresh()

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
                    entity.name,
                    command,
                    response.status,
                    detail[:200],
                )
                raise ConnectionError(message)
        # Optimistisch den Zwischenzustand melden; kurz danach echten Stand holen.
        moving = {"unlock": "unlocking", "lock": "locking", "unlatch": "unlatching"}
        await self.hub.registry.update_state(entity.id, {"state": moving[command]})
        await asyncio.sleep(3)
        await self._refresh()


INTEGRATION = NukiIntegration
