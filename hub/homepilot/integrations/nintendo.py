"""Nintendo Switch (und Switch 2) über die Kindersicherung (Punkt 748, Teil C).

Konfiguration in der config.yaml:

  - integration: nintendo
    timezone: Europe/Zurich     # Voreinstellung
    lang: de-CH                 # Voreinstellung

Angemeldet wird einmal, mit dem Nintendo-Konto, das in der Nintendo
Switch Parental Controls-App die Konsole verwaltet (Anmeldeschritte:
docs/nintendo.md). Danach liegt ein Sitzungsschlüssel in
``nintendo-token.json`` neben der Datendatei.

**Was das kann und was nicht - ehrlich, weil es die ganze Konsolenzeit
trägt:**

- Es gibt **keinen Befehl «Konsole aus»**. Der Hub stellt stattdessen die
  Höchstzeit von heute (``set_limit``), und die Konsole beendet das Spiel
  selbst («Software unterbrechen»). Die Grenze gilt für die **Konsole**,
  nicht pro Kind; wer am Controller sitzt, weiss die Schnittstelle nicht.
- Alles läuft über Nintendos Cloud. Die Konsole meldet ihre Spielzeit
  erst, wenn sie online ist und sich abgleicht - der Stand hinkt hinterher,
  auf Minuten genau und nicht auf Sekunden. Darum ist ``state`` hier eine
  Ableitung («die Spielzeit ist zuletzt gewachsen»), kein Messwert; sie
  trägt ``verzoegert: True``.
- Die Schnittstelle ist **inoffiziell** (Bibliothek ``pynintendoparental``)
  und kann sich ohne Vorwarnung ändern. Die Bibliothek kennt die
  Switch 2 (Gerätekennung ``P01``) - ob die Steuerung dort wirklich greift,
  lässt sich nur an der echten Konsole klären: ``python -m
  homepilot.integrations.nintendo`` zeigt, was Nintendo meldet.

Die Höchstzeit, die vorher an der Konsole stand, geht nicht verloren: Der
Hub merkt sie sich beim ersten Eingriff (``limit_vorher``) und stellt sie
zurück, wenn er die Konsole wieder loslässt (``set_limit`` ohne Minuten).
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from ..core import tokenstore
from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError, HomePilotError
from ..core.integration import Integration

log = logging.getLogger(__name__)

#: Wie lange nach dem letzten Wachstum der Spielzeit die Konsole noch als
#: «an» gilt. Nintendo meldet minutengenau und mit Verzug: Wer spielt,
#: wächst nicht in jedem Abruf. Drei Minuten fangen einen ausgelassenen
#: Abgleich ab, ohne dass eine ausgeschaltete Switch lange weiterläuft.
AN_NACH_WACHSTUM = 180.0
#: Obergrenze der Höchstzeit, die Nintendo annimmt (Minuten).
MAX_LIMIT = 360
#: Wie viele Abrufe in Folge scheitern dürfen, bevor die Konsole als
#: «nicht erreichbar» gilt (siehe docs/neue-integration.md).
FEHLER_BIS_NICHT_ERREICHBAR = 3


def limit_wert(minuten: Any) -> int:
    """Die Höchstzeit, wie Nintendo sie annimmt (rein, testbar).

    -1 heisst «keine Grenze»; sonst eine ganze Zahl von 0 bis 360. Alles
    Weitere ist Unsinn, und Unsinn an der Konsole einer Familie ist
    schlimmer als ein Fehler.
    """
    try:
        zahl = int(minuten)
    except (TypeError, ValueError) as err:
        raise HomePilotError("Die Höchstzeit muss eine ganze Zahl in Minuten sein.") from err
    if zahl == -1:
        return -1
    if not 0 <= zahl <= MAX_LIMIT:
        raise HomePilotError(f"Nintendo nimmt 0 bis {MAX_LIMIT} Minuten oder -1 (keine Grenze).")
    return zahl


def laeuft_gerade(
    minuten: int, vorher: tuple[int, float] | None, jetzt: float
) -> tuple[bool, tuple[int, float]]:
    """Ob die Spielzeit zuletzt gewachsen ist - und der neue Merker (rein, testbar).

    ``vorher`` ist (Minuten, Zeitpunkt des letzten Wachstums). Wächst die
    Zahl, ist jetzt «letztes Wachstum»; sinkt sie (Mitternacht, neuer
    Tag), beginnt die Zählung von vorn und die Konsole gilt als aus.
    """
    if vorher is None:
        return False, (minuten, 0.0)
    alt, wann = vorher
    if minuten > alt:
        return True, (minuten, jetzt)
    if minuten < alt:
        return False, (minuten, 0.0)
    return (jetzt - wann) <= AN_NACH_WACHSTUM and wann > 0, (alt, wann)


def zustand(geraet: Any, an: bool) -> dict[str, Any]:
    """Der Zustand der Kachel aus dem, was Nintendo meldet (rein, testbar)."""
    return {
        "state": "on" if an else "off",
        "model": getattr(geraet, "model", None),
        "playing_min": int(getattr(geraet, "today_playing_time", 0) or 0),
        "remaining_min": _zahl(getattr(geraet, "today_time_remaining", None)),
        "limit_min": _zahl(getattr(geraet, "limit_time", None)),
        "month_min": int(getattr(geraet, "month_playing_time", 0) or 0),
        "forced_termination": bool(getattr(geraet, "forced_termination_mode", False)),
        "last_sync": getattr(geraet, "last_sync", None),
        # Die Spielzeit kommt, wenn die Konsole sich abgleicht - nicht live.
        "verzoegert": True,
    }


def _zahl(wert: Any) -> int | None:
    try:
        return None if wert is None else int(wert)
    except (TypeError, ValueError):
        return None


def objekt_id(device_id: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in str(device_id)).lower()


# ── Die Bibliothek ─────────────────────────────────────────────────────

#: (Sitzungsschlüssel, aiohttp-Sitzung, Zeitzone, Sprache) → Kindersicherung.
Fabrik = Callable[[str, Any, str, str], Awaitable[Any]]


async def _echte_fabrik(token: str, session: Any, zeitzone: str, sprache: str) -> Any:
    try:
        from pynintendoparental import Authenticator, NintendoParental
    except ImportError as err:
        raise ConfigError(
            "Die Nintendo-Anbindung braucht das Extra 'nintendo' (pynintendoparental)."
        ) from err
    auth = Authenticator(session_token=token, client_session=session)
    await auth.async_complete_login(use_session_token=True)
    return await NintendoParental.create(auth, timezone=zeitzone, lang=sprache)


def _echte_anmeldung(session: Any) -> Any:
    from pynintendoparental import Authenticator

    return Authenticator(client_session=session)


class NintendoIntegration(Integration):
    name = "nintendo"

    async def setup(self) -> None:
        data_file = getattr(self.hub.config, "data_file", None)
        self._token_datei: Path = tokenstore.token_file(data_file, self.config, "nintendo")
        self._zeitzone = str(self.config.get("timezone") or "Europe/Zurich")
        self._sprache = str(self.config.get("lang") or "de-CH")
        self._session = self.http_session()
        self._konto: Any = None
        self._fabrik: Fabrik = _echte_fabrik
        self._anmeldung_fabrik: Callable[[Any], Any] = _echte_anmeldung
        self._anmeldung: Any = None
        self._wachstum: dict[str, tuple[int, float]] = {}
        self._fehler = 0
        self._bekannt: set[str] = set()
        # Eine Anmeldung ist die einzige Stelle, an der der Hub nicht
        # selbst weiterkommt: Ohne Schlüssel bleibt die Integration stumm
        # da, ohne Kachel, und wartet auf docs/nintendo.md.
        if not self.angemeldet():
            log.info(
                "nintendo: noch nicht angemeldet - siehe docs/nintendo.md "
                "(python -m homepilot.integrations.nintendo)"
            )
        self.start_polling(self._abrufen, sofort=True)

    # ── Anmeldung ──────────────────────────────────────────────────────

    def angemeldet(self) -> bool:
        return bool(tokenstore.value(self._token_datei, "session_token"))

    def anmeldung_starten(self) -> str:
        """Die Adresse, unter der man sich bei Nintendo anmeldet."""
        self._anmeldung = self._anmeldung_fabrik(self._session)
        return str(self._anmeldung.login_url)

    async def anmeldung_abschliessen(self, antwort_adresse: str) -> None:
        """Die Adresse nach der Anmeldung (die mit ``npf…://auth#…``) einlösen."""
        if self._anmeldung is None:
            raise HomePilotError("Erst die Anmeldung starten.")
        try:
            await self._anmeldung.async_complete_login(antwort_adresse.strip())
        except Exception as err:
            raise HomePilotError(f"Nintendo hat die Anmeldung abgelehnt: {err}") from err
        token = self._anmeldung.session_token
        if not token:
            raise HomePilotError("Nintendo hat keinen Sitzungsschlüssel geliefert.")
        daten = tokenstore.load(self._token_datei) or {}
        daten["session_token"] = token
        tokenstore.save(self._token_datei, daten)
        self._anmeldung = None
        self._konto = None
        # Gleich nachsehen, statt bis zum nächsten Takt zu warten: Wer
        # eben die Adresse eingefügt hat, will die Konsole sehen.
        self.start_task(self._abrufen())

    # ── Abruf ──────────────────────────────────────────────────────────

    async def _abrufen(self) -> None:
        token = tokenstore.value(self._token_datei, "session_token")
        if not token:
            return
        try:
            if self._konto is None:
                self._konto = await self._fabrik(token, self._session, self._zeitzone, self._sprache)
            else:
                await self._konto.update()
        except Exception:
            self._fehler += 1
            if self._fehler >= FEHLER_BIS_NICHT_ERREICHBAR:
                for kennung in self._bekannt:
                    await self.hub.registry.update_state(kennung, {}, available=False)
            # Einen kaputten Zugang beim nächsten Mal neu aufbauen, statt
            # mit ihm weiterzuarbeiten.
            self._konto = None
            raise
        self._fehler = 0
        jetzt = time.time()
        for device_id, geraet in dict(self._konto.devices).items():
            minuten = int(getattr(geraet, "today_playing_time", 0) or 0)
            an, merker = laeuft_gerade(minuten, self._wachstum.get(device_id), jetzt)
            self._wachstum[device_id] = merker
            neu = zustand(geraet, an)
            kennung = self.entity_id(objekt_id(device_id))
            if kennung not in self._bekannt:
                await self.add_entity(
                    objekt_id(device_id),
                    EntityKind.MEDIA_PLAYER,
                    str(getattr(geraet, "name", "") or getattr(geraet, "model", "Nintendo Switch")),
                    state=neu,
                    commands=["set_limit"],
                )
                self._bekannt.add(kennung)
            else:
                await self.hub.registry.update_state(kennung, neu, available=True)

    # ── Befehle ────────────────────────────────────────────────────────

    def _geraet(self, entity: Entity) -> Any:
        if self._konto is None:
            raise HomePilotError("Nintendo ist gerade nicht erreichbar.")
        for device_id, geraet in self._konto.devices.items():
            if self.entity_id(objekt_id(device_id)) == entity.id:
                return device_id, geraet
        raise HomePilotError("Diese Konsole kennt Nintendo nicht mehr.")

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        if command != "set_limit":
            return
        device_id, geraet = self._geraet(entity)
        minuten = data.get("minutes")
        if minuten is None:
            await self._zuruecksetzen(device_id, geraet)
            return
        ziel = limit_wert(minuten)
        daten = tokenstore.load(self._token_datei) or {}
        vorher = daten.setdefault("limit_vorher", {})
        if device_id not in vorher:
            # Was die Eltern selbst eingestellt hatten, merken - und beim
            # Loslassen zurückstellen. -1 steht für «keine Grenze».
            vorher[device_id] = -1 if geraet.limit_time in (None, -1) else int(geraet.limit_time)
            tokenstore.save(self._token_datei, daten)
        await self._stellen(geraet, ziel)

    async def _zuruecksetzen(self, device_id: str, geraet: Any) -> None:
        daten = tokenstore.load(self._token_datei) or {}
        vorher = daten.get("limit_vorher", {})
        if device_id not in vorher:
            return
        await self._stellen(geraet, limit_wert(vorher[device_id]))
        del vorher[device_id]
        tokenstore.save(self._token_datei, daten)

    async def _stellen(self, geraet: Any, ziel: int) -> None:
        """Die Höchstzeit setzen; und dafür sorgen, dass die Konsole sie auch durchsetzt.

        Nintendo kennt «Alarm» (die Konsole läutet nur) und «Software
        unterbrechen» (das Spiel wird beendet). Eine Konsolenzeit, die nur
        läutet, ist keine - darum wird beim ersten Eingriff umgestellt.
        """
        if not getattr(geraet, "forced_termination_mode", True):
            try:
                from pynintendoparental.enum import RestrictionMode

                await geraet.set_restriction_mode(RestrictionMode.FORCED_TERMINATION)
            except ImportError:
                pass
        try:
            await geraet.update_max_daily_playtime(ziel)
        except Exception as err:
            # Zusatzzeit, die die Eltern in Nintendos App gegeben haben,
            # sperrt das Ändern der Höchstzeit - das ist keine Störung,
            # aber der Hub soll es sagen statt es zu verschlucken.
            raise HomePilotError(f"Nintendo hat die Höchstzeit nicht angenommen: {err}") from err


INTEGRATION = NintendoIntegration


# ── Prüfstand: python -m homepilot.integrations.nintendo ───────────────


async def _pruefen(token_datei: Path) -> None:  # pragma: no cover - braucht ein Konto
    """Zeigt, was Nintendo roh meldet - der Weg, die Switch 2 zu prüfen."""
    import aiohttp

    async with aiohttp.ClientSession() as session:
        token = tokenstore.value(token_datei, "session_token")
        if not token:
            auth = _echte_anmeldung(session)
            print("1. Diese Adresse im Browser öffnen und mit dem Nintendo-Konto anmelden:")
            print(auth.login_url)
            print('2. Bei «Dieses Konto verwenden» die Schaltfläche mit der rechten Maustaste')
            print("   anklicken, «Linkadresse kopieren» wählen und hier einfügen:")
            adresse = input("> ").strip()
            await auth.async_complete_login(adresse)
            daten = tokenstore.load(token_datei) or {}
            daten["session_token"] = auth.session_token
            tokenstore.save(token_datei, daten)
            token = auth.session_token
            print("Angemeldet, Schlüssel gespeichert.")
        konto = await _echte_fabrik(token, session, "Europe/Zurich", "de-CH")
        if not konto.devices:
            print("Nintendo kennt unter diesem Konto keine Konsole.")
        for device_id, g in konto.devices.items():
            print(f"\n{g.name} ({g.model}) - {device_id}")
            print(f"  heute gespielt:      {g.today_playing_time} min")
            print(f"  heute übrig:         {g.today_time_remaining} min")
            print(f"  Höchstzeit:          {g.limit_time}")
            print(f"  Zusatzzeit:          {g.extra_playing_time}")
            print(f"  Spiel beenden:       {g.forced_termination_mode}")
            print(f"  letzter Abgleich:    {g.last_sync}")


if __name__ == "__main__":  # pragma: no cover
    import sys

    datei = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("nintendo-token.json")
    asyncio.run(_pruefen(datei))
