"""Wächter: meldet Ausfälle und schwache Batterien als Push statt still im Log.

Drei Dinge werden im Minutentakt geprüft:

  - Fällt eine ganze Integration aus (und bleibt es über eine Karenzzeit),
    geht eine Push-Nachricht raus; kommt sie zurück, ebenfalls.
  - Einzelne *überwachte* Geräte, die längere Zeit nicht antworten. Nicht
    alle: Bei hundert Geräten wäre jede Störung eine Nachricht. Überwacht
    ist, was die Alarmanlage bewacht – das hat jemand bewusst als wichtig
    eingestuft – und was ausdrücklich markiert wurde.
  - Schwache Batterien. Ein Rauchmelder mit leerer Batterie ist still, und
    genau das darf man nicht zufällig entdecken.
  - Fenster und Türen, die seit Stunden offen stehen. Die Alarmanlage merkt
    das erst beim Scharfschalten – im Winter ist es bis dahin teuer.
  - Wassermelder. Sofort und unabhängig davon, ob die Anlage scharf ist:
    Der Schlauch platzt am liebsten, während man zuhause ist.

Die letzten Ausfälle stehen im System-Screen.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

from . import (
    babysitter,
    batterie,
    batterieprognose,
    energy,
    familie,
    gemeldet,
    giessen,
    maintenance,
    morgen,
    notifyrules,
    personen,
    presence,
    regen,
    shopping,
    spaeter,
    trash,
    users,
    uvwarnung,
    waschkueche,
)
from .entity import EntityKind

# Die reinen Regeln wohnen in watchrules.py; hier bleiben Takt und
# Gedächtnis. Die Namen werden re-exportiert - Server und Tests
# importieren sie seit je von hier.
from .watchrules import (  # noqa: F401
    CYCLE_LIMIT,
    FROST_BELOW,
    IGNORE,
    OPEN_CLASSES,
    cycle_stats,
    disk_usage,
    down_integrations,
    frost_night,
    klingel_gesperrt,
    leaks,
    low_batteries,
    offen_satz,
    open_contacts,
    watched_entities,
)

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)

# Schwellen und Wartezeiten (Karenzminuten, Erinnerungsstunden, Frost- und
# Speichergrenze) stehen nicht mehr hier: Sie sind einstellbare Regeln in
# notifyrules.py und werden je Runde aus dem Datenspeicher gelesen.
INTERVAL = 60.0

# So oft wird der Tagesverbrauch weggeschrieben. Jede Minute wäre 1440-mal
# dieselbe Datei am Tag; alle zehn Minuten genügt für einen Monatsvergleich
# und beim Tageswechsel wird ohnehin sofort geschrieben.
ENERGY_INTERVAL = 600.0
# Nicht öfter als einmal am Tag mahnen, solange es knapp bleibt.
DISK_REMIND = 24 * 3600
# So viele Tage im Voraus wird an einen Geburtstag erinnert. Drei sind
# Zeit für ein Geschenk und kurz genug, es nicht wieder zu vergessen.
BIRTHDAY_AHEAD = 3
# Nach dem Ferienmodus wird höchstens alle zwei Tage gefragt.
HOLIDAY_ASK_AGAIN = 48 * 3600
# So lange vor dem Ablauf bekommt ein Gast Bescheid.
ACCESS_WARN_SECONDS = 15 * 60

#: Wo der Zeitpunkt der letzten Regen-Vorwarnung liegt. Auf der Platte,
#: weil zwischen Vorwarnung und Regen eine Viertelstunde liegt und ein
#: Update dazwischen der Normalfall ist.
REGEN_KEY = "rain_warned"


class Watchdog:
    def __init__(self, hub: Hub) -> None:
        self.hub = hub
        # Wann zuletzt ein Lebenszeichen hinausging.
        self._heartbeat_sent = 0.0
        # Integration → Anzahl Fehlrunden in Folge.
        self._strikes: dict[str, int] = {}
        # Gerät → Fehlrunden in Folge, und was schon gemeldet wurde.
        self._device_strikes: dict[str, int] = {}
        self._reported_down: set[str] = set()
        # Haushaltgeräte: Zustand der letzten Runde, Zeitpunkt des
        # Programmendes und was schon erinnert wurde.
        # Wann zuletzt vor Regen gewarnt wurde - beim Start aus der
        # Datendatei geholt (siehe REGEN_KEY).
        self._regen_gemeldet: float | None = None
        self._last_state: dict[str, str] = {}
        self._started_at: dict[str, float] = {}
        self._finished_at: dict[str, float] = {}
        # Gerät → wie oft schon gemahnt. Früher ein blosses «schon
        # gemeldet»: Damit ging die Nachricht genau einmal raus, und wer
        # sie liegen liess, hörte nie wieder davon.
        self._gemahnt: dict[str, int] = {}
        # Ob die Waschküchentüre in der letzten Runde offen stand - für
        # die Flanke. Der Zustand allein genügt nicht: Eine Türe, die
        # offen stehen bleibt, hiesse sonst in jeder Runde «war jemand da».
        self._wk_offen = False
        # Fenster und Türen: seit wann offen, und was schon gemeldet wurde.
        self._open_since: dict[str, float] = {}
        self._reported_open: set[str] = set()
        # Wassermelder, die schon gemeldet wurden.
        self._reported_leak: set[str] = set()
        # Energie: welcher Tag zuletzt geschrieben wurde und wann.
        self._energy_day: str | None = None
        self._energy_written: float = 0.0
        self._energy_last: float = 0.0
        # Je Ladenzone der Zeitpunkt des Betretens, für den schon erinnert
        # wurde. Beim nächsten Besuch ist der ein anderer.
        self._shop_reminded: dict[str, Any] = {}
        # Ortung: wem schon wegen des Akkus geschrieben wurde, wann
        # zuletzt nach dem Ferienmodus gefragt wurde, und wann der
        # Verlauf zuletzt gestutzt wurde.
        self._battery_told: set[str] = set()
        # Wem schon gemeldet wurde, dass sein Telefon schweigt. Wie beim
        # Akku ein Merker je Zone, damit aus einer Funkstille nicht eine
        # Nachricht je Minute wird.
        self._silence_told: set[str] = set()
        self._holiday_asked: float = 0.0
        self._history_trimmed: float = 0.0
        # Was «einmal am Tag» heisst - Geburtstag, Frost, Medikamente,
        # Wochenausblick, ablaufende Zugänge - merkt sich `_einmal` in der
        # hub.data und überlebt damit den Neustart. Hier stand das früher
        # und war nach jedem Update vergessen.
        # Wann zuletzt vor knappem Speicherplatz gewarnt wurde.
        self._disk_warned: float = 0.0
        # Letzte gemessene Belegung - für den System-Screen.
        self.disk: dict[str, Any] | None = None
        # Regeln für die eingebauten Nachrichten – zu Beginn die Vorgaben,
        # jede Runde frisch aus dem Datenspeicher (die App ändert sie dort).
        self.rules = notifyrules.effective(None)
        # Aktuell als ausgefallen gemeldete Integrationen (seit Zeitstempel).
        self.down_since: dict[str, float] = {}
        # Protokoll der letzten Ausfälle für die App (jüngste zuerst).
        self.outages: list[dict[str, Any]] = []
        self._task: asyncio.Task | None = None
        # An welchen Geräten es gerade klingelt. Ring lässt das Feld eine
        # Weile auf «on» stehen; ohne Gedächtnis käme bei jeder Meldung
        # desselben Klingelns eine weitere Nachricht.
        self._klingelt: set[str] = set()
        # Je Türe der Zeitpunkt der letzten Klingel-Nachricht - die
        # Sperrfrist, die verhindert, dass aus einem Besucher mehrere
        # Nachrichten werden.
        self._klingel_gemeldet: dict[str, float] = {}

    def start(self) -> None:
        # Den Stand der letzten Regen-Vorwarnung wieder aufnehmen. Ohne
        # das käme sie nach einem Neustart gleich noch einmal - und
        # zwischen Vorwarnung und Regen liegt eine Viertelstunde.
        gespeichert = self.hub.data.get(REGEN_KEY)
        if gespeichert and isinstance(gespeichert[0], dict):
            try:
                self._regen_gemeldet = float(gespeichert[0].get("at") or 0) or None
            except (TypeError, ValueError):
                self._regen_gemeldet = None
        self._task = asyncio.create_task(self._loop())
        # Die Klingel läuft nicht im Minutentakt mit: Wer vor der Türe
        # steht, wartet keine Minute. Sie hängt am Ereignis selbst.
        self.hub.bus.subscribe("state_changed", self._on_state)

    def _on_state(self, _event_type: str, data: dict[str, Any]) -> None:
        """Bus-Listener: Klingelt es gerade irgendwo?

        Bewusst hier und nicht in der Runde alle 60 Sekunden. Die übrigen
        Regeln beantworten Fragen, die eine Minute Zeit haben - eine
        schwache Batterie, ein offenes Fenster. Ein Klingeln hat sie
        nicht: Bis die Runde das Feld sähe, steht der Besucher wieder auf
        der Strasse.
        """
        entity_id = str(data.get("entity_id") or "")
        if not entity_id:
            return
        alt = str((data.get("old_state") or {}).get("ring") or "")
        neu = str((data.get("new_state") or {}).get("ring") or "")
        if neu != "on":
            # «off» oder verschwunden: Beim nächsten Klingeln darf wieder
            # gemeldet werden - sofern die Sperrfrist um ist.
            self._klingelt.discard(entity_id)
            return
        if alt == "on" or entity_id in self._klingelt:
            return
        # Der Riegel an der letzten Stelle. Ein Klingeln kommt beim Hub auf
        # mehreren Wegen an, und jeder Weg kann den Zustand für sich auf
        # «an» setzen - dazwischen liegt manchmal ein «aus», und dann
        # zählt es als neues Klingeln. Was auch immer davor schiefgeht:
        # Hier geht je Türe und Minute eine Nachricht hinaus.
        jetzt = time.time()
        if klingel_gesperrt(self._klingel_gemeldet.get(entity_id), jetzt):
            log.debug("Klingeln an %s bereits gemeldet - keine zweite Nachricht", entity_id)
            return
        self._klingel_gemeldet[entity_id] = jetzt
        self._klingelt.add(entity_id)
        entity = (data.get("entity") or {}) if isinstance(data.get("entity"), dict) else {}
        name = str(entity.get("name") or entity_id)
        # Als eigene Aufgabe: Der Bus ruft synchron, und eine Nachricht
        # zu verschicken dauert - der Zustand soll darauf nicht warten.
        asyncio.create_task(self._melde_klingeln(entity_id, name))

    async def _melde_klingeln(self, entity_id: str, name: str) -> None:
        # Zuerst auf den Bus: Wer beim Klingeln etwas tun will - die
        # Musik dämpfen, eine Ansage machen -, soll nicht warten, bis
        # die Push draussen ist.
        await self.hub.bus.publish(
            "doorbell", {"entity_id": entity_id, "name": name}
        )
        await self._notify(
            f"Es klingelt: {name}",
            "Jemand steht vor der Türe.",
            "doorbell",
            data={"type": "doorbell", "entity_id": entity_id},
        )

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(INTERVAL)
            try:
                await self.check()
            except Exception:
                log.exception("Wächter-Runde fehlgeschlagen")
            # Nach der Runde, nicht davor: Das Lebenszeichen soll heissen
            # «der Wächter arbeitet», nicht bloss «der Prozess existiert».
            await self._heartbeat()

    async def _heartbeat(self) -> None:
        """Das Lebenszeichen an den Dienst ausserhalb des Hauses.

        Der Wächter überwacht die Integrationen – aber wenn der Hub
        selbst steht, meldet das niemand, denn der Melder ist mit weg.
        Deshalb die Umkehrung: Ein Dienst wie healthchecks.io *erwartet*
        den Ping und schreibt an, wenn er ausbleibt. Ein Fehlschlag hier
        ist still (debug): Wenn das Internet weg ist, schlägt der Dienst
        ja gerade von selbst Alarm.
        """
        config = self.hub.config.heartbeat or {}
        url = str(config.get("url") or "")
        if not url:
            return
        minutes = float(config.get("minutes") or 5)
        now = time.time()
        if now - self._heartbeat_sent < minutes * 60:
            return
        self._heartbeat_sent = now
        import aiohttp

        try:
            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url) as response:
                    if response.status >= 400:
                        log.debug("Lebenszeichen: %s → %s", url, response.status)
        except (TimeoutError, aiohttp.ClientError, OSError) as err:
            log.debug("Lebenszeichen nicht durchgekommen: %s", err)

    def _guarded(self) -> set[str]:
        """Die Sensoren, die der Alarmanlage zugeordnet sind."""
        alarm = self.hub.integrations.get("alarm")
        sensors = getattr(alarm, "_sensors", None)
        if not isinstance(sensors, dict):
            return set()
        return {
            entity_id
            for entity_id, entry in sensors.items()
            if entry.get("modes")
        }

    async def check(self) -> None:
        # Frisch lesen, nicht cachen: Die App ändert die Regeln im
        # Datenspeicher, und die nächste Runde soll sie schon kennen.
        self.rules = notifyrules.effective(self.hub.data.get("notify_rules"))
        entities = self.hub.registry.all()
        await self._check_appliances(entities)
        await self._check_devices(entities)
        await self._check_batteries(entities)
        await self._check_open(entities)
        await self._check_leaks(entities)
        self._record_energy(entities)
        await self._check_disk()
        await self._check_frost(entities)
        await self._check_regen(entities)
        await self._check_giessen(entities)
        await self._check_maintenance()
        await self._check_shopping(entities)
        await self._check_medications()
        await self._check_birthdays()
        await self._check_morgen(entities)
        await self._check_emergency()
        await self._check_presence()
        await self._check_week_ahead()
        await self._check_family_cleanup()
        await self._check_meal_plan()
        await self._check_access()
        await self._check_spaeter()
        await self._check_babysitter()
        down = down_integrations(entities)

        # Strikes hochzählen bzw. zurücksetzen.
        for name in down:
            self._strikes[name] = self._strikes.get(name, 0) + 1
        for name in list(self._strikes):
            if name not in down:
                self._strikes.pop(name)

        # Neu ausgefallen (Karenz überschritten)? Eine Runde dauert eine
        # Minute, darum sind die eingestellten Minuten zugleich die Runden.
        # «>=» statt «==»: Wer die Karenz mitten in einem Ausfall verkürzt,
        # soll die Meldung noch bekommen, nicht verpasst haben.
        grace = max(1, round(self.rules["outage"]["params"]["minutes"]))
        for name, strikes in self._strikes.items():
            if strikes >= grace and name not in self.down_since:
                self.down_since[name] = time.time()
                self._log_outage(name, ended=None)
                await self._notify(
                    f"{name} nicht erreichbar",
                    f"Die Integration '{name}' antwortet seit "
                    f"{strikes} Minuten nicht mehr.",
                )

        # Wieder zurück?
        for name in list(self.down_since):
            if name not in down:
                started = self.down_since.pop(name)
                minutes = max(1, round((time.time() - started) / 60))
                self._close_outage(name)
                await self._notify(
                    f"{name} wieder da",
                    f"Die Integration '{name}' ist nach {minutes} Minuten wieder erreichbar.",
                )

    async def _check_frost(self, entities: list[Any]) -> None:
        """Vor der ersten Frostnacht an die Pflanzen auf dem Balkon erinnern.

        Einmal je Tag, und nur abends: Eine Frostwarnung um neun Uhr
        morgens für dieselbe Nacht ist eine Warnung, die man bis zum Abend
        wieder vergessen hat.
        """
        hour = datetime.now().hour
        if hour < 16:
            return
        weather = next((e for e in entities if getattr(e, "kind", "") == "weather"), None)
        if weather is None:
            return
        today = datetime.now().strftime("%Y-%m-%d")
        below = float(self.rules["frost"]["params"]["below"])
        frost = frost_night(weather.state.get("days") or [], today, below)
        if frost is None:
            return
        if not self._einmal(f"frost:{frost['date']}"):
            return
        await self._notify(
            "Frost angekündigt",
            f"Heute Nacht sinkt es auf {frost['low']} °C. "
            "Empfindliche Pflanzen vom Balkon holen.",
            category="frost",
        )

    async def _check_regen(self, entities: list[Any]) -> None:
        """Regen kommt – rechtzeitig, damit man noch etwas tun kann.

        Gemeldet wird auch bei geschlossenen Fenstern: Draussen liegt
        mehr als das, was der Hub sieht - Wäsche, Kissen, das Velo, der
        Sonnenschirm. Ein Fenster ist nur der Teil davon, von dem er
        weiss; stehen welche offen, kommen sie in die Meldung.

        Einmal je Schauer: Solange derselbe ansteht, kommt nichts Neues.
        Wann er als durch gilt, steht in core/regen.py - dort auch, warum
        die frühere Entprellung über den errechneten Regenbeginn genau
        das Gegenteil bewirkte.
        """
        wetter = next((e for e in entities if getattr(e, "kind", "") == "weather"), None)
        if wetter is None:
            return
        stand = wetter.state.get("rain")
        if not isinstance(stand, dict):
            return
        # Durch? Dann darf die nächste Vorwarnung wieder raus - es regnet
        # gerade (die Warnung hat ihren Zweck erfüllt, und was man vor
        # zehn Minuten hätte tun sollen, hilft jetzt niemandem) oder in
        # der Vorschau steht nichts mehr (der Schauer zog vorbei).
        if regen.vorbei(stand):
            if self._regen_gemeldet is not None:
                self._regen_gemeldet = None
                self.hub.data.set(REGEN_KEY, [])
            return
        params = self.rules["rain"]["params"]
        if not regen.melden(
            stand,
            self._regen_gemeldet,
            time.time(),
            float(params.get("minutes", 30)),
            float(params.get("pause", regen.SPERRE_MINUTEN)),
        ):
            return
        self._regen_gemeldet = time.time()
        # Auf die Platte: Zwischen Vorwarnung und Regen liegt eine
        # Viertelstunde, und ein Update dazwischen ist der Normalfall -
        # ohne das hier käme die Meldung nach dem Neustart gleich wieder.
        self.hub.data.set(REGEN_KEY, [{"at": self._regen_gemeldet}])
        offen = open_contacts(entities)
        if offen:
            # Was der Hub weiss, steht zuerst: Ein offenes Fenster ist
            # der eine Handgriff, den er benennen kann.
            text = "Noch offen: " + ", ".join(e.label for e in offen[:5]) + "."
        else:
            # Und sonst der Hinweis auf das, was er nicht sieht. Ohne
            # ihn wäre die Meldung eine blosse Wetteransage.
            text = "Alle Fenster sind zu. Liegt draussen noch etwas?"
        await self._notify(
            regen.satz(stand) or "Regen kommt",
            text,
            category="rain",
        )

    async def _check_giessen(self, entities: list[Any]) -> None:
        """Abends erinnern, wenn der Himmel es nicht macht.

        Abends und nicht morgens: Um sieben Uhr früh verdunstet weniger,
        aber wer die Meldung um sieben liest, hat sie um neun vergessen
        - und mittags giessen verbrennt die Blätter. Einmal je Tag.

        Die drei Bedingungen (lange trocken, es kommt nichts, es war
        warm) stehen in core/giessen.py; hier steht nur, wann gefragt
        wird.
        """
        jetzt = datetime.now()
        if jetzt.hour != 18:
            return
        wetter = next((e for e in entities if getattr(e, "kind", "") == "weather"), None)
        if wetter is None:
            return
        params = self.rules["plants"]["params"]
        if not giessen.soll_giessen(
            wetter.state,
            int(params.get("days", 3)),
            float(params.get("degrees", 18.0)),
        ):
            return
        heute = jetzt.strftime("%Y-%m-%d")
        if not self._einmal(f"plants:{heute}", jetzt.timestamp()):
            return
        await self._notify(
            "Pflanzen giessen",
            giessen.satz(wetter.state),
            category="plants",
        )

    async def _check_maintenance(self) -> None:
        """Einmal täglich an fällige Wartungen erinnern.

        Morgens um neun und nicht abends: Einen Filter bestellt man
        tagsüber. Und nur einmal je Tag - eine Erinnerung, die jede Minute
        wiederkommt, schaltet man ab, und dann fehlt sie, wenn es darauf
        ankommt.
        """
        jetzt = datetime.now()
        if jetzt.hour != 9:
            return
        heute = jetzt.strftime("%Y-%m-%d")
        # Den Tag gleich vormerken – auch wenn nichts fällig ist: Sonst
        # prüfte er die ganze Stunde lang jede Minute erneut.
        if not self._einmal(f"maintenance:{heute}", jetzt.timestamp()):
            return
        faellig = maintenance.due_items(self.hub.data.get("maintenance"))
        if not faellig:
            return
        await self._notify(
            "Wartung steht an",
            "\n".join(maintenance.describe(row) for row in faellig[:5]),
            category="maintenance",
        )

    async def _check_shopping(self, entities: list[Any]) -> None:
        """Im Laden daran erinnern, was noch auf der Liste steht.

        Nur für Läden, denen jemand eine Geofence-Zone gegeben hat, und
        erst nach ein paar Minuten Aufenthalt: Eine Nachricht beim
        Vorbeifahren wäre eine, die man abschaltet.

        Und nur an den, der dort steht. Die Nachricht heisst «Du bist im
        Märt» und ging trotzdem an alle: Wer im Büro sass, während jemand
        anders einkaufte, bekam sie auch - und wusste weder, dass sie
        nicht ihm galt, noch wem.
        """
        shops = self.hub.data.get("family_shops")
        if not shops:
            return
        offen = shopping.open_items(self.hub.data.get("family_shopping"))
        if not offen:
            return
        zonen = {}
        namen = {}
        for entity in entities:
            if not entity.id.startswith("geofence."):
                continue
            zone_id = entity.id.split(".", 1)[1]
            zonen[zone_id] = entity.state
            namen[zone_id] = entity.name
        jetzt = time.time()
        for shop in shopping.due_reminders(
            shops, zonen, len(offen), jetzt, self._shop_reminded
        ):
            marke = shopping.marke_fuer(shop)
            zone_id, stand, _ = shopping.wer_steht_dort(shop, zonen)
            self._shop_reminded[marke] = (stand or {}).get("changed_at")
            empfaenger = self._benutzer_zur_zone(zone_id, namen)
            if empfaenger is None:
                # Ortung ohne Zugang zur App - etwa ein Kind in Life360.
                # An «alle» zu schicken wäre der alte Fehler; hier gibt
                # es schlicht niemanden, den die Nachricht angeht.
                log.info(
                    "Einkaufserinnerung für %s ohne Benutzer zur Zone %s",
                    shop.get("name"),
                    zone_id,
                )
                continue
            titel, text = shopping.describe(shop, offen)
            await self._notify(titel, text, category="shopping", to=empfaenger)

    def _benutzer_zur_zone(
        self, zone_id: str | None, namen: dict[str, str]
    ) -> str | None:
        """Wem gehört diese Ortungszone? (Name des Benutzers oder None)

        Über dieselbe Paarung wie die Anwesenheitsliste - `zone_fuer`
        bildet Benutzer auf Zone ab, hier wird sie rückwärts gelesen.
        Eine zweite Regel dafür wäre eine, die auseinanderläuft.
        """
        if not zone_id:
            return None
        for user in self.hub.users.users:
            if presence.zone_fuer(user.name, namen) == zone_id:
                return user.name
        return None

    async def _check_medications(self) -> None:
        """An die fällige Gabe erinnern – an die zuständige Person.

        Antibiotika sind meist dreimal täglich, und die Abendgabe ist die,
        die untergeht. Erinnert wird je Tag und Tageszeit genau einmal:
        Eine Nachricht, die im Minutentakt wiederkommt, schaltet man ab -
        und dann fehlt sie an dem Abend, an dem es darauf ankommt.
        """
        meds = self.hub.data.get("family_medications")
        if not meds:
            return
        jetzt = datetime.now()
        tag = jetzt.strftime("%Y-%m-%d")
        for med, offen in familie.due_medications(meds, tag, jetzt.hour):
            for slot in offen:
                marke = f"med:{med.get('id')}:{tag}:{slot}"
                if not self._einmal(marke, jetzt.timestamp()):
                    continue
                await self._notify(
                    "Medikament fällig",
                    familie.describe(med, [slot]),
                    category="medication",
                    to=str(med.get("member") or "").strip() or None,
                )

    def _kalender_termine(self) -> list[dict[str, Any]]:
        """Alle Kalendereinträge, die der Hub kennt.

        Der Geburtstags-Kalender aus dem Telefon läuft über dieselbe
        Integration wie die Termine; seine Einträge tragen `birthday`.
        """
        termine: list[dict[str, Any]] = []
        for entity in self.hub.registry.all():
            if entity.kind != EntityKind.CALENDAR:
                continue
            for event in entity.state.get("events") or []:
                if isinstance(event, dict):
                    termine.append(event)
        return termine

    async def _check_morgen(self, entities: list[Any]) -> None:
        """Eine Nachricht am Morgen statt sieben einzelner.

        Nachts ist Einzelmelden richtig - ein Wassermelder wartet nicht
        bis sieben. Am Morgen ist es das Gegenteil: Sechs Mitteilungen
        über schwache Batterien, ein offenes Fenster und einen Ablauf,
        der nicht lief, wischt man weg, ohne sie zu lesen. Zusammen
        gelesen ergeben dieselben sechs ein Bild.

        Sie kommt nur, wenn etwas dasteht. Eine Zusammenfassung, die
        «alles in Ordnung» meldet, bestellt man nach einer Woche ab - und
        dann fehlt sie an dem Morgen, an dem sie etwas zu sagen hätte.
        """
        params = self.rules["morning"]["params"]
        if not morgen.faellig(int(params.get("hour", 7))):
            return
        jetzt = time.time()
        heute = datetime.now().strftime("%Y-%m-%d")
        if not self._einmal(f"morning:{heute}", jetzt):
            return

        von, bis = morgen.nacht_fenster(jetzt)
        arten = {entity.id: str(entity.kind) for entity in entities}
        nacht = morgen.in_der_nacht(self.hub.eventlog.all(), arten, von, bis)
        tage = int(params.get("quiet_days", 7))
        still = (
            morgen.stille_ablaeufe(
                [ablauf.as_dict() for ablauf in self.hub.automations.automations],
                self.hub.automations.runs,
                jetzt,
                tage,
            )
            if tage > 0
            else []
        )
        gebaut = morgen.satz(
            morgen.zeilen(
                offen=[entity.label for entity in open_contacts(entities)],
                schwach=[entity.label for entity in low_batteries(entities)],
                stumm=sorted(
                    self.hub.registry.get(entity_id).label
                    for entity_id in self._reported_down
                    if self.hub.registry.get(entity_id) is not None
                ),
                nacht=len(nacht),
                stille_ablaeufe=still,
                # Der UV-Hinweis nur an Tagen, an denen er etwas sagt -
                # «UV 2, alles gut» bestellte man ab (core/uvwarnung.py).
                uv=uvwarnung.hinweis(
                    next(
                        (
                            entity.state.get("uv_today")
                            for entity in entities
                            if getattr(entity, "kind", "") == "weather"
                        ),
                        None,
                    )
                ),
            )
        )
        if gebaut is None:
            return
        titel, text = gebaut
        await self._notify(titel, text, category="morning")

    async def _check_birthdays(self) -> None:
        """Am Morgen daran erinnern, wer heute Geburtstag hat.

        Zwei Quellen, weil beide gepflegt werden: die Kontakte in
        «Familie» und der Geburtstags-Kalender aus dem Telefon. Wer seine
        Geburtstage dort führt, sah sie auf der Startseite und wurde
        trotzdem nicht erinnert - der Wächter schaute nur in die
        Kontakte. Wer in beiden steht, wird einmal gegrüsst.
        """
        jetzt = datetime.now()
        # Die Uhrzeit ist einstellbar (Abläufe → Push): Wer um acht noch
        # schläft, liest den Gruss erst mittags - und gratuliert zu spät.
        stunde = int(self.rules["birthday"]["params"].get("hour", 8))
        if jetzt.hour != stunde:
            return
        heute = jetzt.strftime("%Y-%m-%d")
        if not self._einmal(f"birthday:{heute}", jetzt.timestamp()):
            return
        termine = self._kalender_termine()
        aus_kontakten = [
            str(contact.get("text") or "").strip()
            for contact in familie.birthdays_on(
                self.hub.data.get("family_contacts"), jetzt.date()
            )
        ]
        aus_kalender = [
            name
            for versatz, name in familie.calendar_birthdays(termine, jetzt.date())
            if versatz == 0
        ]
        namen = familie.namen_zusammen(aus_kontakten, aus_kalender)
        if namen:
            await self._notify(
                "Geburtstag heute",
                ", ".join(namen)
                + (" hat" if len(namen) == 1 else " haben")
                + " heute Geburtstag.",
                category="birthday",
            )
        # Und der Vorlauf: Ein Gruss am Morgen ist nett, aber erst ein paar
        # Tage vorher bleibt Zeit für ein Geschenk (Punkt 180). Auf 0
        # gestellt entfällt er - dann kommt nur der Gruss am Tag selbst.
        vorlauf = int(self.rules["birthday"]["params"].get("days", BIRTHDAY_AHEAD))
        voraus = [
            (versatz, str(contact.get("text") or "").strip())
            for versatz, contact in familie.birthdays_in(
                self.hub.data.get("family_contacts"), jetzt.date(), vorlauf
            )
        ] + familie.calendar_birthdays(termine, jetzt.date(), vorlauf)
        for versatz, name in sorted(voraus, key=lambda zeile: zeile[0]):
            if not name or versatz == 0:
                continue
            # Dieselbe Marke für beide Quellen: Wer in Kontakten *und*
            # Kalender steht, wird einmal angekündigt.
            marke = f"birthday-ahead:{heute}:{name.casefold()}:{versatz}"
            if not self._einmal(marke, jetzt.timestamp()):
                continue
            wann = "morgen" if versatz == 1 else f"in {versatz} Tagen"
            await self._notify(
                f"{name} hat {wann} Geburtstag",
                "Noch Zeit für ein Geschenk.",
                category="birthday",
            )

    async def _check_emergency(self) -> None:
        """Einmal im Jahr daran erinnern, das Notfallblatt anzusehen.

        Ein Blatt von vorletztem Jahr ist gefährlicher als keines: Man
        verlässt sich darauf, und die Nummer der Kinderärztin stimmt nicht
        mehr. Nur wenn überhaupt etwas darauf steht - ein leeres Blatt
        anzumahnen wäre Lärm.
        """
        eintraege = self.hub.data.get("family_emergency")
        if not eintraege:
            return
        jetzt = datetime.now()
        if jetzt.hour != 9:
            return
        heute = jetzt.strftime("%Y-%m-%d")
        if not self._einmal(f"emergency:{heute}", jetzt.timestamp()):
            return
        geprueft = None
        for eintrag in eintraege:
            if isinstance(eintrag, dict) and eintrag.get("checked"):
                neuer = str(eintrag["checked"])
                geprueft = max(geprueft, neuer) if geprueft else neuer
        if not familie.emergency_stale(geprueft, jetzt.date()):
            return
        await self._notify(
            "Notfallblatt prüfen",
            "Seit über einem Jahr nicht mehr angesehen. Stimmen Nummern, "
            "Allergien und Versicherung noch?",
            category="maintenance",
        )

    async def _check_presence(self) -> None:
        """Rund um die Ortung: schwacher Akku, Ferienmodus, alter Verlauf.

        Drei kleine Dinge, die zusammengehören, weil sie dieselbe Quelle
        haben – die Zonenmeldungen der Telefone.
        """
        service = self.hub.integrations.get("geofence")
        if service is None:
            return
        jetzt = time.time()
        zustaende = []
        grenze = int(self.rules["presence"]["params"].get("percent", presence.BATTERY_LOW))
        # Je Person die eigenen Schalter (Einstellungen → Familie und
        # Freunde). Einmal geholt, nicht je Zone: Es ist dieselbe Liste.
        schalter = self.hub.data.get(personen.LADE)
        for zone_id in service.zone_ids():
            entity_id = service.zone_entity(zone_id)
            entity = self.hub.registry.get(entity_id) if entity_id else None
            if entity is None:
                continue
            zustaende.append(dict(entity.state))
            # Punkt 220: Ein leeres Telefon ist die häufigste Ursache für
            # eine tote Ortung – und es kündigt sich an.
            text = presence.battery_alert(entity.label, entity.state.get("battery"), grenze)
            if text and zone_id not in self._battery_told:
                self._battery_told.add(zone_id)
                # Der Schalter wird erst hier geprüft, nicht schon oben:
                # Der Vermerk soll auch dann stehen, wenn niemand die
                # Meldung will - sonst käme sie geballt, sobald jemand
                # sie wieder einschaltet.
                if personen.an(schalter, zone_id, "battery"):
                    await self._notify("Telefon fast leer", text, category="presence")
            elif not text:
                self._battery_told.discard(zone_id)

            # Funkstille: Bisher stand sie nur in der Diagnose, also
            # dort, wo man erst nachsieht, wenn man schon misstrauisch
            # ist. Wer gemeldet bekommt, dass ein Telefon seit zwölf
            # Stunden schweigt, kann nachfragen, statt sich später zu
            # wundern, warum «alles aus» lief.
            still = presence.is_stale(presence.zuletzt_gehoert(entity.state), jetzt)
            if still and zone_id not in self._silence_told:
                self._silence_told.add(zone_id)
                if personen.an(schalter, zone_id, "silence"):
                    await self._notify(
                        "Meldet sich nicht mehr",
                        f"{entity.label}s Telefon hat sich seit Stunden nicht "
                        "gemeldet – Akku, Flugmodus oder Ortung aus?",
                        category="presence",
                    )
            elif not still:
                self._silence_told.discard(zone_id)

        # Punkt 221: Sind alle seit einem Tag weg und die Simulation ist
        # aus, fragt eine einzelne Push nach. Eine Frage, keine Automatik.
        sim = self.hub.integrations.get("presence_sim")
        if sim is not None and presence.holiday_question(zustaende, self._sim_running(), jetzt):
            if jetzt - self._holiday_asked > HOLIDAY_ASK_AGAIN:
                self._holiday_asked = jetzt
                await self._notify(
                    "Ihr seid alle weg",
                    "Soll der Ferienmodus (Anwesenheitssimulation) laufen?",
                    category="presence",
                )

        # Punkt 203: Der Verlauf soll von selbst vergessen, nicht nur beim
        # Schreiben – sonst bliebe er nach der letzten Meldung ewig stehen.
        if jetzt - self._history_trimmed > 3600:
            self._history_trimmed = jetzt
            alt = self.hub.data.get("presence_history")
            neu = presence.trim_history(alt, jetzt)
            if len(neu) != len(alt):
                self.hub.data.set("presence_history", neu)

    def _sim_running(self) -> bool:
        """Läuft die Anwesenheitssimulation gerade?

        Sie hat keinen eigenen Zustand, sondern hängt an einem Schalter -
        also wird genau der gelesen.
        """
        sim = self.hub.integrations.get("presence_sim")
        schalter = getattr(sim, "_switch", None)
        if not schalter:
            return False
        entity = self.hub.registry.get(str(schalter))
        if entity is None:
            return False
        return str(entity.state.get("state")) == str(getattr(sim, "_active", "on"))

    async def _check_week_ahead(self) -> None:
        """Der Sonntagabend-Ausblick (Punkt 204).

        Der Hub kennt die Termine der Woche, die fälligen Ämtli und die
        anstehenden Geburtstage – aber jeder sammelt sich das selbst
        zusammen. Am Sonntagabend geht man die Woche ohnehin im Kopf
        durch; genau dann ist die Nachricht willkommen.
        """
        jetzt = datetime.now()
        if jetzt.weekday() != 6:  # Sonntag
            return
        stunde = int(self.rules["weekahead"]["params"].get("hour", 19))
        if jetzt.hour != stunde:
            return
        heute = jetzt.strftime("%Y-%m-%d")
        if not self._einmal(f"weekahead:{heute}"):
            return
        events: list[Any] = []
        for entity in self.hub.registry.all():
            if entity.id.startswith("google_calendar."):
                events.extend(entity.state.get("events") or [])
        text = familie.week_ahead(
            events,
            self.hub.data.get("family_tasks"),
            self.hub.data.get("family_chores"),
            self.hub.data.get("family_contacts"),
            jetzt.date(),
        )
        if not text:
            return
        await self._notify("Die kommende Woche", text, category="weekahead")

    async def _check_family_cleanup(self) -> None:
        """Erledigtes verschwindet von selbst (Punkt 170).

        Abgehakte Aufgaben und erledigte Einkäufe bleiben stehen, bis
        jemand aufräumt – und niemand räumt auf. Weg ist es damit nicht:
        Es wandert in den Papierkorb der Familienlisten und lässt sich
        dort noch dreissig Tage zurückholen.
        """
        jetzt = datetime.now()
        if jetzt.hour != 4:
            return
        heute = jetzt.strftime("%Y-%m-%d")
        if not self._einmal(f"cleanup:{heute}"):
            return
        korb = self.hub.data.get("family_trash")
        for collection in ("tasks", "shopping", "countdowns"):
            key = f"family_{collection}"
            rows = self.hub.data.get(key)
            alt = familie.stale_done(rows, jetzt.date())
            if not alt:
                continue
            ids = {row.get("id") for row in alt}
            for row in alt:
                korb = trash.put(korb, collection, row, "Wächter")
            self.hub.data.set(key, [row for row in rows if row.get("id") not in ids])
            log.info("Familienliste '%s': %d Erledigte aufgeräumt", collection, len(alt))
        self.hub.data.set("family_trash", trash.purge(korb))
        # Und einmal im Monat das Familienbuch (Punkt 169): eine Seite,
        # die auch ohne HomePilot noch lesbar ist.
        monat = jetzt.strftime("%Y-%m")
        if self._einmal(f"book:{monat}", jetzt.timestamp()):
            ziel = self.hub.data.family_book(monat)
            if ziel is not None:
                log.info("Familienbuch abgelegt: %s", ziel)

    async def _check_meal_plan(self) -> None:
        """Der Wochenplan füttert «zuletzt gekocht» (Punkt 218).

        Bisher entstand der Stempel nur, wer den Kochmodus bis zum
        Fertig-Haken durchlief – die Lasagne, die man auswendig kann,
        zählte nie, und die Vorschläge boten sie deshalb immer wieder an.
        """
        jetzt = datetime.now()
        if jetzt.hour != 3:
            return
        heute = jetzt.strftime("%Y-%m-%d")
        if not self._einmal(f"cooked:{heute}"):
            return
        gestern = jetzt.date() - timedelta(days=1)
        rezepte = self.hub.data.get("family_recipes")
        neu = familie.cooked_from_plan(
            self.hub.data.get("family_meals"), rezepte, gestern
        )
        if neu is not rezepte and neu != rezepte:
            self.hub.data.set("family_recipes", neu)
            log.info("Kochstempel aus dem Wochenplan für %s gesetzt", gestern)

    async def _check_access(self) -> None:
        """Ein ablaufender Zugang meldet sich (Punkt 185).

        Der Zugang lief zur eingestellten Stunde ab – still. Zwei
        Nachrichten machen daraus etwas Verlässliches: an den Gast kurz
        vorher, an die Familie, wenn es so weit ist.
        """
        jetzt = datetime.now()
        for user in self.hub.users.users:
            if user.role != users.Role.GUEST or not user.enabled:
                continue
            ende = users.access_end(user.expires, user.hours, jetzt)
            if ende is None:
                continue
            marke = f"{user.name}:{ende.isoformat(timespec='minutes')}"
            rest = (ende - jetzt).total_seconds()
            if 0 < rest <= ACCESS_WARN_SECONDS and self._einmal(
                f"access-warn:{marke}", jetzt.timestamp()
            ):
                await self._notify(
                    "Dein Zugang endet bald",
                    f"Um {ende.strftime('%H:%M')} läuft der Zugang ab.",
                    category="tasks",
                    to=user.name,
                )
            if rest <= 0 and self._einmal(
                f"access-end:{marke}", jetzt.timestamp()
            ):
                await self._notify(
                    f"Zugang von {user.name} ist abgelaufen",
                    "Wer länger bleibt, braucht eine Verlängerung.",
                    category="tasks",
                )

    async def _check_disk(self) -> None:
        """Speicherplatz dort prüfen, wo der Hub wirklich schreibt."""
        path = self.hub.config.data_file or "/"
        folder = str(Path(path).parent if self.hub.config.data_file else path)
        usage = disk_usage(folder)
        if usage is None:
            return
        self.disk = usage
        if usage["percent"] < round(self.rules["disk"]["params"]["percent"]):
            self._disk_warned = 0.0
            return
        now = time.time()
        if now - self._disk_warned < DISK_REMIND:
            return
        self._disk_warned = now
        await self._notify(
            "Speicherplatz wird knapp",
            f"Der Datenträger ist zu {usage['percent']} % belegt "
            f"(noch {usage['free_gb']} von {usage['total_gb']} GB frei). "
            "Läuft er voll, lässt sich nichts mehr speichern.",
            category="disk",
        )

    async def _check_devices(self, entities: list[Any]) -> None:
        """Einzelne überwachte Geräte, die nicht mehr antworten."""
        watched = watched_entities(entities, self._guarded())
        for entity in watched:
            if entity.available:
                self._device_strikes.pop(entity.id, None)
                if entity.id in self._reported_down:
                    self._reported_down.discard(entity.id)
                    await self._notify(
                        f"{entity.label} wieder da",
                        "Der Sensor meldet sich wieder.",
                        "device_down",
                    )
                continue
            strikes = self._device_strikes.get(entity.id, 0) + 1
            self._device_strikes[entity.id] = strikes
            grace = max(1, round(self.rules["device_down"]["params"]["minutes"]))
            if strikes >= grace and entity.id not in self._reported_down:
                self._reported_down.add(entity.id)
                await self._notify(
                    f"{entity.label} antwortet nicht",
                    f"Seit {strikes} Minuten "
                    "keine Meldung – die Alarmanlage hat dort einen blinden Fleck.",
                    "device_down",
                )

    async def _check_appliances(self, entities: list[Any]) -> None:
        """An die fertige, aber noch volle Maschine erinnern.

        Die Push beim Programmende schickt das Gerät selbst – die geht im
        Alltag unter, wenn man gerade nicht kann. Erinnert wird deshalb
        erst später.

        Erinnert wurde lange genau einmal je Programm. Wer die Nachricht
        am Abend auf dem Sofa las und liegen liess, hörte nie wieder
        davon – die Wäsche lag über Nacht in der Trommel. Jetzt wird
        nachgehakt, aber nur, wenn es etwas gibt, das die Mahnungen auch
        beenden kann: die Türe der Waschküche (siehe
        core/waschkueche.py). Ohne sie bleibt es beim einen Hinweis.
        """
        now = time.time()

        # Erst die Türe: Ging sie seit der letzten Runde auf, war jemand
        # unten und hat die volle Maschine gesehen. Das gilt für alle
        # Geräte in der Waschküche zugleich – wer die Wäsche in den
        # Tumbler umlädt, hat beide vor sich.
        tuer = waschkueche.tuer(entities, self._waschkuechentuer())
        offen = waschkueche.ist_offen(tuer)
        wer_da_war = offen and not self._wk_offen
        self._wk_offen = offen
        if wer_da_war:
            self._finished_at.clear()
            self._gemahnt.clear()

        for entity in entities:
            if entity.kind != "appliance":
                continue
            state = str(entity.state.get("state") or "")
            before = self._last_state.get(entity.id)
            self._last_state[entity.id] = state

            if state == "running":
                if before != "running":
                    self._started_at[entity.id] = now
                self._finished_at.pop(entity.id, None)
                self._gemahnt.pop(entity.id, None)
                continue
            if before == "running" and state == "idle":
                self._finished_at[entity.id] = now
                self._log_cycle(entity, now)
                continue

            since = self._finished_at.get(entity.id)
            if since is None:
                continue
            gemahnt = self._gemahnt.get(entity.id, 0)
            if not waschkueche.faellig(
                since,
                gemahnt,
                now,
                self.rules["appliance"]["params"]["hours"],
                nachhaken=tuer is not None,
            ):
                continue
            self._gemahnt[entity.id] = gemahnt + 1
            titel, text = waschkueche.mahnsatz(entity.label, since, now, gemahnt)
            await self._notify(titel, text, "appliance")

    def tuer_gewechselt(self, entities: list[Any], gewaehlt: str | None) -> None:
        """Nach einer neuen Türwahl den Merker mitziehen.

        Der Merker gehört zur alten Türe. Stand die neue gerade offen,
        hiesse die nächste Runde sonst «jemand ist hineingegangen», und
        die fällige Mahnung fiele stillschweigend aus.
        """
        self._wk_offen = waschkueche.ist_offen(waschkueche.tuer(entities, gewaehlt))

    def _waschkuechentuer(self) -> str | None:
        """Welcher Kontakt als Waschküchentüre gewählt wurde.

        Nichts gewählt heisst nicht «keine»: Dann rät
        ``waschkueche.tuer`` anhand von Raum und Name. So wirkt das
        Nachhaken auch bei jemandem, der nie in diese Einstellung
        geschaut hat.
        """
        for entry in self.hub.data.get("laundry"):
            if isinstance(entry, dict) and entry.get("door"):
                return str(entry["door"])
        return None

    def _log_cycle(self, entity: Any, finished: float) -> None:
        """Einen abgeschlossenen Programmlauf ins Protokoll schreiben.

        Daraus wird die Statistik: wie oft und wie lange ein Gerät läuft –
        und ob es schleichend länger braucht, was bei einem Tumbler meist
        ein verstopftes Flusensieb ist.
        """
        started = self._started_at.pop(entity.id, None)
        if started is None:
            # Beim Hubstart mitten im Programm gesehen – ohne Anfang ist die
            # Dauer geraten, und eine geratene Zahl in einer Statistik ist
            # schlimmer als keine.
            return
        entries = list(self.hub.data.get("appliance_cycles"))
        entries.insert(
            0,
            {
                "entity_id": entity.id,
                "name": entity.label,
                "started": started,
                "finished": finished,
                "seconds": round(finished - started),
            },
        )
        del entries[CYCLE_LIMIT:]
        self.hub.data.set("appliance_cycles", entries)

    def _record_energy(self, entities: list[Any]) -> None:
        """Den Tagesverbrauch mitschreiben.

        Hier und nicht in einer eigenen Schleife: Der Wächter läuft ohnehin
        im Minutentakt und hat die Entitäten schon in der Hand.

        Der zuletzt gesehene Stand wird jede Runde gemerkt, geschrieben wird
        aber nur alle zehn Minuten. Beim Tageswechsel schliesst der gemerkte
        Wert den Vortag ab: Die Zähler stehen dann schon wieder auf 0, und
        ohne diesen Schritt fehlten die letzten Minuten vor Mitternacht.
        """
        now = time.time()
        day = datetime.now().strftime("%Y-%m-%d")
        total = energy.total_today(entities)

        if self._energy_day and day != self._energy_day:
            # Der Vortag endet in seiner letzten Stunde – nicht in der
            # Stunde, in der der Wächter den Wechsel bemerkt.
            self._write_energy(self._energy_day, self._energy_last, hour=23)
            self._energy_written = 0.0
        self._energy_last = total

        if day == self._energy_day and now - self._energy_written < ENERGY_INTERVAL:
            return
        self._energy_day = day
        self._energy_written = now
        self._write_energy(day, total, hour=datetime.now().hour)

    def _write_energy(self, day: str, kwh: float, hour: int | None = None) -> None:
        """Ohne Messgerät gibt es nichts zu schreiben – ein Tag ohne Eintrag
        zählt in der Monatssumme ohnehin als 0."""
        if kwh <= 0:
            return
        self.hub.data.set(
            "energy_days", energy.record_day(self.hub.data.get("energy_days"), day, kwh)
        )
        # Daneben der Stundenstand – er beantwortet «wann?», nicht «wie viel?».
        if hour is not None:
            self.hub.data.set(
                "energy_hours",
                energy.record_hour(self.hub.data.get("energy_hours"), day, hour, kwh),
            )

    def _offen_seit(self, entity: Any, jetzt: float) -> float:
        """Seit wann steht dieser Kontakt offen?

        Erst das Protokoll fragen: Es weiss, wann die Türe aufgegangen
        ist, und es überlebt einen Neustart. Nur wenn dort nichts steht -
        ein Gerät, das schon offen war, bevor der Hub das erste Mal lief -
        bleibt die eigene Zählung.

        Hier stand vorher nur die eigene Zählung, und die begann in der
        Runde, in der der Wächter den Kontakt zum ersten Mal offen sah.
        Ging eine Türe zwischen zwei Runden auf, zu und wieder auf, lief
        die Uhr von der ersten Öffnung weiter - die Nachricht kam dann
        lange vor der Stunde.
        """
        aus_protokoll = self.hub.eventlog.offen_seit(entity.id, str(entity.kind))
        if aus_protokoll is not None:
            # Und die eigene Zählung nachziehen, damit beide dasselbe
            # sagen, solange die Türe offen bleibt.
            self._open_since[entity.id] = aus_protokoll
            return aus_protokoll
        return self._open_since.setdefault(entity.id, jetzt)

    async def _check_open(self, entities: list[Any]) -> None:
        """Fenster, das seit Stunden offen steht.

        Die Alarmanlage merkt es nur beim Scharfschalten – im Winter ist es
        bis dahin längst teuer geworden. Erinnert wird einmal je Öffnung:
        Wer schliesst und später wieder öffnet, fängt neu an.
        """
        now = time.time()
        offen = {entity.id for entity in open_contacts(entities)}
        reminder = self.rules["open"]["params"]["hours"] * 3600
        for entity in open_contacts(entities):
            since = self._offen_seit(entity, now)
            if entity.id in self._reported_open:
                continue
            if now - since >= reminder:
                self._reported_open.add(entity.id)
                await self._notify(
                    f"{entity.label} steht offen",
                    # Die Uhrzeit statt einer gerundeten Dauer: «Seit 1
                    # Stunde» ist nicht nachprüfbar, «seit 14:05» schon -
                    # und wer weiss, dass er um 14:20 aufgemacht hat,
                    # erkennt daran sofort einen hängenden Sensor.
                    f"{offen_satz(since, now)} – im Winter geht so die "
                    "Heizung zum Fenster hinaus.",
                    "open",
                )
        # Geschlossene wieder scharf stellen für die nächste Öffnung.
        for entity_id in list(self._open_since):
            if entity_id not in offen:
                self._open_since.pop(entity_id, None)
                self._reported_open.discard(entity_id)

    async def _check_leaks(self, entities: list[Any]) -> None:
        """Wasser – sofort, unabhängig vom Zustand der Alarmanlage.

        Ein Wassermelder, der nur meldet, wenn die Anlage scharf ist, wäre
        nutzlos: Der Waschmaschinenschlauch platzt am liebsten, während man
        zuhause ist und nichts hört.
        """
        nass = {entity.id for entity in leaks(entities)}
        for entity in leaks(entities):
            if entity.id in self._reported_leak:
                continue
            self._reported_leak.add(entity.id)
            await self._notify(
                f"Wasser: {entity.label}",
                "Der Melder meldet Wasser. Zuerst den Haupthahn, dann den "
                "Strom in diesem Bereich.",
                "leak",
            )
        self._reported_leak &= nass

    async def _check_batteries(self, entities: list[Any]) -> None:
        """Schwache Batterien – einmal melden, nicht immer wieder.

        Das Gedächtnis liegt in der `hub.data` und überlebt den Neustart;
        vergessen wird nur, wenn ein Gerät ausdrücklich «Batterie in
        Ordnung» meldet. Warum beides nötig ist, steht im Kopf von
        `batterie.py` – dort hängt der Fall dran.
        """
        jetzt = time.time()
        rows = self.hub.data.get(batterie.STORE_KEY)

        # Nebenher den Wochenstand jeder Batterie vermerken - daraus
        # rechnet die App «reicht noch ~3 Monate» (batterieprognose.py).
        # Ein Wert je Gerät und Woche; nur schreiben, wenn sich wirklich
        # etwas ändert, sonst schriebe jede Wächter-Runde die Datei.
        heute = datetime.now().date()
        verlauf = self.hub.data.get(batterieprognose.STORE_KEY)
        neu_verlauf = verlauf
        for entity in entities:
            stand = entity.state.get("battery")
            if isinstance(stand, (int, float)) and 0 <= stand <= 100:
                neu_verlauf = batterieprognose.aufnehmen(
                    neu_verlauf, entity.id, float(stand), heute
                )
        if neu_verlauf != verlauf:
            self.hub.data.set(batterieprognose.STORE_KEY, neu_verlauf)

        # Erst vergessen, was gewechselt wurde: Sonst bliebe eine alte
        # Zeile stehen und die nächste schwache Batterie desselben Geräts
        # käme nie zur Sprache.
        wieder_gut = [
            entity.id
            for entity in entities
            if entity.state.get("low_battery") is False
        ]
        if wieder_gut and any(
            batterie.zeile(rows, entity_id) for entity_id in wieder_gut
        ):
            rows = batterie.vergiss(rows, wieder_gut)
            self.hub.data.set(batterie.STORE_KEY, rows)

        for entity in low_batteries(entities):
            if not batterie.soll_melden(rows, entity.id, jetzt):
                continue
            # Vormerken *bevor* die Meldung rausgeht: Scheitert der
            # Versand, soll er nicht in der nächsten Minute erneut
            # versucht werden (wie in `_einmal`).
            rows = batterie.merke_meldung(rows, entity.id, jetzt)
            self.hub.data.set(batterie.STORE_KEY, rows)
            await self._notify(
                f"Batterie schwach: {entity.label}",
                "Das Gerät meldet eine schwache Batterie. Danach ist es still, "
                "ohne sich abzumelden.",
                "battery",
                # Damit ein Tipp auf die Nachricht direkt zu den Batterien
                # führt, statt nur die App zu öffnen.
                data={"type": "battery", "entity_id": entity.id},
            )

    def _log_outage(self, name: str, ended: float | None) -> None:
        self.outages.insert(
            0, {"integration": name, "since": time.time(), "ended": ended}
        )
        del self.outages[20:]

    def _close_outage(self, name: str) -> None:
        for entry in self.outages:
            if entry["integration"] == name and entry["ended"] is None:
                entry["ended"] = time.time()
                break

    def _einmal(self, marke: str, jetzt: float | None = None) -> bool:
        """Ist diese Meldung noch nicht raus? Dann vormerken und True.

        Das Gedächtnis liegt in der `hub.data` und überlebt darum den
        Neustart. Vorher stand es im Arbeitsspeicher, und wer während
        der Meldestunde ein Update einspielte, bekam den Geburtstagsgruss
        ein zweites Mal – dasselbe galt für Frost, Medikamente und jede
        andere Meldung, die «einmal am Tag» heisst.

        Vormerken *bevor* die Meldung rausgeht: Scheitert der Versand,
        soll er nicht in der nächsten Minute erneut versucht werden.
        """
        rows = self.hub.data.get("notified")
        if gemeldet.schon(rows, marke):
            return False
        self.hub.data.set(
            "notified", gemeldet.merke(rows, marke, jetzt or time.time())
        )
        return True

    async def _check_babysitter(self) -> None:
        """Den Babysitter-Modus beenden, wenn seine Frist um ist.

        Nur wenn eine gesetzt wurde: Ohne Frist läuft er, bis jemand
        ausschaltet - das ist der Babysitter-Abend, an dem man ans
        Ausschalten denkt. Mit Frist ist es der Besuch, an den danach
        garantiert niemand mehr denkt. Also endet er hier: Abläufe
        wieder frei, Licht wie vorher.

        Gemeldet wird es auch, und zwar an alle: Dass die Abläufe wieder
        greifen, ist die Auskunft, ohne die man am nächsten Morgen
        rätselt, warum die Storen wieder von selbst fahren.
        """
        stand = self.hub.data.get(babysitter.KEY)
        gelesen = babysitter.read(stand)
        if not gelesen["active"] or gelesen["until"] is None:
            return
        if babysitter.laeuft(stand, time.time()):
            return
        await babysitter.beenden_ausfuehren(self.hub, "Frist abgelaufen")
        await self._notify(
            "Babysitter-Modus beendet",
            "Die Abläufe laufen wieder, das Licht steht wie vorher.",
            category="maintenance",
        )

    async def _check_spaeter(self) -> None:
        """Weggeschobene Meldungen, deren Zeit um ist (core/spaeter.py).

        Wer auf «Später» tippt, will genau diesen Satz wiedersehen -
        deshalb wird er unverändert noch einmal geschickt und nicht neu
        gebildet. Ob die Regel dazu inzwischen abgeschaltet wurde, prüft
        `_notify` wie bei jeder anderen Meldung auch.
        """
        rows = self.hub.data.get(spaeter.SCHLANGE)
        if not rows:
            return
        dran, rest = spaeter.faellig(rows, time.time())
        if not dran:
            return
        self.hub.data.set(spaeter.SCHLANGE, rest)
        for eintrag in dran:
            await self._notify(
                str(eintrag.get("title") or ""),
                str(eintrag.get("body") or ""),
                category=str(eintrag.get("category") or "outage"),
                to=(str(eintrag.get("to")) if eintrag.get("to") else None),
            )

    async def _notify(
        self,
        title: str,
        body: str,
        category: str = "outage",
        to: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        """`to` schickt an eine Person statt an alle - eine Gabe für Lina
        geht die anderen nichts an.

        ``data`` reist mit der Nachricht ans Telefon und sagt der App, wo
        sie beim Antippen hinspringen soll (siehe hooks/useNotificationTap
        in der App)."""
        rule = self.rules.get(category)
        if rule is not None and not rule["enabled"]:
            # Abgeschaltet heisst: keine Push an niemanden. Geprüft wird
            # weiter (der System-Screen zeigt Ausfälle trotzdem), und das
            # Log behält eine Spur, falls jemand die Regel vergessen hat.
            log.info("%s – %s (Regel '%s' abgeschaltet)", title, body, category)
            return
        log.warning("%s – %s", title, body)
        try:
            tokens = self.hub.push.recipients(
                self.hub.users.users, to or "all", category
            )
            await self.hub.push.send(
                tokens, title=title, body=body, data=data, category=category
            )
        except Exception:
            log.exception("Wächter-Push nicht zustellbar")
