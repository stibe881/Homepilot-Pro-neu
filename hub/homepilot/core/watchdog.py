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
    astro,
    babysitter,
    batterie,
    batterieprognose,
    bildarchiv,
    bilder,
    cliparchiv,
    dateien,
    energy,
    familie,
    flattern,
    funkqualitaet,
    gastspur,
    gemeldet,
    giessen,
    grillmeldung,
    gutscheine,
    gutscheinort,
    kamera,
    losfahren,
    maintenance,
    morgen,
    notifyrules,
    ofen,
    packliste,
    personen,
    presence,
    pushbuendel,
    pushziel,
    regen,
    shopping,
    spaeter,
    storenwaechter,
    sturmvorwarnung,
    trash,
    users,
    uvwarnung,
    vorrat,
    waschkueche,
    wlanschein,
)
from .entity import EntityKind
from .source import as_source, automation_source

# Die reinen Regeln wohnen in watchrules.py; hier bleiben Takt und
# Gedächtnis. Die Namen werden re-exportiert - Server und Tests
# importieren sie seit je von hier.
from .watchrules import (  # noqa: F401
    CYCLE_LIMIT,
    FROST_BELOW,
    IGNORE,
    OPEN_CLASSES,
    OPEN_REPORTED_KEY,
    cycle_stats,
    disk_usage,
    dock_thema,
    down_integrations,
    frost_night,
    klingel_gesperrt,
    leaks,
    leck_dauer_text,
    leck_eskalation_faellig,
    low_batteries,
    offen_satz,
    offene_meldungen_lesen,
    offene_meldungen_zeilen,
    open_contacts,
    sauger_erreichbar,
    sauger_probleme,
    schon_gemahnt,
    watched_entities,
    wein_gesperrt,
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
# So oft wird die Zigbee-Funkqualität eingesammelt. Nicht jede Runde:
# Das laufende Wochenmittel änderte sich sonst im Minutentakt um
# Nachkommastellen, und jede Änderung schriebe die Datendatei. Eine
# Stichprobe je Stunde sind 168 je Woche - mehr braucht kein Mittel.
FUNK_INTERVAL = 3600.0
# So viele Tage im Voraus wird an einen Geburtstag erinnert. Drei sind
# Zeit für ein Geschenk und kurz genug, es nicht wieder zu vergessen.
BIRTHDAY_AHEAD = 3
# Nach dem Ferienmodus wird höchstens alle zwei Tage gefragt.
HOLIDAY_ASK_AGAIN = 48 * 3600
# So lange vor dem Ablauf bekommt ein Gast Bescheid.
ACCESS_WARN_SECONDS = 15 * 60

#: Wo die schon gemeldeten Sauger-Probleme liegen («gerät:quelle:wert»).
#: Auf der Platte statt im Arbeitsspeicher, damit ein Neustart die
#: Meldungen nicht wiederholt - und damit ein Problem, das bleibt,
#: täglich erinnert werden kann (Punkt 263 der Werkbank). Die Zeilen
#: haben dieselbe Form wie die der Batterien und werden mit denselben
#: reinen Funktionen gerechnet (core/batterie.py).
SAUGER_STORE_KEY = "vacuum_notified"

#: Wo der Zeitpunkt der letzten Regen-Vorwarnung liegt. Auf der Platte,
#: weil zwischen Vorwarnung und Regen eine Viertelstunde liegt und ein
#: Update dazwischen der Normalfall ist.
REGEN_KEY = "rain_warned"

#: Die Kerntemperatur-Ziele je Grill: {entity_id: {"1": 63}} (Punkt 554).
#:
#: In der Datendatei und nicht an der Entität: Die Steuerplatine meldet
#: je Fühler nur die Temperatur, kein Ziel. Solange offen ist, ob sie
#: überhaupt eines führt (grillcheck druckt ihren rohen Zustand), gehört
#: es dorthin, wo es einen Neustart überlebt.
GRILLZIELE_KEY = "grill_probe_targets"


class Watchdog:
    def __init__(self, hub: Hub) -> None:
        self.hub = hub
        # Wann zuletzt ein Lebenszeichen hinausging.
        self._heartbeat_sent = 0.0
        # Integration → Anzahl Fehlrunden in Folge.
        self._strikes: dict[str, int] = {}
        # Was diese Runde an Meldungen ergeben hat. ``None`` heisst:
        # gerade keine Runde - dann geht jede Meldung sofort raus. Das
        # ist der Fall, wenn ein Test eine einzelne Prüfung aufruft, und
        # er soll sich nicht anders verhalten als der Betrieb.
        self._eimer: list[dict[str, Any]] | None = None
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
        # Wann zuletzt gemahnt wurde. Der Abstand zählt ab hier und nicht
        # ab dem Programmende - sonst wären nach der stillen Nacht alle
        # liegengebliebenen Mahnungen um acht Uhr auf einmal fällig.
        self._gemahnt_at: dict[str, float] = {}
        # Ob die Waschküchentüre in der letzten Runde offen stand - für
        # die Flanke. Der Zustand allein genügt nicht: Eine Türe, die
        # offen stehen bleibt, hiesse sonst in jeder Runde «war jemand da».
        self._wk_offen = False
        # Fenster und Türen: seit wann offen, und was schon gemeldet wurde.
        self._open_since: dict[str, float] = {}
        # Wassermelder, die schon gemeldet wurden.
        self._reported_leak: set[str] = set()
        # Je Wassermelder, seit wann er ununterbrochen nass ist - Grundlage
        # der Eskalation (Punkt 391), und wer davon schon ein zweites Mal
        # gemeldet wurde.
        self._leak_since: dict[str, float] = {}
        self._leak_escalated: set[str] = set()
        # Die zuletzt beantwortete Unwetterwarnung (Grund + Ablaufzeit):
        # Dieselbe Warnung soll die Storen nur einmal fahren - erst eine
        # neue (oder dieselbe nach Warnungsende) zählt wieder.
        # Wann zuletzt die Funkqualität eingesammelt wurde (FUNK_INTERVAL).
        self._funk_gesammelt = 0.0
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
        # Je Integration die Zeitpunkte, zu denen ein Gerät nach einer
        # Unterbrechung wieder erreichbar wurde - und wann darüber
        # zuletzt gemeldet wurde. Siehe core/flattern.py: Die Zwischen-
        # stufe zwischen «da» und «weg» hat bisher niemand gesehen.
        self._rueckkehr: dict[str, list[float]] = {}
        self._flattern_gemeldet: dict[str, float] = {}
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
        # An welchen Kameras gerade ein Baby weint, und wann zuletzt
        # gemeldet wurde - dasselbe Gedächtnis wie bei der Klingel:
        # Protect meldet ein anhaltendes Weinen als mehrere kurze
        # Ereignisse, und ohne Sperrfrist würde jedes zur Nachricht.
        self._weint: set[str] = set()
        self._wein_gemeldet: dict[str, float] = {}
        # Kochgeräte: ob das Gerät in der letzten Runde am Vorheizen war -
        # die Flanke «Vorheizen fertig» ergibt die Parat-Durchsage (ofen.py).
        self._vorheiz: dict[str, bool] = {}
        # Grill: was schon gemeldet ist (Punkt 554). «Ist über dem Ziel»
        # bleibt zwanzig Minuten lang wahr, und zwanzig Minuten lang zu
        # melden wäre kein Hinweis, sondern ein Wecker. Je Grill der
        # Sollwert, je Fühler die Nummer (core/grillmeldung.py).
        self._grill_gemeldet: set[str] = set()
        # Losfahr-Wecker: höchstens ein Nominatim-Nachschlagen je Runde,
        # und nie schneller als hier steht - deren Regeln, nicht unsere.
        self._geo_zuletzt: float = 0.0

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

        # Eine Verbindung, die kommt und geht: Am Ereignis gezählt und
        # nicht in der Runde, weil eine Unterbrechung von zwanzig
        # Sekunden zwischen zwei Runden komplett verschwindet - genau
        # die, um die es hier geht (core/flattern.py).
        if data.get("availability_changed") and (data.get("entity") or {}).get(
            "available"
        ):
            name = entity_id.split(".", 1)[0]
            if name not in IGNORE:
                self._rueckkehr[name] = flattern.merken(
                    self._rueckkehr.get(name, []), time.time()
                )

        # Klingel und Weinen laufen jede für sich, jede hinter ihrem
        # eigenen Netz - und die Klingel zuerst. Vorher hingen sie als
        # eine Kette in diesem Handler: Ein Fehler in der einen Prüfung
        # hätte die andere verschluckt, und zwar still - der Bus fängt
        # die Ausnahme, das Vollbild am Panel (es hängt am Zustand,
        # nicht am Wächter) käme weiter, nur die Nachricht bliebe aus.
        # Die wichtigste Nachricht im Haus darf an keiner anderen hängen.
        for pruefung in (self._pruefe_klingeln, self._pruefe_weinen):
            try:
                pruefung(entity_id, data)
            except Exception:
                log.exception("Wächter-Prüfung am Ereignis fehlgeschlagen")

    def _pruefe_klingeln(self, entity_id: str, data: dict[str, Any]) -> None:
        """Bus-Listener-Teil: Klingelt es gerade an dieser Türe?"""
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
        # Das Live-Bild schon anwerfen, bevor jemand hinsieht: Der Strom
        # läuft nur auf Abruf (core/streams.py), und bis die Kamera ein
        # vollständiges Bild schickt, vergehen bei Protect 4-8 Sekunden.
        # Wer die Push aufmacht, wartete die bisher ab - dabei weiss der
        # Hub im Moment des Klingelns schon, dass gleich jemand
        # hinschaut. Als eigene Aufgabe, damit die Nachricht nicht darauf
        # wartet: Sie ist das Wichtigere.
        asyncio.create_task(self._waerme_livebild(entity_id))
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
            data={"type": "doorbell", "entity_id": entity_id, "ziel": "klingel"},
        )

    async def _waerme_livebild(self, entity_id: str) -> None:
        """Den Strom der Kamera zu dieser Klingel anwerfen.

        Nur anstossen, nicht anschauen: Die Wiedergabeliste abzuholen
        genügt, damit mediamtx den Kamerastrom startet - und er bleibt
        danach die eingestellte Weile offen (ON_DEMAND_CLOSE), also lange
        genug, bis jemand das Telefon in der Hand hat.

        Schlägt es fehl, bleibt es beim Protokoll: Eine Klingel, die
        nicht meldet, weil das Vorwärmen scheiterte, wäre ein
        schlechterer Tausch als ein spätes Bild.
        """
        try:
            ausloeser = self.hub.registry.get(entity_id)
            if ausloeser is None:
                return
            kamera_id = kamera.camera_for(ausloeser, self.hub.registry.all())
            if kamera_id is None:
                return
            entity = self.hub.registry.get(kamera_id)
            if entity is None:
                return
            integration = self.hub.integrations.get(entity.integration)
            if integration is None:
                return
            quelle = await integration.stream_url(entity)
            if not quelle:
                return
            ziel = await self.hub.streams.playlist(kamera_id, quelle)
            # Und die Liste wirklich abholen. Über mediamtx legt
            # `playlist` nur den Pfad an - angezapft wird die Kamera erst,
            # wenn ein Zuschauer die Wiedergabeliste holt (runOnDemand).
            # Ohne diesen Abruf wäre das Vorwärmen eine Konfiguration
            # ohne Wirkung; der Abruf hält, bis der Strom steht, und
            # genau das ist die Wartezeit, die wir vorwegnehmen.
            if ziel is not None and getattr(ziel, "url", None):
                await self.hub.streams.fetch(ziel)
            log.debug("Live-Bild %s beim Klingeln vorgewärmt", kamera_id)
        except Exception as err:
            log.debug("Live-Bild zu %s nicht vorwärmbar: %s", entity_id, err)

    def _pruefe_weinen(self, entity_id: str, data: dict[str, Any]) -> None:
        """Bus-Listener-Teil: Hört eine Kamera gerade ein Baby weinen?

        Die Nachricht hing bisher an einem selbst gebauten Ablauf - und
        ein Ablauf ist eine Verdrahtung, die man versehentlich falsch
        setzt. «Wenn das Baby weint, kommt keine Push» ist derselbe
        Fehler wie damals bei der Klingel, also dieselbe Antwort: Die
        Nachricht ist eingebaut und hängt nur noch an der Erkennung
        selbst (unifi_protect: detected_baby_cry).
        """
        alt = str((data.get("old_state") or {}).get("detected_baby_cry") or "")
        neu = str((data.get("new_state") or {}).get("detected_baby_cry") or "")
        if neu != "on":
            # «off» oder verschwunden: Die nächste Erkennung darf wieder
            # melden - sofern die Sperrfrist um ist.
            self._weint.discard(entity_id)
            return
        if alt == "on" or entity_id in self._weint:
            return
        jetzt = time.time()
        if wein_gesperrt(self._wein_gemeldet.get(entity_id), jetzt):
            log.debug(
                "Weinen an %s bereits gemeldet - keine zweite Nachricht", entity_id
            )
            return
        self._wein_gemeldet[entity_id] = jetzt
        self._weint.add(entity_id)
        entity = (
            (data.get("entity") or {}) if isinstance(data.get("entity"), dict) else {}
        )
        name = str(entity.get("name") or entity_id)
        raum = str(entity.get("room") or "")
        # Als eigene Aufgabe, wie bei der Klingel: Der Bus ruft synchron,
        # und der Zustand soll nicht auf den Versand warten.
        asyncio.create_task(self._melde_weinen(entity_id, name, raum))

    async def _melde_weinen(self, entity_id: str, name: str, raum: str) -> None:
        # Der Raum sagt, wohin man geht; erst ohne Raum muss der
        # Kameraname herhalten. Das Ziel (Kamera im Vollbild) setzt
        # _notify aus der Kategorie samt Gerät (core/pushziel.py).
        wo = raum or name
        await self._notify(
            f"Ein Baby weint: {wo}",
            f"Die Kamera «{name}» hört ein Baby weinen.",
            "baby_cry",
            data={"type": "baby_cry", "entity_id": entity_id},
            entity_id=entity_id,
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
        """Eine Runde - und was sie an Meldungen ergibt, geht am Ende raus.

        Gesammelt statt sofort verschickt: In einer Runde wird alles auf
        einmal geprüft, und drei offene Fenster sind dann drei
        Vibrationen hintereinander, von denen man die dritte nicht mehr
        liest. Was sich sammeln lässt, sagt ``core/pushbuendel.py``;
        alles andere geht unverändert raus, bloss am Ende der Runde
        statt mittendrin - und die dauert Millisekunden, verzögert also
        nichts.

        Der Eimer wird auch dann geleert, wenn eine Prüfung stolpert:
        Sonst hinge die Meldung über den Wasserschaden an einem Fehler
        in der Gutschein-Erinnerung.
        """
        self._eimer = []
        try:
            await self._runde()
        finally:
            eimer, self._eimer = self._eimer, None
            await self._eimer_leeren(eimer or [])

    async def _eimer_leeren(self, meldungen: list[dict[str, Any]]) -> None:
        """Was die Runde ergeben hat, verschicken (gebündelt, wo es passt)."""
        for meldung in pushbuendel.buendeln(meldungen):
            await self._senden(
                str(meldung.get("title") or ""),
                str(meldung.get("body") or ""),
                category=str(meldung.get("category") or "outage"),
                to=meldung.get("to"),
                data=meldung.get("data"),
                entity_id=meldung.get("entity_id"),
            )

    async def _runde(self) -> None:
        # Frisch lesen, nicht cachen: Die App ändert die Regeln im
        # Datenspeicher, und die nächste Runde soll sie schon kennen.
        self.rules = notifyrules.effective(self.hub.data.get("notify_rules"))
        entities = self.hub.registry.all()
        await self._check_appliances(entities)
        await self._check_grill(entities)
        await self._check_devices(entities)
        await self._check_flattern()
        await self._check_batteries(entities)
        await self._check_funk(entities)
        await self._check_open(entities)
        await self._check_leaks(entities)
        await self._check_sauger(entities)
        self._record_energy(entities)
        # Abgelaufene Kamera-Clips wegräumen (Punkt 256 der Werkbank) -
        # hier statt in einem eigenen Zeitplan: Der Wächter ist der
        # bestehende Minutentakt, und eine zweite Uhr müsste jemand warten.
        cliparchiv.aufraeumen_lauf(self.hub)
        bildarchiv.aufraeumen_lauf(self.hub)
        await self._check_disk()
        await self._check_storm_covers(entities)
        await self._check_heat_covers(entities)
        await self._check_frost(entities)
        await self._check_regen(entities)
        await self._check_giessen(entities)
        await self._check_maintenance()
        await self._check_shopping(entities)
        await self._check_gutschein_ort(entities)
        await self._check_vorrat()
        await self._check_wlanscheine()
        await self._check_medications()
        await self._check_birthdays()
        await self._check_morgen(entities)
        await self._check_emergency()
        await self._check_presence()
        await self._check_week_ahead()
        await self._check_packliste()
        await self._check_losfahren(entities)
        await self._check_family_cleanup()
        await self._check_vouchers()
        # Was abgelaufene Gäste hinterlassen (Punkt 498 der Werkbank).
        await self._gastspuren_aufraeumen()
        await self._check_meal_plan()
        await self._check_access()
        await self._check_spaeter()
        await self._check_babysitter()
        await self._check_alarmwache()
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

    async def _check_flattern(self) -> None:
        """Meldet eine Anbindung, die dauernd neu verbindet.

        Die Lücke zwischen «da» und «weg»: Der Ausfallmelder oben hat
        eine Karenz von Minuten und greift nicht, wenn die Verbindung
        vorher wieder steht. Genau das tut ein Fernseher am Rand der
        Reichweite - und verschluckt dabei jeden Tastendruck, der in eine
        gerade zumachende Leitung fällt.

        Höchstens einmal je Fenster: Erst wenn ein ganzes Fenster Ruhe
        war, darf dieselbe Anbindung wieder gemeldet werden. Ohne diesen
        Abstand käme die Meldung im Wechsel mit jeder einzelnen Rückkehr
        - der Fehler, den die Akku-Warnung schon einmal gemacht hat
        (tests/pushstand.py zählt das inzwischen mit).
        """
        schwelle = max(2, round(self.rules["flattern"]["params"]["mal"]))
        jetzt = time.time()
        for name, zeiten in list(self._rueckkehr.items()):
            frisch = [zeit for zeit in zeiten if jetzt - zeit < flattern.FENSTER]
            if not frisch:
                self._rueckkehr.pop(name, None)
                continue
            self._rueckkehr[name] = frisch
            if not flattern.flattert(frisch, schwelle):
                continue
            zuletzt = self._flattern_gemeldet.get(name, 0.0)
            if jetzt - zuletzt < flattern.FENSTER:
                continue
            self._flattern_gemeldet[name] = jetzt
            await self._notify(
                f"{name} verbindet dauernd neu",
                flattern.satz(name, len(frisch)),
            )

    def _cover_guard(self, art: str) -> list[str]:
        """Eine gespeicherte Auswahl der Wächter-Regeln.

        Vier Arten in derselben Zeile: «storm» und «heat» sind Storen,
        «temp» und «humidity» die Fühler, auf die der Hitze-Hinweis
        hört (Punkt 540). Leer heisst überall alle.
        """
        return storenwaechter.guard_auswahl(self.hub.data.get("cover_guard"), art)

    def _sonnenhoehe(self) -> float:
        location = self.hub.config.location or {}
        lat = float(location.get("latitude", 47.13844))
        lon = float(location.get("longitude", 7.92059))
        elevation, _azimut = astro.sun_position(datetime.now(), lat, lon)
        return elevation

    async def _sturm_vorwarnen(
        self, lage: dict[str, str] | None, entities: list[Any]
    ) -> None:
        """Bescheid sagen, bevor es losgeht (core/sturmvorwarnung.py).

        Der Sturmwächter darunter fährt die Storen hoch und meldet, dass
        er es getan hat. Das ist der richtige Griff für die Lamellen -
        und beantwortet die andere Hälfte nicht: Der Sonnenschirm, die
        Kissen, das Trampolin. Dafür braucht man Vorlauf, und den gibt
        ``onset`` her.
        """
        jetzt = datetime.now()
        if not sturmvorwarnung.faellig(lage, jetzt):
            return
        assert lage is not None
        kennung = sturmvorwarnung.marke(lage)
        gewarnt = self.hub.data.get(sturmvorwarnung.STORE_KEY)
        if sturmvorwarnung.schon_gewarnt(gewarnt, kennung):
            return
        # Vormerken *bevor* die Meldung rausgeht: Scheitert der Versand,
        # soll er nicht im nächsten Takt erneut versucht werden -
        # dasselbe Muster wie beim Verwaisten-Hinweis.
        self.hub.data.set(
            sturmvorwarnung.STORE_KEY,
            sturmvorwarnung.vermerken(gewarnt, kennung, time.time()),
        )
        titel, text = sturmvorwarnung.text(
            lage, [e.label for e in open_contacts(entities)], jetzt
        )
        await self._notify(titel, text, category="storm_covers")

    async def _check_storm_covers(self, entities: list[Any]) -> None:
        """Sturm, Hagel oder Gewitter angekündigt: die Storen hochfahren.

        Hier wird gehandelt statt gefragt - ein heruntergelassener Behang
        ist die Angriffsfläche für den Wind, und Hagel verbeult Lamellen,
        während das Glas dahinter hält. Die Beschattung (shading) schützt
        nur ihre konfigurierten Fenster; dieser Wächter nimmt die
        gewählten (oder alle) Storen und sagt danach Bescheid.
        """
        if not self.rules.get("storm_covers", {}).get("enabled", True):
            return
        warnung = next(
            (e for e in entities if getattr(e, "kind", "") == "alert"), None
        )
        if warnung is None:
            return
        lage = storenwaechter.unwetter(getattr(warnung, "state", None) or {})
        # Erst die Vorwarnung, dann das Fahren: Was der Hub hochfahren
        # kann, fährt er; was draussen liegt, muss ein Mensch
        # hereinholen - und dafür braucht er Vorlauf
        # (core/sturmvorwarnung.py).
        await self._sturm_vorwarnen(lage, entities)
        gemerkt = self.hub.data.get(storenwaechter.STURM_STORE_KEY)
        schritt, neu = storenwaechter.sturm_schritt(lage, gemerkt, time.time())
        if schritt == "entwarnen":
            # Runter fährt hier nichts - das entscheiden Mensch und
            # Beschattung. Gesagt wird es trotzdem: Wer die Storen von
            # Hand hochfahren liess, will wissen, wann er sie wieder
            # runterlassen kann.
            self.hub.data.set(storenwaechter.STURM_STORE_KEY, neu)
            grund = str(
                next(
                    (row.get("grund") for row in (gemerkt or []) if isinstance(row, dict)),
                    "Unwetter",
                )
            )
            await self._notify(
                f"✅ {grund} vorbei",
                "Die Warnung ist aufgehoben. Die Storen stehen noch oben - "
                "runter geht es von Hand, wann immer es passt.",
                category="storm_covers",
            )
            return
        if schritt != "fahren":
            return
        storen = storenwaechter.storen_auswahl(entities, self._cover_guard("storm"))
        if not storen:
            return
        self.hub.data.set(storenwaechter.STURM_STORE_KEY, neu)
        gefahren = 0
        with as_source(automation_source("watchdog:storm", "Sturmwächter")):
            for entity in storen:
                try:
                    if "set_position" in (entity.commands or []):
                        await self.hub.integrations.dispatch_command(
                            entity.id, "set_position", {"position": 100}
                        )
                    elif "open" in (entity.commands or []):
                        await self.hub.integrations.dispatch_command(
                            entity.id, "open", {}
                        )
                    else:
                        continue
                    gefahren += 1
                except Exception as err:
                    log.warning(
                        "Sturmwächter: %s liess sich nicht fahren: %s",
                        entity.id,
                        err,
                    )
        if not gefahren:
            return
        anzahl = "Die Store ist" if gefahren == 1 else f"{gefahren} Storen sind"
        await self._notify(
            # Mit Zeichen am Anfang, wie beim Alarm: Auf dem
            # Sperrbildschirm zwischen zwanzig Zeilen erkennt man daran,
            # dass hier etwas passiert ist.
            f"⚠️ {lage['grund']}warnung - Storen hochgefahren",
            f"{anzahl} hochgefahren: Unten wären die Lamellen dem Wetter "
            "ausgesetzt. Runter geht es wieder von Hand, sobald es vorbei ist.",
            category="storm_covers",
        )

    async def _check_heat_covers(self, entities: list[Any]) -> None:
        """Sommerhitze: tagsüber der Storen-Vorschlag, abends das Lüften.

        Bewusst nur Sätze, keine Taten (core/suggest.py-Doktrin): Wer am
        Esstisch sitzt, will nicht plötzlich im Dunkeln sitzen. Je einmal
        am Tag, und der Abend-Hinweis erst, wenn es draussen wirklich
        kühler ist - sonst lüftet man warme Luft herein.
        """
        regel = self.rules.get("heat_covers", {})
        if not regel.get("enabled", True):
            return
        # Welche Fühler zählen, steht neben der Storen-Auswahl derselben
        # Regel (Punkt 540). Leer heisst alle - wie bei den Storen.
        innen = storenwaechter.innentemperatur(entities, self._cover_guard("temp"))
        if innen is None:
            return
        # Die Feuchte nur, wenn jemand Fühler dafür angehakt hat - anders
        # als bei der Temperatur heisst leer hier *nicht* «alle». Die
        # Nachricht nannte bisher keine Feuchte, und das soll sie ohne
        # Zutun weiterhin nicht: Eine Zahl, die niemand ausgesucht hat,
        # taucht sonst nach einem Update einfach auf.
        feuchtefuehler = self._cover_guard("humidity")
        feuchte = (
            storenwaechter.innenfeuchte(entities, feuchtefuehler)
            if feuchtefuehler
            else None
        )
        schwelle = float(regel.get("params", {}).get("innen_ab", 25))
        jetzt = datetime.now()
        heute = jetzt.strftime("%Y-%m-%d")
        elevation = self._sonnenhoehe()

        if storenwaechter.hitze_tagsueber(innen, schwelle, elevation, jetzt.hour):
            if self._einmal(f"heat-tag:{heute}"):
                # Die Feuchte nur, wo jemand einen Fühler dafür
                # angehakt hat: Sonst stünde eine Zahl in der Nachricht,
                # die niemand ausgesucht hat - und bei 28 Grad ist es
                # gerade die Feuchte, die «warm» von «schwül»
                # unterscheidet.
                schwuel = f" bei {feuchte:g} % Luftfeuchtigkeit" if feuchte is not None else ""
                await self._notify(
                    "Drinnen wird es warm",
                    f"Im Haus sind es {innen:g} °C{schwuel} und die Sonne "
                    "steht hoch. Storen auf der Sonnenseite unten halten die "
                    "Wärme draussen - je früher, desto mehr bringt es.",
                    category="heat_covers",
                )
            return

        wetter = next(
            (e for e in entities if getattr(e, "kind", "") == "weather"), None
        )
        draussen = None
        if wetter is not None:
            wert = (getattr(wetter, "state", None) or {}).get("temperature")
            draussen = float(wert) if isinstance(wert, (int, float)) else None
        if storenwaechter.lueften_abends(innen, draussen, schwelle, elevation):
            if self._einmal(f"heat-abend:{heute}"):
                await self._notify(
                    "Jetzt querlüften",
                    f"Draussen sind es noch {draussen:g} °C, drinnen {innen:g} - "
                    "Fenster auf beiden Seiten auf, und die Wärme zieht ab.",
                    category="heat_covers",
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
        # Wer «Gegossen» oder «Passt so» gedrückt hat, soll Ruhe haben -
        # gegossen zählt wie Regen, passt für die ganze Trockenperiode
        # (core/giessen.py, unterdrueckt).
        if giessen.unterdrueckt(
            self.hub.data.get(giessen.QUITTUNG_KEY),
            wetter.state.get("dry_days"),
            heute,
            int(params.get("days", 3)),
        ):
            return
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

    async def _check_gutschein_ort(self, entities: list[Any]) -> None:
        """Den Gutschein melden, während man im Laden steht.

        Die Verfalls-Erinnerung (Punkt 264) hilft gegen den vergessenen
        Gutschein. Sie hilft nicht gegen den Fehler, der öfter vorkommt:
        Man steht bei Ochsner Sport, kauft Turnschuhe, und der Gutschein
        liegt zuhause in der App. Gemerkt hat man ihn sich beim
        Frühstück; im Laden dachte man an die Schuhgrösse.

        Dieselbe Maschinerie wie beim Einkaufszettel - die Orte, das
        Betreten, das Merken je Aufenthalt. Zusammengeführt wird über
        den Ladennamen (core/gutscheinort.py); eigene Zonen bringt das
        hier nicht mit.
        """
        shops = self.hub.data.get("family_shops")
        if not shops:
            return
        gutscheine = self.hub.data.get("family_vouchers")
        if not gutscheine:
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
        for shop in shops:
            if not isinstance(shop, dict):
                continue
            ort = str(shop.get("name") or "").strip()
            treffer = gutscheinort.hier_gueltig(gutscheine, ort, jetzt)
            if not treffer:
                continue
            zone_id, stand, marke = shopping.wer_steht_dort(shop, zonen)
            if stand is None:
                continue
            # Einmal je Aufenthalt, wie beim Einkaufszettel: Verglichen
            # wird der Zeitpunkt des Betretens. Beim nächsten Besuch ist
            # der ein anderer, und die Erinnerung kommt wieder.
            betreten = stand.get("changed_at")
            schluessel = f"gutschein:{marke}"
            if self._shop_reminded.get(schluessel) == betreten:
                continue
            self._shop_reminded[schluessel] = betreten
            empfaenger = self._benutzer_zur_zone(zone_id, namen)
            if empfaenger is None:
                continue
            # Nur an den, der dort steht - und private Gutscheine gehen
            # ohnehin nur ihren Besitzer etwas an.
            eigene = [
                zeile
                for zeile in treffer
                if not zeile.get("private") or zeile.get("owner") == empfaenger
            ]
            if not eigene:
                continue
            titel, text = gutscheinort.satz(eigene, ort)
            await self._notify(titel, text, category="vouchers", to=empfaenger)

    async def _check_vorrat(self) -> None:
        """Standardartikel mit Takt selbst auf die Einkaufsliste setzen.

        Der Fall: Kaffee, Waschmittel, Katzenstreu. Sie fallen erst auf,
        wenn die Packung leer ist - und dann steht man in der Küche und
        nicht im Laden. Die Standardartikel halfen nur dem, der ohnehin
        auf die Liste schaute; der gelernte Rhythmus schlug bloss vor
        (siehe core/vorrat.py).

        Jede Runde und nicht einmal am Tag: Der Scan ist eine Handvoll
        Einträge, und wer gerade einen Takt eingestellt hat, soll den
        Posten sofort auf der Liste sehen statt am nächsten Morgen.
        Eingetragen wird trotzdem höchstens einmal je Takt - ein Posten,
        der schon offen dasteht, zählt als erledigt.
        """
        import secrets

        staples = self.hub.data.get("family_staples")
        if not staples:
            return
        jetzt = time.time()
        liste = self.hub.data.get("family_shopping")
        offen = {
            str(row.get("text") or "").strip().lower()
            for row in liste
            if isinstance(row, dict) and not row.get("done")
        }
        dran = vorrat.faellig(staples, offen, jetzt)
        if not dran:
            return
        for staple in dran:
            liste.append(
                {
                    "id": secrets.token_urlsafe(8),
                    "text": str(staple.get("text") or "").strip(),
                    "category": str(staple.get("category") or ""),
                    # Wer den Posten anfasst, soll sehen, woher er kommt -
                    # sonst sucht man den Mitbewohner, der ihn eingetragen
                    # hat, und findet keinen.
                    "author": "Vorrat",
                    "created": datetime.now().isoformat(timespec="seconds"),
                }
            )
        self.hub.data.set("family_shopping", liste)
        await self.hub.bus.publish("family_changed", {"collection": "shopping"})
        titel, text = vorrat.meldung(
            [str(staple.get("text") or "").strip() for staple in dran]
        )
        await self._notify(titel, text, category="shopping")

    async def _check_wlanscheine(self) -> None:
        """Abgelaufene Gäste-Gutscheine wegräumen.

        Der UniFi-Controller zählt die Gültigkeit erst ab der ersten
        Anmeldung. Ein gezogener, nie benutzter Code läge dort deshalb
        für immer - und der abfotografierte Aufkleber von letztem Sommer
        wäre eine Dauerkarte. Zwölf Stunden ab dem Ziehen kann nur der
        Hub durchsetzen, also tut er es hier (siehe core/wlanschein.py).

        Der Eintrag im Buch fällt auch dann weg, wenn der Controller
        gerade nicht antwortet: Sonst versucht der Wächter es im
        Minutentakt weiter, und die Liste wüchse. Ein Gutschein, der im
        Controller überlebt, ist ärgerlich; einer, den der Hub für ewig
        im Buch führt, ist ein Fehler, der nie aufhört.
        """
        buch = self.hub.data.get("wifi_vouchers")
        if not buch:
            return
        gueltig, weg = wlanschein.aufteilen(buch, time.time())
        if not weg:
            return
        unifi = self.hub.integrations.get("unifi")
        for eintrag in weg:
            voucher_id = str(eintrag.get("id") or "")
            if not voucher_id or unifi is None or not hasattr(unifi, "delete_voucher"):
                continue
            try:
                await unifi.delete_voucher(voucher_id)
            except Exception as err:
                log.warning(
                    "Gäste-WLAN: abgelaufener Gutschein %s nicht gelöscht: %s",
                    eintrag.get("code") or voucher_id,
                    err,
                )
        log.info("Gäste-WLAN: %s abgelaufene Gutscheine weggeräumt", len(weg))
        self.hub.data.set("wifi_vouchers", gueltig)

    async def _gastspuren_aufraeumen(self) -> None:
        """Was abgelaufene Gäste hinterlassen (Punkt 498 der Werkbank).

        Der Gastpass läuft ab, und das tut er zuverlässig - in der Liste
        bleibt er sichtbar, damit man weiss, wem man den Zugang gegeben
        hat. Was nicht aufhörte, ist alles daneben: die offene Sitzung
        am Token und der WLAN-Schein mit eigener Frist. Nach einem Jahr
        Gästen ist das die längste Liste im Haus.

        Der Benutzer selbst bleibt stehen: Ihn zu löschen wäre eine
        Entscheidung, und die trifft ein Mensch in der Benutzerliste.
        Hier verschwinden nur die Spuren, die niemand je angelegt hat -
        die entstanden beim Anmelden.

        Einmal am Tag, nicht im Minutentakt: Es eilt nichts, und eine
        Aufräumrunde, die stündlich über alle Sitzungen geht, ist die
        Sorte Hintergrundarbeit, die man erst bemerkt, wenn sie klemmt.
        """
        jetzt = datetime.now()
        if jetzt.hour != 4:
            return
        heute = jetzt.strftime("%Y-%m-%d")
        if not self._einmal(f"gastspuren:{heute}", jetzt.timestamp()):
            return
        namen = gastspur.abgelaufene_gaeste(self.hub.users.users, heute)
        if not namen:
            return
        sitzungen = self.hub.data.get("sessions")
        uebrig = gastspur.sitzungen_ohne(sitzungen, namen)
        weniger_sitzungen = len(sitzungen) - len(uebrig)
        if weniger_sitzungen:
            self.hub.data.set("sessions", uebrig)

        scheine = self.hub.data.get("wifi_vouchers")
        rest = gastspur.scheine_ohne(scheine, namen)
        weniger_scheine = len(scheine) - len(rest)
        if weniger_scheine:
            self.hub.data.set("wifi_vouchers", rest)

        satz = gastspur.bericht(namen, weniger_sitzungen, weniger_scheine)
        if satz:
            log.info("%s", satz)

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
                # Dieselbe Schwelle wie die Warnung selbst - sonst nennt
                # die Morgen-Nachricht andere Geräte als die Batterie-Push.
                schwach=[
                    entity.label
                    for entity in low_batteries(
                        entities,
                        batterie.prefs_lesen(
                            self.hub.data.get(batterie.PREFS_KEY)
                        )["threshold"],
                    )
                ],
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
            akku = entity.state.get("battery")
            text = presence.battery_alert(entity.label, akku, grenze)
            if text and zone_id not in self._battery_told:
                self._battery_told.add(zone_id)
                # Der Schalter wird erst hier geprüft, nicht schon oben:
                # Der Vermerk soll auch dann stehen, wenn niemand die
                # Meldung will - sonst käme sie geballt, sobald jemand
                # sie wieder einschaltet.
                if personen.an(schalter, zone_id, "battery"):
                    await self._notify("Telefon fast leer", text, category="presence")
            elif presence.battery_recovered(akku, grenze):
                # Vergessen erst, wenn der Akku mit Abstand wieder oben
                # ist - vorher stand hier «kein Warntext», und den gibt es
                # auch bei einer Meldung ganz ohne Akkuwert. Ein Wechsel
                # aus Wert und Nichtwert setzte den Vermerk deshalb
                # dauernd zurück, und dieselbe Push kam wieder und wieder.
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

    async def _check_packliste(self) -> None:
        """Was morgen in den Thek gehört - am Vorabend (core/packliste.py).

        Der Stundenplan weiss, wann Sport ist; dass dann der Turnsack
        mitmuss, wusste bisher nur der Kopf der Eltern - und der Abend
        um neun ist der Moment, in dem er es vergisst. Ohne Einträge
        für morgen kommt nichts.
        """
        jetzt = datetime.now()
        stunde = int(self.rules["packlist"]["params"].get("hour", 19))
        if jetzt.hour != stunde:
            return
        heute = jetzt.strftime("%Y-%m-%d")
        if not self._einmal(f"packlist:{heute}"):
            return
        morgen = (jetzt + timedelta(days=1)).date()
        zeilen = packliste.morgen_zeilen(self.hub.data.get("family_gear"), morgen)
        text = packliste.satz(zeilen)
        if not text:
            return
        await self._notify("Packliste für morgen", text, category="packlist")

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
        geleert = trash.purge(korb)
        # Was nach dreissig Tagen aus dem Korb fällt, nimmt sein Bild
        # und seine Datei mit. Vorher blieben die Rezeptfotos für immer
        # liegen - und ein Gutscheinfoto mit Nummer und Strichcode soll
        # nicht länger auf der Platte sein als der Eintrag, zu dem es
        # gehört. Fürs angehängte PDF (Punkt 266) gilt dasselbe, nur
        # deutlicher: Es IST der Gutschein.
        geblieben = {
            (row.get("kind"), (row.get("item") or {}).get("id")) for row in geleert
        }
        for row in korb:
            art = str(row.get("kind") or "")
            kennung = (row.get("item") or {}).get("id")
            if (art, kennung) in geblieben:
                continue
            if art in bilder.ORDNER:
                bilder.loeschen(bilder.ordner(self.hub.data.path, art), kennung)
            if art in dateien.ORDNER:
                dateien.loeschen(dateien.ordner(self.hub.data.path, art), kennung)
        self.hub.data.set("family_trash", geleert)
        # Und einmal im Monat das Familienbuch (Punkt 169): eine Seite,
        # die auch ohne HomePilot noch lesbar ist.
        monat = jetzt.strftime("%Y-%m")
        if self._einmal(f"book:{monat}", jetzt.timestamp()):
            ziel = self.hub.data.family_book(monat)
            if ziel is not None:
                log.info("Familienbuch abgelegt: %s", ziel)

    async def _check_vouchers(self) -> None:
        """Gutscheine, die bald verfallen (Punkt 264 der Werkbank).

        Dreimal je Gutschein, jede Stufe genau einmal: eine erste und
        eine zweite Erinnerung (Vorgabe 30 und 7 Tage, einstellbar unter
        Push → Gutscheine) und der Ablauftag selbst. Das Gedächtnis ist
        `_einmal` und überlebt den Neustart. Am Morgen, nicht im
        Minutentakt: «Brack: 80 CHF verfallen in 7 Tagen» liest man beim
        Kaffee und bestellt am Abend; um drei Uhr nachts weckt es nur.

        Private Gutscheine gehen an den, der sie eingetragen hat; die
        anderen erfahren nicht einmal, dass es sie gibt. Geteilte gehen
        an alle - jeder könnte ihn einlösen (core/gutscheine.py).

        Danach eine vierte, andere Meldung (Punkt 372 der Werkbank): der
        Tag nach dem Verfall, mit dem Betrag, der jetzt weg ist - und der
        Gutschein wandert dabei ins Archiv.
        """
        # Der Schalter der Regel «Gutschein läuft bald ab» (Abläufe →
        # Push). Bisher gab es ihn nicht: Die Erinnerung liess sich nur
        # je Person abbestellen, nicht fürs Haus abschalten - als
        # einzige der Familien-Nachrichten.
        if not self.rules.get("vouchers", {}).get("enabled", True):
            return
        jetzt = datetime.now()
        if jetzt.hour != 9:
            return
        rows = self.hub.data.get(gutscheine.KEY)
        if not rows:
            return
        prefs = gutscheine.prefs_lesen(self.hub.data.get(gutscheine.PREFS_KEY))
        for eintrag, stufe, tage in gutscheine.ablaufende(
            rows, jetzt.date(), gutscheine.stufen(prefs)
        ):
            if not self._einmal(gutscheine.marke(eintrag, stufe), jetzt.timestamp()):
                continue
            titel, text = gutscheine.meldung(eintrag, tage)
            await self._notify(
                titel,
                text,
                category="vouchers",
                to=gutscheine.empfaenger(eintrag),
                data={"kind": "family", "collection": "vouchers", "id": eintrag.get("id")},
            )
        # Die letzte Meldung, einen Tag nach dem Verfall (Punkt 372 der
        # Werkbank): Was bis hier nicht abgezogen wurde, ist weg - und
        # der Gutschein gehört danach nicht mehr in die offene Liste.
        # Eigene Marke statt einer vierten Stufe in STUFEN: Die drei dort
        # sind Tage *vor* dem Ablauf und fest verdrahtet mit den
        # Einstellungen (first_days/second_days); diese Meldung hängt an
        # keiner Einstellung und soll auch nicht mitwandern, wenn jemand
        # die Fristen ändert.
        frisch = gutscheine.frisch_verfallen(rows, jetzt.date())
        if frisch:
            geaendert = False
            for eintrag in frisch:
                if not self._einmal(f"voucher-verfallen:{eintrag.get('id')}", jetzt.timestamp()):
                    continue
                titel, text = gutscheine.verfalls_meldung(eintrag)
                await self._notify(
                    titel,
                    text,
                    category="vouchers",
                    to=gutscheine.empfaenger(eintrag),
                    data={"kind": "family", "collection": "vouchers", "id": eintrag.get("id")},
                )
                eintrag["archived"] = True
                geaendert = True
            # Nur schreiben, wenn wirklich etwas dazukam - sonst würde
            # jede Stunde ein identischer Stand neu abgelegt.
            if geaendert:
                self.hub.data.set(gutscheine.KEY, rows)

        # Aufgebrauchtes räumt sich selbst weg (Punkt 455 der Werkbank).
        #
        # Ein leerer Gutschein steht nicht mehr in der offenen Liste,
        # aber in der eingeklappten Gruppe «leer» darunter - und dort
        # blieb er, weil man eine zugeklappte Gruppe nicht aufräumt.
        # Nach einem Monat ist die Rückfrage beim Laden ohnehin keine
        # mehr, die man aus dem Gedächtnis stellt; ab dann gehört er ins
        # Archiv, wo er weiterhin steht und auffindbar bleibt.
        #
        # Ohne Meldung, anders als beim Verfall: Verfallen ist ein
        # Verlust, den man erfahren soll; aufgebraucht ist der
        # Normalfall, und eine Nachricht «dein leerer Gutschein wurde
        # aufgeräumt» wäre genau die Sorte Push, die man abbestellt.
        aufgeraeumt = gutscheine.lange_leer(rows, jetzt.date())
        if aufgeraeumt:
            for eintrag in aufgeraeumt:
                eintrag["archived"] = True
            log.info("%d aufgebrauchte Gutscheine ins Archiv gelegt", len(aufgeraeumt))
            self.hub.data.set(gutscheine.KEY, rows)

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
            ende = users.access_end(user.expires, user.hours, jetzt, user.days)
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
            # Ein wiederkehrendes Fenster («jeden Donnerstag 8-12») endet
            # nicht, es pausiert - die Familie jeden Donnerstag um 12:01
            # zu behelligen, wäre Lärm. Gemeldet wird erst, wenn auch das
            # Datum vorbei ist.
            if users.laeuft_wieder(user.days, user.expires, jetzt.strftime("%Y-%m-%d")):
                continue
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
                    entity_id=entity.id,
                )

    async def _check_grill(self, entities: list[Any]) -> None:
        """Der Grill ist auf Temperatur - und das Fleisch ist so weit.

        Gewünscht im Haus (Punkt 554): «Wenn der Grill die
        Zieltemperatur erreicht hat, aber auch, wenn ein
        Kerntemperaturmesser das Ziel erreicht hat.»

        Gemeldet wird die **Flanke**. Was einmal gemeldet ist, steht in
        `_grill_gemeldet` und schweigt, bis der Wert wieder deutlich
        unter das Ziel fällt - wer den Sollwert hochdreht, bekommt die
        Meldung also erneut, wer nur ums Ziel pendelt, nicht.

        Der Grill ist am Temperaturziel als solcher erkennbar - dieselbe
        Regel wie bei der Live-Karte (core/livekarten.py, karten_grill).
        Eine Waschmaschine hat keines.
        """
        ziele_alle = self.hub.data.get(GRILLZIELE_KEY)
        for entity in entities:
            if entity.kind != "appliance":
                continue
            ziel = entity.state.get("target")
            laeuft = str(entity.state.get("state") or "") == "running"
            einheit = str(entity.state.get("unit") or "°")
            ist = entity.state.get("temperature")

            # «Er lief» - die Marke, an der das Ausgehen erkennbar ist
            # (Punkt 560). Nur die Flanke: Ein Hub, der mit kaltem Grill
            # startet, hat nichts zu melden. Und nur ein gemeldetes
            # «off», nicht ein unerreichbarer Grill - der behält seinen
            # letzten Zustand, bis er wieder antwortet.
            an_marke = f"{entity.id}:an"
            if not laeuft:
                if an_marke in self._grill_gemeldet:
                    titel, text = grillmeldung.aussatz(entity.label, ist, einheit)
                    await self._notify(titel, text, "grill", entity_id=entity.id)
                # Aus heisst: alles vergessen. Beim nächsten Anzünden
                # soll die Meldung wiederkommen, auch wenn der Grill
                # noch warm ist.
                self._grill_vergessen(entity.id)
                continue
            if ziel is None:
                continue
            self._grill_gemeldet.add(an_marke)

            marke = f"{entity.id}:grill"
            if grillmeldung.auf_temperatur(ist, ziel):
                if marke not in self._grill_gemeldet:
                    self._grill_gemeldet.add(marke)
                    titel, text = grillmeldung.grillsatz(entity.label, ziel, einheit)
                    await self._notify(titel, text, "grill", entity_id=entity.id)
            elif grillmeldung.wieder_offen(ist, ziel):
                self._grill_gemeldet.discard(marke)

            for nummer, fuehlerziel in grillmeldung.fuehlerziele(
                ziele_alle, entity.id
            ).items():
                wert = entity.state.get(f"probe_{nummer}")
                # Kein Fühler eingesteckt: Das Ziel bleibt gesetzt, die
                # Meldung wartet. Wer den Fühler ins nächste Stück
                # steckt, soll sie bekommen.
                if wert is None:
                    self._grill_gemeldet.discard(f"{entity.id}:p{nummer}")
                    continue
                fuehlermarke = f"{entity.id}:p{nummer}"
                # Ohne Spielraum: Die Kerntemperatur steigt langsam und
                # stetig, und «63 statt 61» ist beim Fleisch der
                # Unterschied, um den es geht.
                if float(wert) >= float(fuehlerziel):
                    if fuehlermarke not in self._grill_gemeldet:
                        self._grill_gemeldet.add(fuehlermarke)
                        titel, text = grillmeldung.fuehlersatz(
                            entity.label, nummer, wert, fuehlerziel, einheit
                        )
                        await self._notify(titel, text, "grill", entity_id=entity.id)
                elif grillmeldung.wieder_offen(wert, fuehlerziel):
                    self._grill_gemeldet.discard(fuehlermarke)

    def _grill_vergessen(self, entity_id: str) -> None:
        """Alles zu diesem Grill vergessen - er ist aus."""
        self._grill_gemeldet -= {
            marke for marke in self._grill_gemeldet if marke.startswith(f"{entity_id}:")
        }

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
        # Tumbler umlädt, hat beide vor sich. Aber NUR für die: Der
        # Geschirrspüler steht in der Küche, und die Waschküchentüre
        # sagt nichts darüber, ob ihn jemand ausgeräumt hat
        # (waschkueche.tuer_buergt).
        tuer = waschkueche.tuer(entities, self._waschkuechentuer())
        tuer_raum = getattr(tuer, "room", None) if tuer is not None else None
        offen = waschkueche.ist_offen(tuer)
        wer_da_war = offen and not self._wk_offen
        self._wk_offen = offen
        if wer_da_war:
            for entity in entities:
                if entity.kind != "appliance" or not waschkueche.tuer_buergt(
                    entity, tuer_raum
                ):
                    continue
                self._finished_at.pop(entity.id, None)
                self._gemahnt.pop(entity.id, None)
                self._gemahnt_at.pop(entity.id, None)
                # Und die Übernahme: Wer unten war, hat die Sache
                # erledigt - «Bine räumt aus» am Gerät stehen zu lassen,
                # nachdem sie ausgeräumt hat, wäre eine Auskunft von
                # gestern.
                await self._uebernahme_loeschen(entity.id)

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
                self._gemahnt_at.pop(entity.id, None)
                if before != "running":
                    await self._uebernahme_loeschen(entity.id)
                # Kochgeräte (Punkt 248): Endet die Aufheizphase, ist der
                # Ofen parat - genau der Moment, für den man sonst
                # dreimal in die Küche läuft.
                if ofen.kochgeraet(entity.label):
                    phase = ofen.heizt_vor(
                        entity.state.get("program"), entity.state.get("status")
                    )
                    war = self._vorheiz.get(entity.id, False)
                    self._vorheiz[entity.id] = phase
                    if war and not phase and before == "running":
                        await self._kueche_durchsage(
                            entity, "parat", ofen.parat_satz(entity.label)
                        )
                continue
            if before == "running" and state == "idle":
                self._finished_at[entity.id] = now
                self._log_cycle(entity, now)
                # Und das Programmende: Die Waschküche wird später
                # gemahnt (unten), das Essen ist *jetzt* fertig.
                if ofen.kochgeraet(entity.label):
                    self._vorheiz.pop(entity.id, None)
                    await self._kueche_durchsage(
                        entity, "fertig", ofen.fertig_satz(entity.label)
                    )
                continue

            since = self._finished_at.get(entity.id)
            # Eine Übernahme, die keinen laufenden Fall mehr meint, fällt
            # weg - samt dem Namen am Gerät. Sonst stünde nach einem
            # Neustart des Hubs für immer «Bine räumt aus» an einer
            # Maschine, die längst leer ist: Der Merker der Programmläufe
            # lebt nur im Speicher, die Übernahme aber in der Datei.
            uebernahme = self._uebernahmen().get(entity.id)
            if uebernahme is not None and not waschkueche.uebernahme_gilt(
                uebernahme, since
            ):
                await self._uebernahme_loeschen(entity.id)
                uebernahme = None
            if since is None:
                continue
            # Hat jemand «Ich mach's» gedrückt, ist die Frage
            # beantwortet - nachzuhaken hiesse, ihm zu misstrauen.
            if uebernahme is not None:
                continue
            gemahnt = self._gemahnt.get(entity.id, 0)
            params = self.rules["appliance"]["params"]
            if not waschkueche.faellig(
                since,
                gemahnt,
                now,
                params["hours"],
                # Nachgehakt wird nur, wo die Türe das Ende der Mahnungen
                # melden kann - beim Geschirrspüler in der Küche bleibt
                # es bei der einen Nachricht, wie ganz ohne Türkontakt.
                nachhaken=tuer is not None
                and waschkueche.tuer_buergt(entity, tuer_raum),
                zuletzt=self._gemahnt_at.get(entity.id),
                ruhe_von=params.get("quiet_from", waschkueche.RUHE_VON),
                ruhe_bis=params.get("quiet_to", waschkueche.RUHE_BIS),
            ):
                continue
            self._gemahnt[entity.id] = gemahnt + 1
            self._gemahnt_at[entity.id] = now
            titel, text = waschkueche.mahnsatz(entity.label, since, now, gemahnt)
            await self._notify(titel, text, "appliance", entity_id=entity.id)

    async def _kueche_durchsage(self, entity: Any, kurz: str, satz: str) -> None:
        """Parat/fertig aus der Küche: Push und Durchsage, jeder Weg für
        sich - eine fehlende Box darf die Nachricht nicht verschlucken.

        Die Durchsage geht wie beim Küchen-Timer an alle Boxen: Wer den
        Ofen angeworfen hat, sitzt bis dahin oft woanders.
        """
        await self._notify(f"{entity.label} {kurz}", satz, "oven", entity_id=entity.id)
        rule = self.rules.get("oven")
        if rule is not None and not rule["enabled"]:
            return
        try:
            from . import say

            await say.speak(self.hub, satz)
        except Exception as err:
            log.info("Küchen-Durchsage nicht möglich: %s", err)

    async def _check_losfahren(self, entities: list[Any]) -> None:
        """«Jetzt losfahren» zum Termin mit Ort (Werkbank-Punkt 258).

        Die Regeln stehen in losfahren.py; hier nur Takt, Nachschlagen
        und Gedächtnis. Ohne Haus-Koordinaten in der config.yaml bleibt
        der Wecker still - ab irgendwo lässt sich keine Fahrzeit
        schätzen.
        """
        rule = self.rules.get("departure")
        if rule is not None and not rule["enabled"]:
            return
        standort = self.hub.config.location or {}
        try:
            daheim = (float(standort["latitude"]), float(standort["longitude"]))
        except (KeyError, TypeError, ValueError):
            return
        events: list[Any] = []
        for entity in entities:
            if entity.kind == "calendar" and isinstance(
                entity.state.get("events"), list
            ):
                events.extend(entity.state["events"])
        jetzt = datetime.now().astimezone()
        termine = losfahren.kandidaten(events, jetzt)
        if not termine:
            return
        puffer = int(self.rules["departure"]["params"]["buffer"])
        orte = losfahren.orte_lesen(self.hub.data.get(losfahren.ORTE_KEY))
        erinnert = losfahren.erinnert_lesen(self.hub.data.get(losfahren.ERINNERT_KEY))
        neu: set[str] = set()
        for termin in termine:
            if termin["kennung"] in erinnert:
                continue
            koordinaten = await self._ort_koordinaten(str(termin["ort"]), orte)
            if koordinaten is None:
                continue
            km = losfahren.luftlinie_km(*daheim, *koordinaten)
            if km < losfahren.MINDEST_KM:
                continue
            minuten = losfahren.fahrminuten(km) + puffer
            if not losfahren.faellig(termin["start"], minuten, jetzt):
                continue
            titel, text = losfahren.wecker_satz(
                termin["summary"], termin["ort"], termin["start"], minuten
            )
            await self._notify(titel, text, "departure")
            neu.add(termin["kennung"])
        if neu:
            self.hub.data.set(
                losfahren.ERINNERT_KEY,
                losfahren.erinnert_zeilen(
                    self.hub.data.get(losfahren.ERINNERT_KEY), neu, time.time()
                ),
            )

    async def _ort_koordinaten(
        self, ort: str, orte: dict[str, tuple[float, float] | None]
    ) -> tuple[float, float] | None:
        """Einen Termin-Ort zu Koordinaten machen - mit Vorrat.

        Jede Adresse wird genau einmal nachgeschlagen (Nominatim, offene
        Daten von OpenStreetMap) und dann in der ``hub.data`` behalten -
        auch ein «nicht gefunden», sonst fragte jede Runde denselben
        Unsinn nach. Höchstens ein Nachschlagen je Minute: Das ist die
        Hausordnung von Nominatim, und mehr braucht ein Familienkalender
        nicht. Ein Netzfehler wird bewusst *nicht* gemerkt - die nächste
        Runde darf es nochmals versuchen.
        """
        if ort in orte:
            return orte[ort]
        jetzt = time.time()
        if jetzt - self._geo_zuletzt < 60:
            return None
        self._geo_zuletzt = jetzt
        import aiohttp

        try:
            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(
                timeout=timeout,
                headers={"User-Agent": "HomePilot-Hub (Privathaushalt)"},
            ) as session:
                async with session.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={"q": ort, "format": "json", "limit": "1"},
                ) as response:
                    response.raise_for_status()
                    daten = await response.json()
        except Exception as err:
            log.debug("Ort «%s» nicht nachschlagbar: %s", ort, err)
            return None
        koordinaten: tuple[float, float] | None = None
        if isinstance(daten, list) and daten and isinstance(daten[0], dict):
            try:
                koordinaten = (float(daten[0]["lat"]), float(daten[0]["lon"]))
            except (KeyError, TypeError, ValueError):
                koordinaten = None
        orte[ort] = koordinaten
        self.hub.data.set(losfahren.ORTE_KEY, losfahren.orte_zeilen(orte))
        return koordinaten

    def _uebernahmen(self) -> dict[str, dict[str, Any]]:
        """Wer welchen Programmlauf übernommen hat, je Gerät.

        In der Datendatei und nicht bloss im Speicher: Ein Neustart des
        Hubs darf nicht dazu führen, dass alle wieder gemahnt werden,
        obwohl längst jemand unterwegs ist.

        Gespeichert als *Liste* von Einträgen, weil der DataStore Listen
        hält - von einem Objekt gäbe ``get`` nur die Schlüssel zurück
        (siehe den Kommentar bei ``house_prefs``). Hier wird daraus
        wieder ein Verzeichnis, weil nachgeschlagen und nicht
        durchlaufen wird.
        """
        return {
            str(eintrag["entity_id"]): eintrag
            for eintrag in self.hub.data.get("laundry_claims")
            if isinstance(eintrag, dict) and eintrag.get("entity_id")
        }

    def _uebernahmen_speichern(self, alle: dict[str, dict[str, Any]]) -> None:
        self.hub.data.set("laundry_claims", list(alle.values()))

    async def uebernehmen(self, entity_id: str, name: str) -> bool:
        """«Ich mach's» – diesen Programmlauf übernimmt jemand.

        ``False`` heisst: Es gibt gerade nichts zu übernehmen. Das ist
        der Normalfall bei einem verspäteten Druck auf eine Nachricht,
        die längst überholt ist - die Maschine läuft wieder, oder jemand
        war unten. Dann soll nichts gemerkt werden, was gleich falsch
        wäre.
        """
        seit = self._finished_at.get(entity_id)
        if seit is None:
            return False
        self._uebernahmen_speichern(
            {
                **self._uebernahmen(),
                entity_id: {"entity_id": entity_id, "name": name, "seit": seit},
            }
        )
        # Am Gerät, damit die anderen es sehen, ohne die Nachricht
        # geöffnet zu haben.
        await self._claim_state(entity_id, name)
        return True

    async def _uebernahme_loeschen(self, entity_id: str) -> None:
        """Eine einzelne Übernahme zurücknehmen."""
        alle = self._uebernahmen()
        if entity_id not in alle:
            return
        self._uebernahmen_speichern(
            {key: wert for key, wert in alle.items() if key != entity_id}
        )
        await self._claim_state(entity_id, None)

    async def _claim_state(self, entity_id: str, name: str | None) -> None:
        """Den Namen ans Gerät schreiben - oder ihn wieder wegnehmen.

        Ausdrücklich ``None`` und nicht weggelassen: Der Zustand wird
        gemerged, ein fehlendes Feld bliebe stehen (siehe
        registry.update_state).
        """
        try:
            await self.hub.registry.update_state(entity_id, {"claimed_by": name})
        except Exception as err:  # noqa: BLE001 - ein Gerät kann verschwinden
            log.debug("Übernahme an %s nicht vermerkt: %s", entity_id, err)

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
        # Das Gedächtnis liegt in hub.data, nicht im Arbeitsspeicher:
        # «Terrasse steht offen» kam sonst nach jedem Hub-Neustart erneut
        # - und jedes Update ist ein Neustart. Verankert am Zeitpunkt der
        # Öffnung, damit eine *neue* Öffnung trotzdem wieder mahnt
        # (watchrules.schon_gemahnt).
        vorher = self.hub.data.get(OPEN_REPORTED_KEY)
        gemahnt = offene_meldungen_lesen(vorher, offen)
        for entity in open_contacts(entities):
            since = self._offen_seit(entity, now)
            if schon_gemahnt(gemahnt, entity.id, since):
                continue
            if now - since >= reminder:
                gemahnt[entity.id] = since
                await self._notify(
                    f"{entity.label} steht offen",
                    # Die Uhrzeit statt einer gerundeten Dauer: «Seit 1
                    # Stunde» ist nicht nachprüfbar, «seit 14:05» schon -
                    # und wer weiss, dass er um 14:20 aufgemacht hat,
                    # erkennt daran sofort einen hängenden Sensor.
                    f"{offen_satz(since, now)} – im Winter geht so die "
                    "Heizung zum Fenster hinaus.",
                    "open",
                    entity_id=entity.id,
                )
        zeilen = offene_meldungen_zeilen(gemahnt)
        if zeilen != vorher:
            self.hub.data.set(OPEN_REPORTED_KEY, zeilen)
        # Geschlossene wieder scharf stellen für die nächste Öffnung.
        for entity_id in list(self._open_since):
            if entity_id not in offen:
                self._open_since.pop(entity_id, None)

    async def _check_leaks(self, entities: list[Any]) -> None:
        """Wasser – sofort, unabhängig vom Zustand der Alarmanlage.

        Ein Wassermelder, der nur meldet, wenn die Anlage scharf ist, wäre
        nutzlos: Der Waschmaschinenschlauch platzt am liebsten, während man
        zuhause ist und nichts hört.

        Bleibt ein Melder danach ununterbrochen nass, kommt nach
        ``LECK_ESKALATION_MINUTEN`` eine zweite, eindringlichere Meldung
        (Punkt 391) - die erste kann in der Tasche verschwunden sein,
        während die Küche weiter unter Wasser steht.
        """
        aktuell = leaks(entities)
        nass = {entity.id for entity in aktuell}
        jetzt = time.time()
        for entity in aktuell:
            if entity.id not in self._reported_leak:
                self._reported_leak.add(entity.id)
                self._leak_since[entity.id] = jetzt
                await self._notify(
                    f"Wasser: {entity.label}",
                    "Der Melder meldet Wasser. Zuerst den Haupthahn, dann den "
                    "Strom in diesem Bereich.",
                    "leak",
                    entity_id=entity.id,
                )

        faellig = leck_eskalation_faellig(self._leak_since, self._leak_escalated, nass, jetzt)
        for entity in aktuell:
            if entity.id not in faellig:
                continue
            self._leak_escalated.add(entity.id)
            await self._notify(
                f"Immer noch nass: {entity.label}",
                f"Der Melder meldet {leck_dauer_text(self._leak_since[entity.id], jetzt)} "
                "ununterbrochen Wasser - offenbar hat noch niemand nachgesehen.",
                "leak",
                entity_id=entity.id,
            )

        self._reported_leak &= nass
        for entity_id in list(self._leak_since):
            if entity_id not in nass:
                self._leak_since.pop(entity_id, None)
                self._leak_escalated.discard(entity_id)

    async def _check_sauger(self, entities: list[Any]) -> None:
        """Der Sauger meldet ein Problem - Tank leer, festgefahren, voll.

        Bisher stand das nur in der Hersteller-App: Wer deren
        Mitteilungen aus hatte, merkte erst am ungesaugten Boden, dass
        der Roboter seit Stunden auf Wasser wartet. Der Hub sieht die
        Meldung ohnehin (error und dock.error am Gerät) - sie soll
        denselben Weg gehen wie alle anderen Sorgen im Haus.

        Gemeldet wird die *Änderung*, nicht der Zustand: einmal, wenn
        das Problem auftaucht, und wieder, wenn es nach einer Weile
        erneut auftaucht. Anfangs erinnerte der Hub zusätzlich jeden
        Morgen, solange das Problem blieb - dieselbe Haltung wie bei den
        Batterien (Punkt 258). Aus dem Haus kam dazu ein klares Urteil:
        Ein Schwall Nachrichten am Morgen, in dem nichts Neues steht,
        ist einer, den man wegwischt - und damit wischt man die eine
        Nachricht mit weg, die etwas Neues sagt. Die Tankstände stehen
        ohnehin auf der Saugerkarte, wenn man hinsieht.

        Das Gedächtnis liegt in der `hub.data` und überlebt darum den
        Neustart. Vorher stand es im Arbeitsspeicher, und wer abends
        über den Update-Knopf baute, bekam jede offene Sauger-Meldung
        gleich noch einmal (dieselbe Lehre wie in `batterie.py`).
        Vergessen wird ein Problem, sobald es verschwindet: Wer den Tank
        leert und ihn nächste Woche wieder vollmacht, bekommt wieder
        eine Nachricht.

        Vergessen wird aber nur, was ein Sauger auch *widerrufen* hat.
        Ein Sauger, der gerade gar nichts sagt - Wolke nicht erreichbar,
        oder der erste Abruf nach einem Neustart ist noch unterwegs -,
        sah bisher aus wie einer, bei dem alles in Ordnung ist. Dann war
        das Gedächtnis leer, und beim nächsten Durchgang ging jedes
        offene Problem als neue Nachricht hinaus. Alle auf einmal, und
        genau so ist es an einem Morgen passiert (sauger_erreichbar).
        """
        jetzt = time.time()
        rows = self.hub.data.get(SAUGER_STORE_KEY)
        aktuell: set[str] = set()
        for entity, schluessel, text in sauger_probleme(entities):
            kennung = f"{entity.id}:{schluessel}"
            aktuell.add(kennung)
            # Schon gemeldet heisst: nichts geändert, also nichts zu sagen.
            if batterie.zeile(rows, kennung) is not None:
                continue
            # Vormerken *bevor* die Meldung rausgeht - wie überall hier:
            # Scheitert der Versand, soll er nicht in der nächsten Minute
            # erneut versucht werden.
            rows = batterie.merke_meldung(rows, kennung, jetzt)
            self.hub.data.set(SAUGER_STORE_KEY, rows)
            await self._notify(
                f"🧹 {entity.label}", text, "vacuum", entity_id=entity.id
            )
        # Behobene Probleme verlassen das Gedächtnis, damit dasselbe
        # Problem beim nächsten Mal wieder sofort meldet - aber nur bei
        # Saugern, die diese Runde geantwortet haben.
        redet = sauger_erreichbar(entities)
        erledigt = [
            kennung
            for row in rows or []
            if isinstance(row, dict)
            for kennung in [str(row.get("entity_id"))]
            if kennung not in aktuell
            and any(kennung.startswith(f"{geraet}:") for geraet in redet)
        ]
        if erledigt:
            self.hub.data.set(SAUGER_STORE_KEY, batterie.vergiss(rows, erledigt))

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

        # Stunde und Schwelle aus den Push-Einstellungen (Punkt 258):
        # sofort melden, dann täglich zur Erinnerungsstunde, bis die
        # Batterie gewechselt ist.
        prefs = batterie.prefs_lesen(self.hub.data.get(batterie.PREFS_KEY))
        for entity in low_batteries(entities, prefs["threshold"]):
            if not batterie.soll_melden(rows, entity.id, jetzt, prefs["hour"]):
                continue
            # Vormerken *bevor* die Meldung rausgeht: Scheitert der
            # Versand, soll er nicht in der nächsten Minute erneut
            # versucht werden (wie in `_einmal`).
            rows = batterie.merke_meldung(rows, entity.id, jetzt)
            self.hub.data.set(batterie.STORE_KEY, rows)
            stand = entity.state.get("battery")
            prozent = (
                f"Noch {int(stand)} %. "
                if isinstance(stand, (int, float)) and not isinstance(stand, bool)
                else ""
            )
            await self._notify(
                f"Batterie schwach: {entity.label}",
                f"{prozent}Danach ist das Gerät still, ohne sich abzumelden. "
                f"Der Hub erinnert täglich um {prefs['hour']} Uhr, bis die "
                "Batterie gewechselt ist.",
                "battery",
                # Damit ein Tipp auf die Nachricht direkt zu den Batterien
                # führt, statt nur die App zu öffnen.
                data={"type": "battery", "entity_id": entity.id, "ziel": "batterien"},
            )

    async def _check_funk(self, entities: list[Any]) -> None:
        """Zigbee-Funkqualität: den Abstieg melden, bevor das Gerät verstummt.

        Jede Zigbee-Meldung trägt eine linkquality mit (Punkt 230 der
        Werkbank) - sie stand im Zustand, und niemand las sie. Dabei ist
        sie die Frühwarnung schlechthin: Ein Gerät, dessen Wert seit
        Wochen fällt, verstummt irgendwann ganz, und dann sucht man den
        Fehler bei der Batterie. Die Rechnung wohnt in funkqualitaet.py;
        hier stehen nur Takt und Gedächtnis - wie bei den Batterien.

        Gemeldet wird je Gerät höchstens einmal; das Gedächtnis liegt in
        der hub.data und überlebt den Neustart. Wieder scharf erst, wenn
        der Wert sich deutlich erholt hat: Wer knapp um die Schwelle
        pendelt, bekäme sonst im Wochentakt dieselbe Nachricht.
        """
        jetzt = time.time()
        if jetzt - self._funk_gesammelt < FUNK_INTERVAL:
            return
        self._funk_gesammelt = jetzt
        funker = [
            entity
            for entity in entities
            if isinstance(entity.state.get("linkquality"), (int, float))
            and not isinstance(entity.state.get("linkquality"), bool)
        ]
        if not funker:
            return

        # Die Wochenmittel fortschreiben - nur schreiben, wenn sich
        # wirklich etwas ändert (dasselbe wie beim Batterie-Verlauf).
        heute = datetime.now().date()
        verlauf = self.hub.data.get(funkqualitaet.STORE_KEY)
        neu_verlauf = verlauf
        for entity in funker:
            wert = float(entity.state.get("linkquality"))
            if 0 <= wert <= 255:
                neu_verlauf = funkqualitaet.aufnehmen(
                    neu_verlauf, entity.id, wert, heute
                )
        if neu_verlauf != verlauf:
            self.hub.data.set(funkqualitaet.STORE_KEY, neu_verlauf)

        rows = self.hub.data.get(funkqualitaet.MELDUNG_KEY)
        for entity in funker:
            zeile = funkqualitaet.gemeldet_zeile(rows, entity.id)
            if zeile is not None:
                if funkqualitaet.erholt(neu_verlauf, entity.id, zeile.get("auf")):
                    rows = funkqualitaet.vergiss(rows, [entity.id])
                    self.hub.data.set(funkqualitaet.MELDUNG_KEY, rows)
                continue
            schwach = funkqualitaet.bewertung(neu_verlauf, entity.id)
            if schwach is None:
                continue
            # Vormerken *bevor* die Meldung rausgeht: Scheitert der
            # Versand, soll er nicht in der nächsten Stunde erneut
            # versucht werden (wie bei den Batterien).
            rows = funkqualitaet.merke_meldung(rows, entity.id, schwach["auf"], jetzt)
            self.hub.data.set(funkqualitaet.MELDUNG_KEY, rows)
            await self._notify(
                f"Funk wird schwach: {entity.label}",
                funkqualitaet.satz(schwach["von"], schwach["auf"])
                + " Bevor das Gerät verstummt: Standort prüfen oder einen "
                "Repeater dazwischenstellen - an der Batterie liegt es "
                "meist nicht.",
                "maintenance",
                entity_id=entity.id,
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
        garantiert niemand mehr denkt. Also endet er hier, und die
        Abläufe sind wieder frei.

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
            "Die Frist ist um - die Abläufe laufen wieder.",
            category="maintenance",
        )

    async def _check_alarmwache(self) -> None:
        """Der Anlage ihren Minutentakt geben.

        Zwei Dinge, auf die keine Zustandsänderung hört, weil beide ein
        Ausbleiben sind: der Sensor, der schweigt, und «alle sind weg».
        Hier statt in einer eigenen Uhr - dieselbe Überlegung wie beim
        Aufräumen der Kamera-Clips weiter oben.
        """
        for name in ("alarm", "brand"):
            anlage = self.hub.integrations.get(name)
            takt = getattr(anlage, "takt", None)
            if takt is not None:
                await takt()

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
                # Selbst gestellte Erinnerungen tragen ihr Ziel mit: Ein
                # Tipp darauf führt zum Gerät, um das es ging.
                data=({"ziel": eintrag["ziel"]} if eintrag.get("ziel") else None),
            )

    async def _notify(
        self,
        title: str,
        body: str,
        category: str = "outage",
        to: str | None = None,
        data: dict[str, Any] | None = None,
        entity_id: str | None = None,
    ) -> None:
        """`to` schickt an eine Person statt an alle - eine Gabe für Lina
        geht die anderen nichts an.

        ``data`` reist mit der Nachricht ans Telefon und sagt der App, wo
        sie beim Antippen hinspringen soll (siehe hooks/useNotificationTap
        in der App).

        Das Ziel setzt sich von selbst: Zu jeder Kategorie gehört ein Ort,
        an dem man etwas tun kann (core/pushziel.py). Wer ein Gerät
        mitgibt, bekommt dessen Raum statt einer Liste - ein offenes
        Fenster schliesst man dort, wo es steht. Ein ausdrücklich
        gesetztes ``ziel`` im ``data`` sticht beides."""
        rule = self.rules.get(category)
        if rule is not None and not rule["enabled"]:
            # Abgeschaltet heisst: keine Push an niemanden. Geprüft wird
            # weiter (der System-Screen zeigt Ausfälle trotzdem), und das
            # Log behält eine Spur, falls jemand die Regel vergessen hat.
            log.info("%s – %s (Regel '%s' abgeschaltet)", title, body, category)
            return
        log.warning("%s – %s", title, body)
        if self._eimer is not None:
            # Mitten in einer Runde: erst sammeln. Verschickt wird am
            # Ende, gebündelt wo es zusammengehört (siehe `check`).
            self._eimer.append(
                {
                    "title": title,
                    "body": body,
                    "category": category,
                    "to": to,
                    "data": data,
                    "entity_id": entity_id,
                }
            )
            return
        await self._senden(title, body, category, to, data, entity_id)

    async def _senden(
        self,
        title: str,
        body: str,
        category: str = "outage",
        to: str | None = None,
        data: dict[str, Any] | None = None,
        entity_id: str | None = None,
    ) -> None:
        """Wirklich verschicken - der Teil von `_notify` ohne die Regeln.

        Getrennt, weil eine Sammelmeldung diesen Teil braucht und den
        anderen nicht: Ob die Regel eingeschaltet ist, wurde für jede
        ihrer Einzelmeldungen schon geprüft.
        """
        ziel = pushziel.ziel_fuer(category, entity_id)
        nutzlast: dict[str, Any] = dict(data or {})
        if entity_id and "entity_id" not in nutzlast:
            nutzlast["entity_id"] = entity_id
        if ziel and "ziel" not in nutzlast:
            nutzlast["ziel"] = ziel
        try:
            tokens = self.hub.push.recipients(
                self.hub.users.users, to or "all", category
            )
            await self.hub.push.send(
                tokens,
                title=title,
                body=body,
                data=nutzlast or None,
                category=category,
            )
        except Exception:
            log.exception("Wächter-Push nicht zustellbar")
