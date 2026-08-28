"""Plex: was gerade läuft – als Karte und als Auslöser.

Konfiguration:
  - integration: plex
    host: 192.168.1.10
    port: 32400
    token: "${PLEX_TOKEN}"
    scan_interval: 30

Den Token zeigt Plex selbst: in der Web-App ein Medium öffnen → «…» →
«Informationen» → «XML anzeigen» - in der Adresse steht X-Plex-Token.
Gefragt wird nur der eigene Server im eigenen Netz; zur Plex-Wolke
redet der Hub nicht.

Bewusst **eine** Kachel für den Server, nicht eine je Abspielgerät:
Abspielgeräte kommen und gehen (das iPad von heute Abend ist morgen
weg), und die Frage im Alltag ist «läuft gerade etwas?» - nicht «was
könnte theoretisch abspielen?». Läuft mehreres, zeigt die Kachel das
erste und zählt den Rest.

Steuern kann die Kachel nichts, und das ist ehrlich: Plex spielt auf
dem Gerät, nicht auf dem Server - pausieren müsste man dort. Wozu sie
trotzdem da ist: «Film startet → Licht dimmen» als Ablauf (Auslöser
auf state → playing), und der Blick aufs Haus weiss, dass im
Wohnzimmer ein Film läuft.
"""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

from ..core.entity import EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration


def sessions_lesen(payload: Any) -> list[dict[str, Any]]:
    """Die laufenden Wiedergaben aus /status/sessions (rein, testbar)."""
    container = (payload or {}).get("MediaContainer") or {}
    raus: list[dict[str, Any]] = []
    for eintrag in container.get("Metadata") or []:
        if not isinstance(eintrag, dict):
            continue
        spieler = eintrag.get("Player") or {}
        benutzer = eintrag.get("User") or {}
        titel = str(eintrag.get("title") or "")
        # Bei einer Serie ist die Antwort auf «was läuft?» die Serie,
        # nicht der Episodentitel («Folge 7» sagt nichts).
        serie = str(eintrag.get("grandparentTitle") or "")
        dauer = eintrag.get("duration")
        stand = eintrag.get("viewOffset")
        prozent = None
        try:
            if dauer:
                prozent = round(float(stand or 0) / float(dauer) * 100)
        except (TypeError, ValueError, ZeroDivisionError):
            prozent = None
        raus.append(
            {
                "title": f"{serie} – {titel}" if serie else titel,
                "user": str(benutzer.get("title") or ""),
                "player": str(spieler.get("title") or ""),
                "state": str(spieler.get("state") or "playing"),
                "progress": prozent,
            }
        )
    return raus


def zustand(sessions: list[dict[str, Any]]) -> dict[str, Any]:
    """Der Kachel-Zustand aus den Wiedergaben (rein, testbar).

    Spielt eines, gewinnt es gegen Pausiertes: «playing» ist die
    Auskunft, an der Abläufe hängen.
    """
    laufend = [s for s in sessions if s.get("state") == "playing"]
    erste = (laufend or sessions or [None])[0]
    if erste is None:
        return {
            "state": "idle",
            "title": None,
            "user": None,
            "player": None,
            "progress": None,
            "sessions": 0,
        }
    return {
        "state": "playing" if laufend else "paused",
        "title": erste["title"],
        "user": erste["user"] or None,
        "player": erste["player"] or None,
        "progress": erste["progress"],
        "sessions": len(sessions),
    }


class PlexIntegration(Integration):
    name = "plex"

    async def setup(self) -> None:
        host = self.config.get("host")
        if not host:
            raise ConfigError("plex braucht 'host' in der Konfiguration")
        token = str(self.config.get("token") or "")
        if not token:
            raise ConfigError(
                "plex braucht 'token' - in der Plex-Web-App: Medium → «…» → "
                "Informationen → «XML anzeigen», in der Adresse steht X-Plex-Token"
            )
        port = int(self.config.get("port", 32400))
        self._base = f"http://{host}:{port}"
        self._headers = {"X-Plex-Token": token, "Accept": "application/json"}
        self._interval = self.scan_interval()
        self._session = self.http_session(timeout=aiohttp.ClientTimeout(total=15))

        await self.add_entity(
            "server",
            EntityKind.MEDIA_PLAYER,
            self.config.get("name", "Plex"),
            state={"state": "idle", "sessions": 0},
            available=False,
        )
        self.start_task(self._poll_loop())

    async def _poll_loop(self) -> None:
        while True:
            await self._refresh()
            await asyncio.sleep(self._interval)

    async def _refresh(self) -> None:
        entity_id = self.entity_id("server")
        try:
            async with self._session.get(
                f"{self._base}/status/sessions", headers=self._headers
            ) as antwort:
                antwort.raise_for_status()
                payload = await antwort.json(content_type=None)
        except Exception as err:
            self.log.debug("Plex nicht erreichbar: %s", err)
            await self.hub.registry.update_state(entity_id, {}, available=False)
            return
        await self.hub.registry.update_state(
            entity_id,
            # Felder, die verschwinden können (title bei Stille), stehen
            # ausdrücklich als None im Zustand - die Registry merged.
            zustand(sessions_lesen(payload)),
            available=True,
        )


INTEGRATION = PlexIntegration
