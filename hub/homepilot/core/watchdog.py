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
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from . import energy, familie, maintenance, notifyrules, shopping

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
    leaks,
    low_batteries,
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
        self._reported_battery: set[str] = set()
        # Haushaltgeräte: Zustand der letzten Runde, Zeitpunkt des
        # Programmendes und was schon erinnert wurde.
        self._last_state: dict[str, str] = {}
        self._started_at: dict[str, float] = {}
        self._finished_at: dict[str, float] = {}
        self._reminded: set[str] = set()
        # Fenster und Türen: seit wann offen, und was schon gemeldet wurde.
        self._open_since: dict[str, float] = {}
        self._reported_open: set[str] = set()
        # Wassermelder, die schon gemeldet wurden.
        self._reported_leak: set[str] = set()
        # Energie: welcher Tag zuletzt geschrieben wurde und wann.
        self._energy_day: str | None = None
        self._energy_written: float = 0.0
        self._energy_last: float = 0.0
        # Für welchen Tag zuletzt vor Frost gewarnt wurde.
        self._maintenance_day: str | None = None
        # Je Ladenzone der Zeitpunkt des Betretens, für den schon erinnert
        # wurde. Beim nächsten Besuch ist der ein anderer.
        self._shop_reminded: dict[str, Any] = {}
        # Je Tag und Gabe einmal erinnern, nicht jede Minute.
        self._med_reminded: set[str] = set()
        self._birthday_day: str | None = None
        self._emergency_day: str | None = None
        self._frost_day: str | None = None
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

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

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
        await self._check_maintenance()
        await self._check_shopping(entities)
        await self._check_medications()
        await self._check_birthdays()
        await self._check_emergency()
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
        if self._frost_day == frost["date"]:
            return
        self._frost_day = frost["date"]
        await self._notify(
            "Frost angekündigt",
            f"Heute Nacht sinkt es auf {frost['low']} °C. "
            "Empfindliche Pflanzen vom Balkon holen.",
            category="frost",
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
        if self._maintenance_day == heute:
            return
        faellig = maintenance.due_items(self.hub.data.get("maintenance"))
        if not faellig:
            # Den Tag trotzdem merken: Sonst prüft er die ganze Stunde
            # lang jede Minute erneut.
            self._maintenance_day = heute
            return
        self._maintenance_day = heute
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
        """
        shops = self.hub.data.get("family_shops")
        if not shops:
            return
        offen = shopping.open_items(self.hub.data.get("family_shopping"))
        if not offen:
            return
        zonen = {
            entity.id.split(".", 1)[1]: entity.state
            for entity in entities
            if entity.id.startswith("geofence.")
        }
        jetzt = time.time()
        for shop in shopping.due_reminders(
            shops, zonen, len(offen), jetzt, self._shop_reminded
        ):
            zone = str(shop.get("zone"))
            stand = zonen.get(zone) or {}
            self._shop_reminded[zone] = stand.get("changed_at")
            titel, text = shopping.describe(shop, offen)
            await self._notify(titel, text, category="shopping")

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
                marke = f"{med.get('id')}:{tag}:{slot}"
                if marke in self._med_reminded:
                    continue
                self._med_reminded.add(marke)
                await self._notify(
                    "Medikament fällig",
                    familie.describe(med, [slot]),
                    category="medication",
                    to=str(med.get("member") or "").strip() or None,
                )
        # Das Gedächtnis nicht wachsen lassen - was von gestern ist, ist
        # vorbei.
        self._med_reminded = {
            marke for marke in self._med_reminded if f":{tag}:" in marke
        }

    async def _check_birthdays(self) -> None:
        """Am Morgen daran erinnern, wer heute Geburtstag hat.

        Die Daten liegen in den Kontakten; sich die Liste anzusehen musste
        man bisher selbst daran denken - und genau das vergisst man.
        """
        jetzt = datetime.now()
        if jetzt.hour != 8:
            return
        heute = jetzt.strftime("%Y-%m-%d")
        if self._birthday_day == heute:
            return
        self._birthday_day = heute
        namen = [
            str(contact.get("text") or "").strip()
            for contact in familie.birthdays_on(
                self.hub.data.get("family_contacts"), jetzt.date()
            )
        ]
        namen = [name for name in namen if name]
        if not namen:
            return
        await self._notify(
            "Geburtstag heute",
            ", ".join(namen) + (" hat" if len(namen) == 1 else " haben") + " heute Geburtstag.",
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
        if self._emergency_day == heute:
            return
        self._emergency_day = heute
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
                        f"{entity.name} wieder da",
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
                    f"{entity.name} antwortet nicht",
                    f"Seit {strikes} Minuten "
                    "keine Meldung – die Alarmanlage hat dort einen blinden Fleck.",
                    "device_down",
                )

    async def _check_appliances(self, entities: list[Any]) -> None:
        """An die fertige, aber noch volle Maschine erinnern.

        Die Push beim Programmende schickt das Gerät selbst – die geht im
        Alltag unter, wenn man gerade nicht kann. Erinnert wird deshalb
        erst später, und nur einmal je Programm: Wer die Maschine ausräumt,
        startet sie irgendwann neu, und damit ist der Merker wieder frei.
        """
        now = time.time()
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
                self._reminded.discard(entity.id)
                continue
            if before == "running" and state == "idle":
                self._finished_at[entity.id] = now
                self._log_cycle(entity, now)
                continue

            since = self._finished_at.get(entity.id)
            if since is None or entity.id in self._reminded:
                continue
            reminder = self.rules["appliance"]["params"]["hours"] * 3600
            if now - since >= reminder:
                self._reminded.add(entity.id)
                hours = round((now - since) / 3600)
                await self._notify(
                    f"{entity.name} ist noch voll",
                    f"Seit {hours} Stunden fertig und seither nicht wieder "
                    "gelaufen.",
                    "appliance",
                )

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
                "name": entity.name,
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
            since = self._open_since.setdefault(entity.id, now)
            if entity.id in self._reported_open:
                continue
            if now - since >= reminder:
                self._reported_open.add(entity.id)
                hours = round((now - since) / 3600)
                await self._notify(
                    f"{entity.name} steht offen",
                    f"Seit {hours} Stunden – im Winter geht so die Heizung "
                    "zum Fenster hinaus.",
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
                f"Wasser: {entity.name}",
                "Der Melder meldet Wasser. Zuerst den Haupthahn, dann den "
                "Strom in diesem Bereich.",
                "leak",
            )
        self._reported_leak &= nass

    async def _check_batteries(self, entities: list[Any]) -> None:
        """Schwache Batterien – einmal melden, nicht jede Minute."""
        weak = {entity.id for entity in low_batteries(entities)}
        for entity in low_batteries(entities):
            if entity.id in self._reported_battery:
                continue
            self._reported_battery.add(entity.id)
            await self._notify(
                f"Batterie schwach: {entity.name}",
                "Das Gerät meldet eine schwache Batterie. Danach ist es still, "
                "ohne sich abzumelden.",
                "battery",
            )
        # Gewechselte Batterien wieder scharf stellen für die nächste Warnung.
        self._reported_battery &= weak

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

    async def _notify(
        self,
        title: str,
        body: str,
        category: str = "outage",
        to: str | None = None,
    ) -> None:
        """`to` schickt an eine Person statt an alle - eine Gabe für Lina
        geht die anderen nichts an."""
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
            await self.hub.push.send(tokens, title=title, body=body)
        except Exception:
            log.exception("Wächter-Push nicht zustellbar")
