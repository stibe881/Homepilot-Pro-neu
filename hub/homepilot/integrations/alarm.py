"""Alarmanlage: Sensoren überwachen, je nach Modus scharf schalten.

Die Anlage läuft im Hub, nicht in der App – sonst wäre sie unscharf,
sobald jemand sein Telefon weglegt. Die App ist nur Bedienteil.

Drei scharfe Modi, weil sie unterschiedliche Sensoren brauchen:

  - ``nacht``       – man ist zuhause und schläft: Türen und Fenster ja,
                      Bewegungsmelder im Schlafzimmer nein.
  - ``ausser_haus`` – niemand da: alles überwachen.
  - ``urlaub``      – wie ausser Haus, aber ohne Karenz für Bewohner und
                      mit eigener Sensorauswahl (z.B. auch Innenräume).

Je Sensor wird eingestellt, in welchen Modi er wacht. Ein Sensor kann
zusätzlich als *verzögert* markiert werden: Die Haustür soll nicht sofort
Alarm auslösen, sondern die Eingangsverzögerung starten, damit man
unscharf schalten kann. Alles andere löst sofort aus.

Zustände der Anlage:

  ``unscharf`` → ``scharfschaltend`` (Ausgangsverzögerung) → ``scharf``
  ``scharf`` → ``eintritt`` (Eingangsverzögerung) → ``ausgeloest``
  jederzeit zurück auf ``unscharf``

Was *nach* einem Alarm passiert, wird je Modus eingestellt, weil die
Antwort davon abhängt, ob jemand zuhause ist: ausgelöst bleiben bis
jemand hinschaut (``stay``), sich abschalten (``disarm``) oder nach einer
Wartezeit von selbst wieder scharf werden (``rearm``).

Beim Auslösen geht eine Push-Nachricht an alle Bewohner. Zusätzlich
schaltet die Anlage selbst, was unter ``actions`` eingestellt ist – Sirene,
Licht, Storen. Das gehört hierher und nicht in einen Ablauf: Eine
Alarmanlage, die nur eine Nachricht schickt, informiert bloss; erst Lärm
und Licht vertreiben jemanden. Drei Anlässe:

  ``trigger``  beim Auslösen
  ``warning``  beim Beginn der Eingangsverzögerung (kurzes Zeichen)
  ``clear``    beim Unscharfschalten – sonst heult die Sirene weiter
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from datetime import datetime
from typing import Any

from ..core import (
    alarmanwesenheit,
    alarmbericht,
    alarmpflege,
    alarmwache,
    bildarchiv,
    cliparchiv,
    klingelton,
    personenbild,
    say,
    snapshots,
    source,
    streams,
)
from ..core.entity import Entity, EntityKind
from ..core.errors import HomePilotError
from ..core.integration import Integration
from ..core.throttle import Throttle

# Die reine Logik wohnt in alarm_rules.py; die Namen bleiben von hier
# importierbar - Server und Tests beziehen sie seit je aus alarm.
from .alarm_rules import (  # noqa: F401
    ACTION_SLOTS,
    AFTER_ACTIONS,
    ARMED,
    ARMING,
    DEFAULT_AFTER,
    DEFAULT_SETTINGS,
    DISARM,
    DISARMED,
    DURCHBRUCH,
    ENTRY,
    MODE_LABELS,
    MODES,
    PET_DURCHBRUCH,
    REARM,
    SAUGER_NACHLAUF,
    STAY,
    TEST_SIREN_SECONDS,
    TRIGGERED,
    camera_for,
    camera_motion_due,
    durchsage_boxen,
    eskalation_wirkt,
    eskalations_befehle,
    eskalations_ende_befehle,
    guards,
    hash_pin,
    haustier_deckt,
    is_sensor,
    motion_started,
    nearest_camera,
    ohne_pin_erlaubt,
    parse_actions,
    parse_after,
    parse_escalation,
    parse_sensors,
    pin_row,
    pin_users,
    quellen_name,
    sauger_deckt,
    sauger_unterwegs,
    sensor_open,
    sensortest_bestaetigen,
    sensortest_start,
    valid_duress_pin,
    valid_pin,
    zonen,
)

log = logging.getLogger(__name__)

# So lange darf ein Standbild die Alarm-Nachricht aufhalten – siehe die
# gleichnamige Konstante in core/automation.py. Bewusst dieselbe kurze
# Frist: Eine Kamera, die nicht antwortet, ist kein Grund, den Alarm
# später zu melden.
BILD_WARTEZEIT = 4.0

#: Wie oft die Anlage nach ihrer eigenen Pflege sieht (Punkt 481 der
#: Werkbank). Stündlich: Der Selbsttest selbst läuft nur mittags und nur
#: alle neunzig Tage - hier geht es bloss darum, diesen einen Mittag
#: nicht zu verpassen, wenn der Hub dazwischen neu gestartet wurde.
PFLEGE_TAKT = 3600.0

#: So lange wartet der Hub, nachdem das Aufnahmefenster vorbei ist,
#: bevor er die Kamera danach fragt (Punkt 482 der Werkbank).
#:
#: Protect schreibt die Aufnahme nicht in derselben Sekunde exportierbar
#: weg. Zwei Sekunden sind genug für den Normalfall; wer länger wartet,
#: verzögert das Video im Alarm-Blatt, ohne mehr zu bekommen.
CLIP_EXPORT_GEDULD = 2.0


class AlarmIntegration(Integration):
    name = "alarm"

    async def setup(self) -> None:
        self._unsubscribe = None
        self._timer: asyncio.Task | None = None
        self._state = DISARMED
        self._mode: str | None = None
        # Fünf PIN-Fehlversuche in fünf Minuten, dann fünf Minuten Pause.
        self._pin_throttle = Throttle(limit=5, window=300.0, block=300.0)
        # Zeitpunkt, an dem die laufende Verzögerung abläuft.
        self._until: float | None = None
        # Wie lang die laufende Frist insgesamt ist - für den Ring in
        # der App (seconds_total im Zustand).
        self._gesamt: float | None = None
        # Was am Ende dieser Verzögerung passiert – die App beschriftet den
        # Countdown damit, sonst stünde bei jeder Wartezeit dasselbe da.
        self._next: str | None = None
        self._last: dict[str, Any] | None = None
        self._clip_task: asyncio.Task | None = None
        # Die zweite Stufe nach dem Auslösen (Punkt 255 der Werkbank):
        # eigener Timer neben self._timer, weil der nach dem Auslösen
        # schon fürs Wiederscharfschalten gebraucht wird.
        self._eskalation_task: asyncio.Task | None = None
        # Schaltbefehle, die auf ihre Frist warten (siehe _run_actions).
        # Sie gehören abgebrochen, sobald jemand entschärft.
        self._spaeter: list[asyncio.Task] = []
        # Ob die Eskalation in diesem Alarm wirklich gefeuert hat. Nur
        # dann schaltet das Entschärfen die Sirenen aus - sonst bekämen
        # Geräte bei jedem Entschärfen Befehle, obwohl nie etwas lief.
        self._eskaliert = False
        # Je Kamera, wann zuletzt eine Bewegungs-Nachricht rausging. Eine
        # Kamera meldet Bewegung im Sekundentakt, solange sich etwas regt;
        # ohne Abstand wäre das Telefon nach einer Minute unbenutzbar.
        self._motion_seen: dict[str, float] = {}
        # Bis wann Bewegungsmelder wegen des Saugers noch schweigen.
        # None heisst: Er war seit dem Start nicht unterwegs.
        self._sauger_bis: float | None = None
        # Damit der Verlauf einmal je Fahrt einen Eintrag bekommt und
        # nicht bei jeder Bewegung einen: Ein Protokoll, das man nicht
        # mehr liest, ist so gut wie keines.
        self._sauger_notiert = False
        # Je Sensor, seit wann er nicht mehr antwortet - Grundlage der
        # Funkstille-Frist (core/alarmwache.py). Ein Aussetzer ist der
        # Normalfall; erst das Ausbleiben über Minuten ist ein Befund.
        self._stumm_seit: dict[str, float] = {}
        # Was zuletzt gemeldet wurde, damit derselbe blinde Fleck nicht
        # jede Minute erneut meldet. Ein Protokoll, das man nicht mehr
        # liest, ist so gut wie keines - und eine Nachricht, die jede
        # Minute kommt, ist genau das.
        self._blind_gemeldet: set[str] = set()
        # Seit wann ausdrücklich niemand mehr zuhause ist. ``None``
        # heisst: Es ist jemand da (oder der Hub weiss es nicht).
        self._weg_seit: float | None = None
        # Was zuletzt vorgeschlagen wurde - ein Vorschlag, der jede
        # Minute wiederkommt, ist eine Belästigung.
        self._anwesenheit_gemeldet: str | None = None
        # Nur diese Zone scharf, wenn gesetzt (Punkt 398 der Werkbank);
        # None heisst wie bisher das ganze Haus.
        self._zone: str | None = None
        # Der laufende Sensor-Testlauf (Punkt 403), oder None - lebt nur
        # im Speicher: Ein Testlauf, der einen Neustart überlebt, wäre
        # ein Testlauf, an den sich niemand mehr erinnert.
        self._sensor_test: dict[str, Any] | None = None
        # Der Wartungsmodus (Punkt 489 der Werkbank): {until, by, at}
        # oder None. Er überlebt einen Neustart bewusst nicht: Ein
        # Handwerker-Vormittag, der nach dem Update weiterläuft, wäre
        # eine Anlage, die aus ist und behauptet, sie ruhe nur kurz.
        self._wartung: dict[str, Any] | None = None
        # Der Zeitgeber, der die Wartung beendet.
        self._wartung_task: asyncio.Task | None = None
        # Der Takt, der nach dem Sirenen-Selbsttest sieht (Punkt 481).
        self._pflege_task: asyncio.Task | None = None
        # Die Töne der Eingangsverzögerung (Punkt 487).
        self._piep_task: asyncio.Task | None = None

        stored = self.hub.data.get("alarm")
        config = stored[0] if stored else {}
        self._sensors = parse_sensors(config.get("sensors"))
        self._settings = {**DEFAULT_SETTINGS, **(config.get("settings") or {})}
        self._after_trigger = parse_after(config.get("after_trigger"))
        self._actions = parse_actions(config.get("actions"))
        self._escalation = parse_escalation(config.get("escalation"))
        self._history: list[dict[str, Any]] = list(config.get("history") or [])

        self._entity = await self.add_entity(
            "anlage",
            EntityKind.ALARM,
            self.config.get("name", "Alarmanlage"),
            state=self._state_dict(),
            commands=[
                "disarm",
                "arm_night",
                "arm_away",
                "arm_vacation",
                # Damit die Anlage auch dort schaltbar ist, wo nur ein
                # einfacher Ein/Aus-Knopf sitzt (Startseite, Szenen).
                "turn_on",
                "turn_off",
                "toggle",
                # Von Hand auslösen - für den Wandtaster neben der
                # Haustüre und den Knopf in der App (Punkt 334).
                "panic",
            ],
        )
        self._unsubscribe = self.hub.bus.subscribe("state_changed", self._on_state_changed)
        # Nach der eigenen Sirene sehen (Punkt 481 der Werkbank).
        self._pflege_task = asyncio.create_task(self._pflege_loop())

    async def teardown(self) -> None:
        for task in (self._wartung_task, self._pflege_task, self._piep_task):
            if task is not None:
                task.cancel()
        self._wartung_task = None
        self._pflege_task = None
        self._piep_task = None
        if self._clip_task is not None:
            self._clip_task.cancel()
            self._clip_task = None
        self._cancel_escalation()
        self._cancel_spaeter()
        if self._unsubscribe is not None:
            self._unsubscribe()
            self._unsubscribe = None
        self._cancel_timer()
        await super().teardown()

    # ── Zustand ────────────────────────────────────────────────────────────

    def _state_dict(self) -> dict[str, Any]:
        return {
            "state": self._state,
            "mode": self._mode,
            "mode_label": MODE_LABELS.get(self._mode or "", ""),
            # Der Wartungsmodus (Punkt 489 der Werkbank): Was hier steht,
            # zeigt die App als Zeile - eine Anlage, die «unscharf» sagt,
            # ohne zu sagen warum, ist der Zustand, in dem man sie
            # vergisst.
            "wartung": alarmpflege.wartung_satz(self._wartung, time.time()),
            "wartung_bis": (self._wartung or {}).get("until")
            if alarmpflege.wartung_laeuft(self._wartung, time.time())
            else None,
            # Wie lange die laufende Verzögerung noch dauert – die App
            # zeigt daraus den Countdown.
            "seconds_left": (
                max(0, round(self._until - time.time())) if self._until else None
            ),
            # Und wie lang die Frist insgesamt war - daraus zeichnet die
            # App den Ring: Ein Countdown ohne Gesamtlänge ist nur eine
            # Zahl, die kleiner wird.
            "seconds_total": (
                round(self._gesamt) if self._until and self._gesamt else None
            ),
            "next_action": self._next,
            "last_trigger": self._last,
            # Die App zeigt daraus das PIN-Feld vor dem Entschärfen.
            "pin_required": self.pin_required(),
            # Wer eine PIN hat - nicht welche (Punkt 399 der Werkbank).
            "pin_users": pin_users(self.hub.data.get("alarm_pin")),
            # Nur diese Zone ist scharf, oder das ganze Haus (Punkt 398).
            "zone": self._zone,
            # Blinde Flecken, solange scharf ist (core/alarmwache.py).
            # Im Zustand und nicht bloss als Nachricht: Eine weggewischte
            # Meldung ist weg, ein grünes Schild über einem stillen
            # Sensor bleibt - und genau das soll es nicht mehr geben.
            "blind": alarmwache.blindstellen(
                self.guarding(self._mode, self._zone) if self._mode else [],
                time.time(),
                self._stumm_seit,
            ),
        }

    async def _publish(self) -> None:
        await self.hub.registry.update_state(
            self._entity.id, self._state_dict(), available=True
        )

    def _cancel_timer(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    # ── Sensoren ───────────────────────────────────────────────────────────

    def candidates(self) -> list[Entity]:
        """Alle Entitäten, die sich als Sensor eignen."""
        return [entity for entity in self.hub.registry.all() if is_sensor(entity)]

    def guarding(self, mode: str, zone: str | None = None) -> list[Entity]:
        """Alle Sensoren, die in diesem Modus (und, falls gesetzt, dieser
        Zone - Punkt 398 der Werkbank) wachen."""
        return [
            entity
            for entity in self.candidates()
            if guards(self._sensors, entity.id, mode, zone)
        ]

    def open_sensors(self, mode: str, zone: str | None = None) -> list[Entity]:
        """Sensoren, die in diesem Modus wachen und gerade offen sind.

        Grundlage der Bereitschaftsprüfung: Scharfschalten mit offenem
        Fenster wäre ein Alarm in dem Moment, in dem die Verzögerung endet.
        """
        return [entity for entity in self.guarding(mode, zone) if sensor_open(entity)]

    def blind_sensors(self, mode: str, zone: str | None = None) -> dict[str, list[str]]:
        """Sensoren, auf die in diesem Modus kein Verlass ist.

        Ein offenes Fenster sieht man; einen Sensor mit leerer Batterie
        nicht. Beides muss vor dem Scharfschalten auf den Tisch – sonst
        schaltet man scharf und hat einen blinden Fleck, von dem man nichts
        weiss.
        """
        offline: list[str] = []
        battery: list[str] = []
        for entity in self.guarding(mode, zone):
            if not entity.available:
                offline.append(entity.label)
            elif entity.state.get("low_battery") is True:
                battery.append(entity.label)
        return {"offline": offline, "battery": battery}

    # ── Bedienung ──────────────────────────────────────────────────────────

    async def arm(
        self, mode: str, force: bool = False, by: str = "", zone: str | None = None
    ) -> dict[str, Any]:
        """Scharf schalten. Gibt zurück, was daraus geworden ist.

        `zone` (Punkt 398 der Werkbank): Nur die Sensoren dieser einen
        Zone werden geprüft und bewachen - «nur die Garage», ohne dass
        das übrige Haus scharf würde. Ohne Angabe gilt weiter das ganze
        Haus, wie bisher.
        """
        if mode not in MODES:
            raise HomePilotError(f"Unbekannter Alarm-Modus: {mode}")
        zone = zone or None
        open_now = self.open_sensors(mode, zone)
        blind = self.blind_sensors(mode, zone)
        if (open_now or blind["offline"] or blind["battery"]) and not force:
            # Nicht einfach trotzdem scharf schalten: Der Benutzer soll
            # entscheiden, ob er das Fenster schliesst oder überbrückt – und
            # von einem stummen Sensor überhaupt erst erfahren.
            return {
                "ok": False,
                "reason": "offen" if open_now else "blind",
                "open": [entity.label for entity in open_now],
                **blind,
            }

        self._cancel_timer()
        self._mode = mode
        self._zone = zone
        # Ein laufender Sensor-Testlauf ergibt scharf keinen Sinn mehr -
        # er endet mit dem Scharfschalten von selbst.
        self._sensor_test = None
        delay = float(self._settings.get("exit_delay") or 0)
        if delay > 0:
            self._state = ARMING
            self._until = time.time() + delay
            self._gesamt = delay
            self._next = "arm"
            self._timer = asyncio.create_task(self._after(delay, self._finish_arming))
        else:
            self._state = ARMED
            self._until = None
            self._next = None
        await self._publish()
        zone_zusatz = f" ({zone})" if zone else ""
        self._note("armed", f"{MODE_LABELS[mode]} scharf geschaltet{zone_zusatz}", by)
        if self._settings.get("notify_arming"):
            await self._notify(
                "Alarmanlage scharf", f"Modus {MODE_LABELS[mode]}", "alarm_arming"
            )
        return {"ok": True, "state": self._state}

    # ── PIN fürs Entschärfen ───────────────────────────────────────────────
    # Die Anlage lässt sich aus der App entschärfen, sobald das Telefon
    # entsperrt ist. Eine kurze PIN nur für diesen einen Vorgang schützt,
    # falls das Telefon offen herumliegt. Bewusst überall durchgesetzt
    # (auch Szenen und Abläufe): Eine Hintertür, die der PIN ausweicht,
    # wäre keine PIN.

    def _pin_entries(self) -> list[dict[str, Any]]:
        return [
            entry
            for entry in self.hub.data.get("alarm_pin")
            if isinstance(entry, dict) and entry.get("hash")
        ]

    def pin_required(self) -> bool:
        return bool(self._pin_entries())

    async def set_pin(self, user: str, pin: str | None) -> None:
        """Die PIN einer Person setzen oder (mit leerem Wert) entfernen
        (Punkt 399 der Werkbank).

        Geteilt heisst bisher: eine PIN für alle, und der Nachbericht
        konnte nie sagen, wer entschärft hat, nur dass es die Anlage
        selbst war. Jetzt trägt jede Person ihre eigene; wer sie kennt,
        steht danach im Verlauf. Eine leere PIN entfernt auch eine
        allfällige Zwangs-PIN mit - eine Zwangs-PIN ohne die echte
        daneben wäre nur eine zweite PIN, keine Ausnahme mehr.

        Async, weil danach neu veröffentlicht wird - `pin_required` und
        `pin_users` stehen im Zustand und sollen nicht erst beim
        nächsten Scharfschalten nachziehen. Ein echter, hier gefundener
        Fehler: Genau das fehlte bisher, und die App hätte eine gerade
        gesetzte PIN erst nach dem nächsten Auslöser gesehen.
        """
        user = str(user or "").strip()
        if not user:
            raise HomePilotError("Ohne Namen keine PIN.")
        rows = [row for row in self.hub.data.get("alarm_pin") if row.get("user") != user]
        if pin:
            if not pin.isdigit() or not (4 <= len(pin) <= 8):
                raise HomePilotError("Die PIN muss aus 4 bis 8 Ziffern bestehen.")
            salt = secrets.token_hex(8)
            rows.append({"user": user, "salt": salt, "hash": hash_pin(pin, salt)})
        self.hub.data.set("alarm_pin", rows)
        await self._publish()

    async def set_duress_pin(self, user: str, pin: str | None) -> None:
        """Die Zwangs-PIN einer Person setzen oder entfernen (Punkt 400).

        Braucht die echte PIN daneben - eine Zwangs-PIN ohne eine, von
        der sie sich unterscheidet, wäre bloss eine zweite normale PIN.
        Und die beiden müssen sich unterscheiden: Wären sie gleich,
        meldete jedes Entschärfen einen Zwang, den es nicht gab.
        """
        user = str(user or "").strip()
        row = pin_row(self.hub.data.get("alarm_pin"), user)
        if row is None or not row.get("hash"):
            raise HomePilotError("Erst die eigene PIN setzen, dann die Zwangs-PIN.")
        rows = [r for r in self.hub.data.get("alarm_pin") if r.get("user") != user]
        neu = dict(row)
        if pin:
            if not pin.isdigit() or not (4 <= len(pin) <= 8):
                raise HomePilotError("Die PIN muss aus 4 bis 8 Ziffern bestehen.")
            if valid_pin(row, pin):
                raise HomePilotError(
                    "Die Zwangs-PIN muss sich von der eigenen PIN unterscheiden."
                )
            salt = secrets.token_hex(8)
            neu["duress_salt"] = salt
            neu["duress_hash"] = hash_pin(pin, salt)
        else:
            neu.pop("duress_salt", None)
            neu.pop("duress_hash", None)
        rows.append(neu)
        self.hub.data.set("alarm_pin", rows)
        await self._publish()

    def check_pin(
        self, pin: str | None, address: str = "app", require_pin: bool = False
    ) -> tuple[str | None, bool]:
        """Wirft einen lesbaren Fehler, wenn die PIN fehlt oder falsch ist -
        sonst wer sie eingegeben hat, und ob es die Zwangs-PIN war
        (Punkt 399/400 der Werkbank).

        Mit Drossel: Fünf Fehlversuche, dann fünf Minuten Pause - eine
        vierstellige PIN ohne Drossel wäre in Minuten durchprobiert.

        ``require_pin`` gilt für Geräte, die allen gehören - das Wandtablet
        im Flur. Dort steht die App immer offen; ohne PIN entschärft die
        Anlage, wer immer vorbeigeht. Ist keine gesetzt, wird nicht etwa
        durchgewinkt, sondern abgelehnt: Ein Wandtablet ohne PIN ist
        genau der Fall, den die PIN verhindern soll.
        """
        rows = self._pin_entries()
        if not rows:
            if require_pin:
                raise HomePilotError(
                    "An diesem Gerät braucht das Entschärfen eine PIN. Sie "
                    "wird unter Alarm → PIN gesetzt."
                )
            return None, False
        # Ein Ablauf hat keine Tastatur. Vorher scheiterte er bei jeder
        # Heimkehr still am fehlenden Code, und die Anlage blieb scharf -
        # siehe ohne_pin_erlaubt() für die ganze Begründung und den
        # Schalter, mit dem man es wieder streng stellt.
        if ohne_pin_erlaubt(source.current(), self._settings):
            return None, False
        wait = self._pin_throttle.blocked_for(address)
        if wait > 0:
            raise HomePilotError(
                f"Zu viele Fehlversuche - gesperrt für {round(wait)} Sekunden."
            )
        if not pin:
            raise HomePilotError("Zum Entschärfen braucht es die PIN.")
        for row in rows:
            if valid_pin(row, str(pin)):
                self._pin_throttle.succeeded(address)
                return str(row.get("user") or "") or None, False
            if valid_duress_pin(row, str(pin)):
                self._pin_throttle.succeeded(address)
                return str(row.get("user") or "") or None, True
        self._pin_throttle.failed(address)
        raise HomePilotError("Falsche PIN.")

    async def disarm(
        self,
        by: str = "",
        pin: str | None = None,
        address: str = "app",
        require_pin: bool = False,
    ) -> dict[str, Any]:
        matched_user, war_zwang = self.check_pin(pin, address, require_pin)
        if matched_user and (require_pin or not by):
            # Nur wo der Kontoname unsicher ist - am geteilten Gerät
            # (require_pin) oder wenn gar keiner mitkam (Karte, Szene).
            # Am eigenen, bereits angemeldeten Telefon bleibt der eigene
            # Name massgeblich, auch wenn dort zufällig eine fremde PIN
            # getippt wurde (Punkt 399 der Werkbank).
            by = matched_user
        self._cancel_timer()
        # Die Eskalation bricht mit dem Entschärfen ab: Genau dafür ist
        # ihre Frist da - ein Fehlalarm, der rechtzeitig entschärft wird,
        # bleibt für die Nachbarschaft unhörbar.
        self._cancel_escalation()
        # Auch die Befehle, die noch auf ihre Frist warten: Eine Sirene,
        # die eine Minute nach dem Unscharfschalten losgeht, wäre der
        # Fehler, den niemand verzeiht.
        self._cancel_spaeter()
        was = self._state
        self._state = DISARMED
        self._mode = None
        self._zone = None
        self._until = None
        self._next = None
        await self._publish()
        # Der Countdown-Ton hat seinen Zweck erfüllt (Punkt 487) - er
        # soll nicht weiterpiepen, während die Anlage schon aus ist.
        self._piep_stoppen()
        self._note("disarmed", "Unscharf geschaltet", by)
        # Sirene aus, Licht zurück – sonst heult sie weiter, obwohl die
        # Anlage aus ist.
        await self._run_actions("clear")
        # Und die Eskalations-Sirenen ebenfalls, falls sie schon liefen -
        # sie stehen nicht zwingend auch in den clear-Aktionen.
        if self._eskaliert:
            self._eskaliert = False
            await self._run_commands(eskalations_ende_befehle(self._escalation), "eskalation-aus")
        if self._settings.get("notify_arming") and was != DISARMED:
            await self._notify(
                "Alarmanlage unscharf", "Die Anlage ist aus.", "alarm_arming"
            )
        # Der Nachbericht - aber nur, wenn es einen Vorfall gab. Zehn
        # Minuten später steht man in der Küche und weiss nicht mehr,
        # was eigentlich passiert ist; die Zeilen dafür stehen im
        # Verlauf, aber eine Liste beantwortet die Frage nicht
        # (core/alarmbericht.py).
        if was == TRIGGERED and self._settings.get("notify_bericht", True):
            gefunden = alarmbericht.bericht(
                self._history, by or "automatisch", time.time()
            )
            if gefunden is not None:
                titel, text = gefunden
                self._note("bericht", text, "")
                await self._notify(titel, text, "alarm_arming")
        if war_zwang:
            await self._zwang_melden(by)
        return {"ok": True, "state": self._state}

    async def _zwang_melden(self, wer: str) -> None:
        """Eine Zwangs-PIN wurde benutzt - still, ohne dass es an diesem
        Gerät auffällt (Punkt 400 der Werkbank).

        Die Anlage tut nach aussen genau das, was ein gewöhnliches
        Entschärfen auch täte - keine Sirene, keine besondere Meldung an
        diesem Gerät. Nur die anderen erfahren es, und nicht auf dem
        Telefon der Person, deren PIN gerade benutzt wurde: Ein
        Sperrbildschirm mit «Zwangs-PIN verwendet» läge womöglich genau
        dort, wo es niemand sehen darf.
        """
        alle = set(self.hub.push.recipients(self.hub.users.users, "all", "alarm"))
        eigene = set(self.hub.push.recipients(self.hub.users.users, wer, "alarm"))
        ziel = list(alle - eigene)
        if not ziel:
            return
        try:
            await self.hub.push.send(
                ziel,
                "🚨 Zwangs-PIN verwendet",
                f"{wer or 'Jemand'} hat die Anlage mit der Zwangs-PIN entschärft - "
                "bitte unauffällig nachsehen.",
                data={"type": "alarm", "ziel": "bereich:alarm"},
                category="alarm",
            )
        except Exception as err:
            log.warning("Zwangs-PIN-Meldung fehlgeschlagen: %s", err)

    # ── Panikknopf (Punkt 334 der Werkbank) ────────────────────────────────

    async def panic(self, by: str = "") -> dict[str, Any]:
        """Alarm von Hand auslösen - jetzt, aus jedem Zustand.

        Der Fall, für den es das gibt, hat nichts mit einem Einbruch zu
        tun: Jemand steht vor der Türe und geht nicht weg, im Keller
        stimmt etwas nicht, ein Kind ist gestürzt. Was man dann will,
        ist genau das, was die Anlage ohnehin kann - Lärm, Licht, eine
        Nachricht an alle -, bloss ohne Sensor.

        **Ohne PIN**, und das ist Absicht: Wer den Knopf drückt, ist in
        Bedrängnis, und eine Tastatur zwischen Bedrängnis und Sirene
        ist ein Fehler. Die PIN steht vor dem *Abstellen* - dort ist sie
        richtig, denn dort verhindert sie, dass jemand den Alarm
        beendet, der ihn nicht beenden darf.

        **Ohne Rücksicht auf den Modus**: Auch aus «unscharf» heraus.
        Eine Anlage, die erst scharf geschaltet werden muss, bevor man
        um Hilfe rufen kann, hilft nicht.
        """
        self._cancel_timer()
        self._mode = self._mode or "ausser_haus"
        self._state = TRIGGERED
        self._until = None
        self._next = None
        self._last = {
            "entity_id": None,
            "name": "Panikknopf",
            "at": time.time(),
            "mode": self._mode,
            # Damit die App den Vorfall unterscheiden kann: Ein von Hand
            # ausgelöster Alarm braucht kein Kamerabild vom Flur.
            "panik": True,
        }
        await self._publish()
        self._note("triggered", f"Alarm von Hand ausgelöst ({by or 'unbekannt'})", by)
        await self._notify(
            "🚨 Alarm von Hand ausgelöst",
            f"{by or 'Jemand'} hat den Panikknopf gedrückt.",
        )
        await self._run_actions("trigger")
        # Sofort laut, ohne die Frist der Eskalation: Sie ist dafür da,
        # einem Fehlalarm Zeit zum Entschärfen zu geben. Wer den Knopf
        # selbst drückt, meint es.
        self._eskaliert = True
        await self._run_commands(eskalations_befehle(self._escalation), "eskalation")
        return {"ok": True, "state": self._state}

    async def _finish_arming(self) -> None:
        self._state = ARMED
        self._until = None
        self._next = None
        await self._publish()

    async def _after(self, delay: float, action: Any) -> None:
        try:
            await asyncio.sleep(delay)
            await action()
        except asyncio.CancelledError:
            raise

    # ── Überwachung ────────────────────────────────────────────────────────

    async def _on_state_changed(self, _event_type: str, payload: dict[str, Any]) -> None:
        # Der Sensor-Testlauf hört immer mit, auch unscharf - er darf nur
        # anfangen, wenn die Anlage unscharf ist (siehe start_sensor_test),
        # aber während er läuft, geht man ja durchs Haus.
        if self._sensor_test is not None:
            entity_fuer_test = self.hub.registry.get(str(payload.get("entity_id")))
            if entity_fuer_test is not None and sensor_open(entity_fuer_test):
                self._sensor_test = sensortest_bestaetigen(
                    self._sensor_test, entity_fuer_test.id
                )
        if self._state not in (ARMED, ARMING):
            return
        entity_id = payload.get("entity_id")
        entity = self.hub.registry.get(str(entity_id))
        if entity is None or self._mode is None:
            return
        self._sauger_merken(entity)
        if self._sauger_deckt(entity):
            return
        # Die Katze (Punkt 488 der Werkbank). Nach dem Sauger geprüft und
        # nicht davor: Der Sauger-Zweig schreibt einen Verlaufseintrag,
        # und der soll nicht ausfallen, bloss weil derselbe Melder auch
        # auf der Haustier-Liste steht.
        if haustier_deckt(
            entity,
            bool(self._settings.get("pet_mode")),
            self._settings.get("pet_sensors") or (),
            self._settings.get("pet_detections", PET_DURCHBRUCH),
        ):
            return
        await self._camera_motion(entity, payload)
        if not guards(self._sensors, entity.id, self._mode, self._zone):
            return
        if not sensor_open(entity):
            return
        # Während der Ausgangsverzögerung darf man selbst noch durch die Tür.
        if self._state == ARMING:
            return

        entry = self._sensors.get(entity.id) or {}
        delay = float(self._settings.get("entry_delay") or 0)
        if entry.get("delayed") and delay > 0:
            self._cancel_timer()
            self._state = ENTRY
            self._until = time.time() + delay
            self._gesamt = delay
            self._next = "trigger"
            self._timer = asyncio.create_task(
                self._after(delay, lambda: self._trigger(entity))
            )
            await self._publish()
            self._note("entry", f"{entity.label} geöffnet – Eingangsverzögerung läuft", "")
            # Die Verzögerung lief bisher stumm ab. Ein kurzes Zeichen sagt
            # dem Berechtigten «schalt mich ab» – und dem Unberechtigten,
            # dass die Uhr läuft. Beides ist besser als Stille.
            await self._run_actions("warning")
            # Und der Ton, der schneller wird (Punkt 487 der Werkbank):
            # Wie viel Zeit bleibt, stand bisher nur in der App - wer sie
            # zur Tür herein öffnet, hat davon zehn der dreissig
            # Sekunden verloren.
            self._piep_starten(delay)
            if self._settings.get("notify_entry"):
                await self._notify(
                    "Eingangsverzögerung läuft",
                    f"{entity.label} geöffnet – noch {round(delay)} Sekunden zum "
                    "Unscharfschalten.",
                    "alarm_arming",
                )
            return

        await self._trigger(entity)

    def _sauger_merken(self, entity: Entity) -> None:
        """Den Nachlauf stellen, sobald der Sauger stehen bleibt.

        Ein Bewegungsmelder hält sein «on» je nach Modell ein bis fünf
        Minuten. Ohne Nachlauf löst er genau in dem Moment aus, in dem
        der Sauger andockt - der Fehler wäre nur verschoben.
        """
        if entity.kind != EntityKind.VACUUM:
            return
        if sauger_unterwegs([entity]):
            self._sauger_bis = None
            return
        # Er steht: Von jetzt an läuft die Nachlaufzeit.
        self._sauger_bis = time.time() + SAUGER_NACHLAUF
        self._sauger_notiert = False

    def _sauger_deckt(self, entity: Entity) -> bool:
        """Schweigt dieser Sensor gerade wegen des Saugers?

        Der erste Fall je Fahrt kommt in den Verlauf. Stillschweigend
        wäre es die falsche Art von Rücksicht: Wer nachliest, warum die
        Anlage nicht angeschlagen hat, soll es dort finden.
        """
        unterwegs = sauger_unterwegs(self.hub.registry.all())
        if not sauger_deckt(
            entity,
            unterwegs,
            self._sauger_bis,
            time.time(),
            bool(self._settings.get("ignore_vacuum", True)),
            self._settings.get("vacuum_detections", DURCHBRUCH),
        ):
            return False
        if not sensor_open(entity):
            # Nur die Meldung zählt - ein Melder, der auf «aus» geht,
            # hätte ohnehin nichts ausgelöst.
            return True
        if not self._sauger_notiert:
            self._sauger_notiert = True
            self._note(
                "vacuum",
                f"{entity.label} meldet Bewegung - der Sauger fährt, "
                "kein Alarm (Fenster und Türen bleiben scharf)",
                "",
            )
        return True

    async def _camera_motion(self, entity: Entity, payload: dict[str, Any]) -> None:
        """Kamera sieht Bewegung, während scharf ist: Bild aufs Telefon.

        Bisher gab es diese Nachricht nur, wenn die Kamera als Alarmsensor
        zugeordnet war – und dann gleich mit Sirene. Wer die Anlage nicht
        von einer vorbeilaufenden Katze auslösen lassen will, ordnet die
        Kamera aber gerade *nicht* zu und erfuhr damit gar nichts. Jetzt
        kommt das Bild, ohne dass etwas losgeht.

        Die Nachricht trägt die Kamera mit: Ein Tipp darauf öffnet sie in
        der App, statt dass man nachts erst durch die Räume sucht.
        """
        if entity.kind != EntityKind.CAMERA or self._state != ARMED:
            return
        if not self._settings.get("notify_camera_motion", True):
            return
        if not motion_started(payload.get("old_state"), payload.get("new_state")):
            return
        # Löst diese Kamera ohnehin den Alarm aus, kommt gleich die
        # Alarm-Nachricht – zwei Meldungen zum selben Ereignis sind eine
        # zu viel, und die mit der Sirene ist die wichtigere.
        if self._mode and guards(self._sensors, entity.id, self._mode):
            return
        jetzt = time.time()
        if not camera_motion_due(self._motion_seen, entity.id, jetzt):
            return
        self._motion_seen[entity.id] = jetzt
        self._note("motion", f"Bewegung vor {entity.label}", "")
        self._start_bild(entity.id, "motion")
        await self._notify(
            "Bewegung vor der Kamera",
            f"{entity.label} sieht Bewegung – die Anlage ist scharf.",
            category="camera_motion",
            data={
                "type": "camera_motion",
                "entity_id": entity.id,
                "camera": entity.id,
            },
            image=await self._snapshot_url(entity.id),
        )

    async def _trigger(self, entity: Entity) -> None:
        self._cancel_timer()
        mode = self._mode
        self._state = TRIGGERED
        self._until = None
        self._next = None
        self._last = {
            "entity_id": entity.id,
            "name": entity.label,
            "at": time.time(),
            "mode": mode,
        }
        await self._publish()
        self._note("triggered", f"Alarm ausgelöst: {entity.label}", "", entity_id=entity.id)

        if self._settings.get("notify_trigger"):
            # Die Kamera im selben Raum kommt zweimal mit: als Kennung,
            # damit die App sie beim Antippen mit dem Token des Benutzers
            # öffnet, und als Bild in der Nachricht selbst – sofern eine von
            # aussen erreichbare Adresse konfiguriert ist. Was dieses Bild
            # kostet, steht in core/snapshots.py.
            camera = camera_for(entity, self.hub.registry.all())
            await self._notify(
                "🚨 Alarm ausgelöst",
                f"{entity.label} – Modus {MODE_LABELS.get(mode or '', '?')}",
                data={"entity_id": entity.id, "camera": camera},
                image=await self._snapshot_url(camera),
            )

        # Erst melden, dann schalten: Eine Sirene, die hängt, darf die
        # Nachricht nicht aufhalten.
        await self._run_actions("trigger")

        # Die zweite Stufe stellen: Nach der Frist wird es laut und hell,
        # wenn bis dahin niemand entschärft hat (Punkt 255 der Werkbank).
        self._start_escalation()

        # Der Mitschnitt läuft nebenher. In der Nachricht selbst kann er
        # nicht stehen – ein Banner zeigt nur Standbilder, und acht Sekunden
        # auf ein Video zu warten wäre bei einem Alarm die falsche Reihen-
        # folge. Er landet stattdessen beim letzten Auslösen, wo die App ihn
        # zeigt, sobald er da ist.
        self._start_clip(camera_for(entity, self.hub.registry.all()))
        # Und das Standbild dazu - der Mitschnitt braucht ffmpeg und
        # RTSP, das Bild nur die Kamera. Meist gibt es beides.
        self._start_bild(camera_for(entity, self.hub.registry.all()), "alarm")

        await self._apply_after(mode)

    async def _apply_after(self, mode: str | None) -> None:
        """Das Nachverhalten des Modus ausführen.

        Erst melden, dann handeln – in dieser Reihenfolge, damit die
        Push-Nachricht auch dann draussen ist, wenn die Anlage sich gleich
        darauf selbst abschaltet.
        """
        plan = self._after_trigger.get(mode or "", DEFAULT_AFTER)
        action = plan.get("action")
        if action == DISARM:
            await self.disarm(by="automatisch")
            return
        if action != REARM:
            # STAY: ausgelöst bleiben, bis jemand von Hand unscharf schaltet.
            return
        seconds = float(plan.get("after") or DEFAULT_AFTER["after"])
        self._until = time.time() + seconds
        self._gesamt = seconds
        self._next = "rearm"
        self._timer = asyncio.create_task(self._after(seconds, self._rearm))
        await self._publish()

    async def _rearm(self) -> None:
        """Nach dem Alarm wieder scharf, im selben Modus.

        Ohne Ausgangsverzögerung und ohne Bereitschaftsprüfung: Es geht ja
        niemand hinaus, und ein Einbruch lässt die Tür offen stehen – würde
        die Anlage sich deswegen weigern, bliebe das Haus ungeschützt. Was
        noch offen ist, steht stattdessen im Verlauf.
        """
        mode = self._mode
        if mode is None:
            return
        self._state = ARMED
        self._until = None
        self._next = None
        await self._publish()
        still_open = [entity.label for entity in self.open_sensors(mode, self._zone)]
        text = f"Wieder scharf geschaltet ({MODE_LABELS[mode]})"
        if still_open:
            text += " – noch offen: " + ", ".join(still_open)
        self._note("armed", text, "automatisch")
        if self._settings.get("notify_arming"):
            await self._notify("Alarmanlage wieder scharf", text, "alarm_arming")

    # ── Eskalation (Punkt 255 der Werkbank) ────────────────────────────────

    def _cancel_escalation(self) -> None:
        if self._eskalation_task is not None:
            self._eskalation_task.cancel()
            self._eskalation_task = None

    def _start_escalation(self) -> None:
        """Die zweite Stufe stellen - nur, wenn sie etwas tun würde.

        Ohne Konfiguration läuft hier gar nichts an: Das ist die
        Abwärtskompatibilität - eine Anlage ohne Eskalations-Eintrag
        verhält sich exakt wie vorher.
        """
        if not eskalation_wirkt(self._escalation):
            return
        self._cancel_escalation()
        delay = float(self._escalation.get("after") or 0)
        self._eskalation_task = asyncio.create_task(self._after(delay, self._escalate))

    async def _escalate(self) -> None:
        """Sirene, Rampenlicht, Durchsage - nachdem die Frist verstrichen ist."""
        # In der Zwischenzeit entschärft oder wieder scharf geworden?
        # Dann ist die Lage eine andere, und die Sirene bliebe falsch.
        if self._state != TRIGGERED:
            return
        self._eskaliert = True
        befehle = eskalations_befehle(self._escalation, self.hub.registry.all())
        await self._run_commands(befehle, "eskalation")
        self._note(
            "escalated",
            "Eskalation: Niemand hat entschärft - Sirene und Licht sind an",
            "",
        )
        text = str(self._escalation.get("announce") or "")
        if text:
            # Wohin sie geht, entscheidet die Einstellung: alle Boxen, eine
            # feste Auswahl oder der Raum, in dem der Melder ausgelöst hat.
            # Für den Raum braucht es den Melder von vorhin - er steht in
            # self._last, und seine Entität kennt das Zimmer.
            ausloeser = (self._last or {}).get("entity_id")
            quelle = self.hub.registry.get(str(ausloeser)) if ausloeser else None
            boxen = durchsage_boxen(
                self._escalation,
                self.hub.registry.all(),
                getattr(quelle, "room", None),
            )
            # Derselbe Weg wie die broadcast-Aktion der Abläufe. Abgesichert,
            # weil die Durchsage Netz oder eine bekannte Hub-Adresse braucht -
            # und eine stumme Box die Sirene nicht aufhalten darf.
            try:
                await say.speak(
                    self.hub,
                    text,
                    speakers=boxen,
                    volume=self._escalation.get("volume"),
                )
            except Exception as err:
                log.warning("Eskalations-Durchsage fehlgeschlagen: %s", err)
        await self._publish()

    async def _run_commands(
        self, befehle: list[dict[str, Any]], anlass: str
    ) -> None:
        """Schaltbefehle einzeln abgesichert ausführen.

        Wie bei den Aktions-Plätzen: Eine Sirene, die nicht antwortet,
        darf nicht verhindern, dass danach die Lichter angehen.
        """
        for befehl in befehle:
            try:
                await self.hub.integrations.dispatch_command(
                    befehl["entity_id"], befehl["command"], befehl.get("data") or {}
                )
            except Exception as err:
                log.warning(
                    "Alarm-Befehl (%s, %s %s) fehlgeschlagen: %s",
                    anlass,
                    befehl["entity_id"],
                    befehl["command"],
                    err,
                )

    def _start_bild(self, camera: str | None, anlass: str) -> None:
        """Ein Standbild vom Moment ins Bild-Archiv - fürs Ereignisblatt.

        Das Push-Bild lebt zehn Minuten im Speicher (core/snapshots.py);
        wer am Morgen nachsehen will, was nachts los war, fände nichts.
        Wie der Clip eine Zugabe: Jeder Fehler endet still, ein Alarm
        darf an keiner Kamera scheitern.
        """
        if not camera:
            return
        asyncio.create_task(self._bild_archivieren(camera, anlass))

    async def _bild_archivieren(self, camera: str, anlass: str) -> None:
        try:
            entity = self.hub.registry.get(camera)
            integration = (
                self.hub.integrations.get(entity.integration) if entity else None
            )
            if entity is None or integration is None:
                return
            daten = await integration.snapshot(entity)
            if not daten:
                return
            jetzt = time.time()
            kennung = cliparchiv.neue_kennung(jetzt)
            meta = cliparchiv.eintrag(
                kennung,
                entity.id,
                anlass,
                jetzt,
                name=entity.label,
                room=entity.room,
                integration=entity.integration,
                groesse=len(daten),
            )
            bildarchiv.ablegen(
                bildarchiv.ordner(self.hub.config.data_file), daten, meta
            )
        except Exception as err:
            self.log.debug("Bild-Archiv: %s liefert nichts (%s)", camera, err)

    def _start_clip(self, camera: str | None) -> None:
        seconds = int(self._settings.get("clip_seconds") or 0)
        if not camera or seconds <= 0:
            return
        # Einzeln verwaltet statt über start_task(): Dessen Liste wird nie
        # geleert, und bei jedem Alarm käme ein Eintrag dazu.
        if self._clip_task and not self._clip_task.done():
            self._clip_task.cancel()
        self._clip_task = asyncio.create_task(
            self._record_clip(camera, seconds, time.time())
        )

    async def _record_clip(
        self, camera: str, seconds: int, ausgeloest: float | None = None
    ) -> None:
        """Ein paar Sekunden mitschneiden und beim letzten Auslösen ablegen.

        Zuerst wird die Kamera nach ihrer eigenen Aufnahme gefragt - und
        zwar ab ein paar Sekunden *vor* dem Auslösen (Punkt 482 der
        Werkbank). Bisher begann die Aufnahme beim Auslösen, also erst,
        wenn schon jemand drin ist; die interessanten Sekunden liegen
        davor, und Protect hält sie ohnehin vor. Wer hereinkam, sieht man
        nur mit Vorlauf; wer schon da ist, auch ohne.

        Die Kamera braucht einen Moment, bis die Aufnahme exportierbar
        ist - deshalb wird erst das Ende des Fensters abgewartet und dann
        gefragt. Liefert sie nichts (keine Aufnahme-Funktion, kein
        Protect), bleibt der Weg von vorher: live mitschneiden, ohne
        Vorlauf.

        Alles hier ist Zugabe: Fehlt ffmpeg oder liefert die Kamera kein
        RTSP, bleibt es beim Standbild. Ein Alarm darf daran nicht
        scheitern.
        """
        try:
            entity = self.hub.registry.get(camera)
            integration = self.hub.integrations.get(entity.integration) if entity else None
            if integration is None or entity is None:
                return
            data = await self._clip_mit_vorlauf(
                integration, entity, seconds, ausgeloest
            )
            if data is None:
                source = await integration.stream_url(entity)
                if not source:
                    return
                data = await streams.record_clip(source, seconds)
            if not data or self._last is None:
                return
            # Zusätzlich ins Archiv (Punkt 256 der Werkbank): Der
            # Schnappschuss-Speicher vergisst nach zehn Minuten - genau
            # dann, wenn man den Clip jemandem zeigen will, wäre er weg.
            self._archive_clip(camera, data)
            public_url = (self.hub.config.push or {}).get("public_url")
            token = self.hub.snapshots.put(data)
            self._last["clip"] = snapshots.image_url(public_url, token) or (
                f"/api/push/image/{token}"
            )
            await self._publish()
        except asyncio.CancelledError:
            raise
        except Exception as err:
            log.warning("Mitschnitt zum Alarm fehlgeschlagen: %s", err)

    async def _clip_mit_vorlauf(
        self,
        integration: Any,
        entity: Entity,
        seconds: int,
        ausgeloest: float | None,
    ) -> bytes | None:
        """Die Aufnahme der Kamera samt Vorlauf holen - oder None.

        ``None`` heisst «geht hier nicht» und nicht «ging schief»: Der
        Aufrufer nimmt dann den alten Weg. Eine Ausnahme wäre hier die
        falsche Antwort, denn beides ist ein gewöhnlicher Fall - eine
        Ring-Kamera kennt keinen Export, eine Protect-Kamera schon.
        """
        vorlauf = int(self._settings.get("clip_vorlauf") or 0)
        getter = getattr(integration, "clip", None)
        if vorlauf <= 0 or not callable(getter) or ausgeloest is None:
            return None
        start = int(ausgeloest - vorlauf)
        ende = int(ausgeloest + seconds)
        # Erst warten, bis das Fenster wirklich vorbei ist: Eine Kamera
        # kann nicht exportieren, was noch nicht aufgenommen ist.
        await asyncio.sleep(max(0.0, ende - time.time()) + CLIP_EXPORT_GEDULD)
        try:
            return await getter(entity, start, ende)
        except Exception as err:
            log.info("Kamera-Aufnahme mit Vorlauf nicht abrufbar (%s) - live", err)
            return None

    def _archive_clip(self, camera: str, data: bytes) -> None:
        """Den Alarm-Mitschnitt dauerhaft ablegen - still bei jedem Fehler.

        Raum und Integration der Kamera reisen in die Metadaten, damit
        die Sichtbarkeitsprüfung der Clip-Routen auch dann noch
        funktioniert, wenn es die Kamera längst nicht mehr gibt.
        """
        folder = cliparchiv.ordner(self.hub.config.data_file)
        if folder is None:
            return
        entity = self.hub.registry.get(camera)
        meta = cliparchiv.eintrag(
            kennung=cliparchiv.neue_kennung(),
            camera=camera,
            anlass="alarm",
            jetzt=time.time(),
            name=entity.label if entity is not None else None,
            room=entity.room if entity is not None else None,
            integration=entity.integration if entity is not None else None,
            groesse=len(data),
        )
        cliparchiv.ablegen(folder, data, meta)

    async def test_run(self, by: str = "") -> dict[str, Any]:
        """Probealarm: einmal durchspielen, was ein Einbruch auslösen würde.

        Ob die Sirene angeht, die Push-Nachricht ankommt und die Lichter
        schalten, erfuhr man sonst beim ersten echten Einbruch – der
        denkbar schlechteste Moment, um ein leeres Aktionsfeld zu
        entdecken. Hier laufen die trigger-Aktionen für ein paar
        Sekunden, dann räumen die clear-Aktionen auf. Der Zustand der
        Anlage bleibt unangetastet: Ein Test schaltet nicht scharf und
        nicht unscharf.
        """
        if self._state != DISARMED:
            raise HomePilotError(
                "Probealarm nur bei unscharfer Anlage – ein Test, während "
                "sie wacht, wäre von einem Einbruch nicht zu unterscheiden."
            )
        await self._notify(
            "Probealarm",
            "Das ist ein Test. Sirene und Lichter gehen gleich für ein "
            "paar Sekunden an.",
            "alarm_test",
        )
        await self._run_actions("trigger")
        # Lang genug, um die Sirene zu hören; kurz genug, dass niemand
        # die Nachbarn beruhigen muss.
        await asyncio.sleep(TEST_SIREN_SECONDS)
        await self._run_actions("clear")
        self._note("test", "Probealarm ausgeführt", by)
        return {"ok": True, "hinweis": "Probealarm durchgespielt – Sirene, "
                "Lichter und Nachricht liefen einmal an und wieder aus."}

    # ── Der hörbare Countdown (Punkt 487 der Werkbank) ──────────────────────

    def _piep_starten(self, sekunden: float) -> None:
        """Den Ton der Eingangsverzögerung anstossen - nebenher.

        Nebenher und nicht im Auslöseweg: Eine Box, die nicht antwortet,
        darf die Verzögerung nicht aufhalten - sonst entscheidet der
        Lautsprecher darüber, wann die Sirene losgeht.

        Ohne gewählte Box bleibt es still, wie beim Klingelton: Ein
        Countdown, der nach der Auslieferung ungefragt auf jeder Box im
        Haus loslegt, wäre die Art Überraschung, nach der man ihn
        abstellt und nie wieder einschaltet.
        """
        boxen = [str(box) for box in self._settings.get("entry_beep_speakers") or []]
        if not boxen or sekunden <= 0:
            return
        self._piep_stoppen()
        self._piep_task = asyncio.create_task(self._piep_spielen(boxen, sekunden))

    def _piep_stoppen(self) -> None:
        if self._piep_task is not None:
            self._piep_task.cancel()
            self._piep_task = None

    async def _piep_spielen(self, boxen: list[str], sekunden: float) -> None:
        try:
            noten = klingelton.countdown_noten(sekunden)
            if not noten:
                return
            address = say.base_url(self.hub)
            if not address:
                # Ohne öffentliche Adresse kommt keine Box an den Ton -
                # derselbe Fall wie beim Klingelton (core/ton.py).
                return
            audio = klingelton.wav_bytes(klingelton.noten_zu_samples(noten))
            await say.play_audio(
                self.hub,
                audio,
                address,
                speakers=boxen,
                volume=klingelton.LAUTSTAERKE,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            log.debug("Countdown-Ton nicht abspielbar", exc_info=True)

    # ── Sirenen-Selbsttest (Punkt 481 der Werkbank) ─────────────────────────
    #
    # Es gibt den Probealarm (von Hand) und den Sensor-Testlauf darunter.
    # Was fehlte, ist der Lauf, den niemand anstossen muss: Eine Sirene,
    # die seit dem Einbau nicht mehr geheult hat, heult vielleicht auch
    # beim Einbruch nicht - und das merkt man dann.

    async def _pflege_loop(self) -> None:
        while True:
            await asyncio.sleep(PFLEGE_TAKT)
            try:
                await self.sirenentest_pruefen()
            except asyncio.CancelledError:
                raise
            except Exception:
                # Ein fehlgeschlagener Selbsttest darf die Anlage nicht
                # mitreissen - sie ist das Wichtigere.
                log.debug("Sirenen-Selbsttest fehlgeschlagen", exc_info=True)

    async def sirenentest_pruefen(self) -> bool:
        """Die Sirene prüfen, wenn sie dran ist (Punkt 481).

        Nur unscharf: Ein Ton, während die Anlage wacht, wäre von einem
        Alarm nicht zu unterscheiden - dieselbe Überlegung wie beim
        Probealarm. Ist sie gerade scharf, wartet der Test bis zum
        nächsten Mittag; ein Quartal ist grosszügig genug dafür.
        """
        if not self._settings.get("siren_selftest", True):
            return False
        if self._state != DISARMED:
            return False
        if not alarmpflege.sirenentest_faellig(
            self._settings.get("siren_tested_at"), datetime.now()
        ):
            return False
        await self._notify(
            "Sirenen-Prüfung",
            "Die Anlage prüft gleich für drei Sekunden ihre Sirene. "
            "Das ist kein Alarm.",
            "alarm_test",
        )
        await self._run_actions("trigger")
        await asyncio.sleep(TEST_SIREN_SECONDS)
        await self._run_actions("clear")
        self._settings["siren_tested_at"] = time.time()
        self._note("test", "Sirene selbst geprüft", "automatisch")
        self._save()
        return True

    # ── Wartungsmodus (Punkt 489 der Werkbank) ──────────────────────────────

    async def wartung_starten(self, stunden: Any, by: str = "") -> dict[str, Any]:
        """Fensterputzen, Handwerker, Umzugstag.

        Alles steht offen, und die einzige Antwort darauf war «ganz
        unscharf» - und danach blieb sie es, weil niemand daran denkt.
        Hier schaltet die Anlage von selbst zurück, und zwar in den
        Modus, in dem sie vorher stand: Wer nachts um elf Wartung
        anmeldet, will danach wieder den Nachtmodus und nicht «aus».
        """
        vorher = self._mode if self._state in (ARMED, ARMING) else None
        self._wartung = alarmpflege.wartung_setzen(stunden, time.time(), by)
        self._wartung["mode"] = vorher
        if self._state != DISARMED:
            await self.disarm(by=by or "Wartung")
        if self._wartung_task is not None:
            self._wartung_task.cancel()
        rest = float(self._wartung["until"]) - time.time()
        self._wartung_task = asyncio.create_task(self._wartung_beenden_nach(rest))
        self._note(
            "wartung",
            alarmpflege.wartung_satz(self._wartung, time.time()) or "Wartung",
            by,
        )
        await self._publish()
        return {"ok": True, "wartung": self._wartung}

    async def wartung_beenden(self, by: str = "") -> dict[str, Any]:
        """Die Wartung von Hand beenden - und wieder scharf schalten.

        Ohne das Scharfschalten wäre «beenden» nur ein Löschen einer
        Zeile: Die Anlage stünde unscharf da, und genau das ist der
        Zustand, gegen den es den Modus gibt.
        """
        vorher = (self._wartung or {}).get("mode")
        self._wartung = None
        if self._wartung_task is not None:
            self._wartung_task.cancel()
            self._wartung_task = None
        self._note("wartung", "Wartung beendet", by or "automatisch")
        if vorher in MODES and self._state == DISARMED:
            # Mit force: Nach einer Wartung steht oft noch ein Fenster
            # offen, und eine Rückfrage, die niemand liest, hiesse: Die
            # Anlage bleibt aus. Der Verlauf hält fest, was dabei nicht
            # wachte - das ist die ehrliche Hälfte davon.
            offen = [entity.label for entity in self.open_sensors(vorher)]
            ergebnis = await self.arm(vorher, force=True, by=by or "automatisch")
            if offen:
                self._note(
                    "wartung",
                    "Nach der Wartung scharf, ohne: " + ", ".join(offen),
                    by or "automatisch",
                )
            await self._publish()
            return {"ok": True, "wartung": None, **ergebnis}
        await self._publish()
        return {"ok": True, "wartung": None}

    async def _wartung_beenden_nach(self, sekunden: float) -> None:
        try:
            await asyncio.sleep(max(0.0, sekunden))
        except asyncio.CancelledError:
            return
        await self.wartung_beenden()

    # ── Einen Alarm einordnen (Punkt 490 der Werkbank) ──────────────────────

    def offene_einordnung(self) -> dict[str, Any] | None:
        """Der Alarm, für den die Frage «war das echt?» noch offensteht."""
        return alarmpflege.offener_alarm(self._history)

    def einordnen(self, urteil: str, by: str = "") -> dict[str, Any]:
        """Den letzten Alarm einordnen.

        Die Fehlalarm-Statistik riet ihn sich bisher aus: unter sechzig
        Sekunden entschärft, mindestens dreimal. Ein echter Einbruch, den
        jemand schnell entschärft, zählt damit als Fehlalarm; ein
        Fehlalarm, den zehn Minuten lang niemand bemerkt, als echt. Die
        eine Frage ersetzt die ganze Schätzung.
        """
        gewaehlt = alarmpflege.urteil_lesen(urteil)
        if gewaehlt is None:
            raise HomePilotError(f"Unbekannte Einordnung: {urteil}")
        offen = self.offene_einordnung()
        if offen is None:
            raise HomePilotError("Es steht kein Alarm zur Einordnung offen.")
        eintrag = {
            "kind": "urteil",
            "text": alarmpflege.URTEIL_TEXT[gewaehlt],
            "by": by,
            "at": time.time(),
            "urteil": gewaehlt,
            "entity_id": offen.get("entity_id"),
        }
        self._history.insert(0, eintrag)
        grenze = int(self._settings.get("history_limit") or 50)
        del self._history[grenze:]
        self._save()
        return {"ok": True, "urteil": gewaehlt}

    # ── Sensor-Testlauf (Punkt 403 der Werkbank) ────────────────────────────
    #
    # Der Probealarm prüft Sirene, Licht und Nachricht - nicht, ob jeder
    # einzelne Melder wirklich meldet. Hier geht man einmal durchs Haus
    # und öffnet jeden zugeordneten Sensor; wer antwortet, wandert von
    # «steht noch aus» zu «gemeldet» (siehe _on_state_changed).

    def start_sensor_test(self, mode: str) -> dict[str, Any]:
        if mode not in MODES:
            raise HomePilotError(f"Unbekannter Alarm-Modus: {mode}")
        if self._state != DISARMED:
            raise HomePilotError(
                "Der Sensor-Testlauf geht nur bei unscharfer Anlage - "
                "sonst löst das Öffnen der Fenster den Alarm selbst aus."
            )
        self._sensor_test = sensortest_start(self._sensors, mode, time.time())
        return self.sensor_test_state()

    def stop_sensor_test(self) -> dict[str, Any]:
        self._sensor_test = None
        return self.sensor_test_state()

    def sensor_test_state(self) -> dict[str, Any]:
        """Der laufende Testlauf, mit Namen statt blossen Kennungen -
        oder ``{"running": False}``, wenn keiner läuft."""
        if self._sensor_test is None:
            return {"running": False}

        def zeilen(ids: list[str]) -> list[dict[str, Any]]:
            zeilen_ = []
            for entity_id in ids:
                entity = self.hub.registry.get(entity_id)
                zeilen_.append({
                    "entity_id": entity_id,
                    "name": entity.label if entity is not None else entity_id,
                    "room": entity.room if entity is not None else None,
                })
            return zeilen_

        return {
            "running": True,
            "mode": self._sensor_test["mode"],
            "pending": zeilen(self._sensor_test["pending"]),
            "confirmed": zeilen(self._sensor_test["confirmed"]),
        }

    async def _run_actions(self, slot: str) -> None:
        """Die eingestellten Schaltbefehle für diesen Anlass ausführen.

        Jeder einzeln abgesichert: Eine Sirene, die nicht antwortet, darf
        nicht verhindern, dass danach die Lichter angehen – und schon gar
        nicht, dass die Anlage ihren Zustand sauber zu Ende bringt.

        Wer eine Frist trägt, wartet: «Licht sofort, Sirene nach dreissig
        Sekunden, Storen hoch nach zwei Minuten» ist damit eine
        gewöhnliche Einstellung. Die Wartenden laufen als eigene
        Aufgaben, damit die übrigen nicht hinter ihnen anstehen - und sie
        werden abgebrochen, sobald jemand entschärft: Eine Sirene, die
        eine Minute nach dem Unscharfschalten losgeht, wäre der Fehler,
        den niemand verzeiht.
        """
        for action in self._actions.get(slot) or []:
            frist = float(action.get("after") or 0)
            if frist > 0:
                self._spaeter.append(
                    asyncio.create_task(self._nach_frist(frist, slot, action))
                )
                continue
            await self._befehl(slot, action)

    async def _befehl(self, slot: str, action: dict[str, Any]) -> None:
        """Ein einzelner Schaltbefehl, abgesichert."""
        try:
            await self.hub.integrations.dispatch_command(
                action["entity_id"], action["command"], action.get("data") or {}
            )
        except Exception as err:
            log.warning(
                "Alarm-Aktion %s (%s %s) fehlgeschlagen: %s",
                slot,
                action["entity_id"],
                action["command"],
                err,
            )

    async def _nach_frist(self, frist: float, slot: str, action: dict[str, Any]) -> None:
        """Einen Befehl nach seiner Frist ausführen - wenn er noch gilt.

        Geprüft wird kurz vor dem Schalten noch einmal: Zwischen dem
        Auslösen und dem Ablauf der Frist kann jemand entschärft haben,
        und dann ist die Lage eine andere. Für «Beim Unscharfschalten»
        gilt das Gegenteil - der läuft, weil unscharf ist.
        """
        try:
            await asyncio.sleep(frist)
        except asyncio.CancelledError:
            return
        if slot in ("trigger", "warning") and self._state == DISARMED:
            return
        await self._befehl(slot, action)

    def _cancel_spaeter(self) -> None:
        """Alle wartenden Befehle abbrechen."""
        for aufgabe in self._spaeter:
            aufgabe.cancel()
        self._spaeter.clear()

    async def _snapshot_url(self, camera: str | None) -> str | None:
        """Ein Standbild der Kamera für die Nachricht selbst.

        Wird jetzt aufgenommen und nicht später abgerufen: Das Bild soll den
        Moment zeigen, in dem der Alarm losging, nicht den Moment, in dem
        jemand das Telefon aus der Tasche zieht.

        Bei einer Kamera mit Personenerkennung ist «der Moment, in dem der
        Alarm losging» allerdings zu früh: Wer den Melder im Flur auslöst,
        ist noch ein paar Schritte von der Kamera entfernt. Das Bild wird
        dann nachgereicht, sobald jemand wirklich im Bild steht – die
        Nachricht geht trotzdem sofort raus. Siehe ``core/personenbild.py``.

        Jeder Fehlschlag endet still ohne Bild – ein Alarm darf nicht
        daran scheitern, dass eine Kamera gerade nicht antwortet.
        """
        return await personenbild.bild_adresse(
            self.hub, camera, BILD_WARTEZEIT, "die Alarm-Nachricht"
        )

    async def _notify(
        self,
        title: str,
        body: str,
        category: str = "alarm",
        data: dict[str, Any] | None = None,
        image: str | None = None,
    ) -> None:
        tokens = self.hub.push.recipients(self.hub.users.users, "all", category)
        await self.hub.push.send(
            tokens,
            title=title,
            body=body,
            data={"type": "alarm", "ziel": "bereich:alarm", **(data or {})},
            image=image,
            category=category,
        )

    # ── Takt (vom Wächter, einmal je Minute) ───────────────────────────────

    async def takt(self) -> None:
        """Was regelmässig zu prüfen ist, aber auf kein Ereignis hört.

        Beides ist ein Ausbleiben, kein Eintreten - und deshalb hört
        keine Zustandsänderung darauf: Ein Sensor, der schweigt, schickt
        nichts, und «alle sind weg» ist die Abwesenheit von Meldungen.
        Gerufen wird das vom Wächter, der ohnehin jede Minute läuft; eine
        zweite Uhr müsste jemand warten.
        """
        jetzt = time.time()
        try:
            await self._wache(jetzt)
            await self._anwesenheit(jetzt)
        except Exception:
            log.exception("Alarm-Takt gestolpert")

    async def _wache(self, jetzt: float) -> None:
        """Blinde Flecken, solange scharf ist (core/alarmwache.py)."""
        wachend = self.guarding(self._mode, self._zone) if self._mode else []
        # Die Vorgeschichte wird immer geführt, auch unscharf: Sonst
        # begänne die Frist beim Scharfschalten neu, und ein Sensor, der
        # seit dem Mittag weg ist, fiele erst am Abend auf.
        for entity in self.candidates():
            if entity.available:
                self._stumm_seit.pop(entity.id, None)
            else:
                self._stumm_seit.setdefault(entity.id, jetzt)

        if self._state not in (ARMED, ARMING) or not self._settings.get(
            "notify_blind", True
        ):
            self._blind_gemeldet.clear()
            return

        stellen = alarmwache.blindstellen(wachend, jetzt, self._stumm_seit)
        neu = [
            zeile
            for zeile in stellen
            if f"{zeile['entity_id']}:{zeile['art']}" not in self._blind_gemeldet
        ]
        # Behoben heisst: wieder scharf. Wer die Batterie wechselt, soll
        # beim nächsten Mal wieder gewarnt werden.
        self._blind_gemeldet = {
            f"{zeile['entity_id']}:{zeile['art']}" for zeile in stellen
        }
        if not neu:
            return

        self._note("blind", alarmwache.satz(neu), "")
        await self._notify(alarmwache.titel(neu), alarmwache.satz(neu), "alarm")
        await self._publish()

        if alarmwache.loest_aus(neu, self._settings):
            # Nur gemeldete Sabotage, nie die Funkstille, und nur wenn
            # jemand den Schalter umgelegt hat - warum, steht in
            # core/alarmwache.py.
            betroffen = self.hub.registry.get(neu[0]["entity_id"])
            if betroffen is not None:
                await self._trigger(betroffen)

    async def _anwesenheit(self, jetzt: float) -> None:
        """Scharf schalten, wenn alle weg sind (core/alarmanwesenheit.py)."""
        zustaende = self._anwesenheitszustaende()
        if not zustaende:
            return
        weg = alarmanwesenheit.alle_weg(zustaende)
        if weg:
            # Ausdrücklich auf None geprüft und nicht auf «falsch»: Ein
            # Zeitstempel 0 ist ein gültiger Zeitpunkt, und `or` würde
            # ihn jede Minute neu setzen - der Nachlauf käme nie zum
            # Ende.
            if self._weg_seit is None:
                self._weg_seit = jetzt
        else:
            self._weg_seit = None

        scharf_stufe = alarmanwesenheit.stufe_lesen(self._settings.get("presence_arm"))
        unscharf_stufe = alarmanwesenheit.stufe_lesen(
            self._settings.get("presence_disarm")
        )

        if alarmanwesenheit.soll_scharf(
            zustaende,
            stufe=scharf_stufe,
            state=self._state,
            weg_seit=self._weg_seit,
            jetzt=jetzt,
        ):
            await self._anwesenheit_handeln("scharf", scharf_stufe)
            return

        if alarmanwesenheit.soll_unscharf(
            zustaende, stufe=unscharf_stufe, state=self._state
        ):
            await self._anwesenheit_handeln("unscharf", unscharf_stufe)
            return

        # Zurückgesetzt, sobald die Lage wieder gewöhnlich ist - sonst
        # käme der Vorschlag beim nächsten Mal nicht mehr.
        self._anwesenheit_gemeldet = None

    async def _anwesenheit_handeln(self, richtung: str, stufe: str) -> None:
        if self._anwesenheit_gemeldet == richtung:
            return
        self._anwesenheit_gemeldet = richtung
        text = alarmanwesenheit.satz(richtung, stufe)
        if stufe == alarmanwesenheit.VORSCHLAGEN:
            # Ein Vorschlag, kein stilles Schalten: Der Tipp darauf führt
            # zur Anlage (core/pushziel.py), und dort entscheidet ein
            # Mensch. Ein Knopf am Sperrbildschirm, der entschärft, wäre
            # genau das, wogegen es die PIN gibt.
            await self._notify("Alarmanlage", text, "alarm_arming")
            return
        if richtung == "scharf":
            # Über arm(), nicht am Zustand vorbei: Die Prüfung auf
            # offene Fenster und blinde Sensoren soll auch für die
            # selbsttätige Schaltung gelten.
            ergebnis = await self.arm(alarmanwesenheit.MODUS, by="Anwesenheit")
            if not ergebnis.get("ok"):
                await self._notify(
                    "Konnte nicht scharf schalten",
                    "Niemand mehr zuhause – aber es steht noch etwas offen.",
                    "alarm_arming",
                )
                return
        else:
            await self.disarm(by="Anwesenheit")
        await self._notify("Alarmanlage", text, "alarm_arming")

    def _anwesenheitszustaende(self) -> list[str]:
        """Der Zustand jeder Person, wie der Geofence ihn führt.

        Über die Entitäten und nicht über den Geofence selbst: So
        funktioniert es auch mit von Hand gesetzter Anwesenheit, und die
        Anlage muss keine Integration kennen, die es vielleicht gar
        nicht gibt.
        """
        return [
            str(entity.state.get("state") or "")
            for entity in self.hub.registry.all()
            if str(entity.state.get("device_class") or "") == "presence"
        ]

    # ── Verlauf ────────────────────────────────────────────────────────────

    def _note(self, kind: str, text: str, by: str, entity_id: str | None = None) -> None:
        zeile: dict[str, Any] = {"kind": kind, "text": text, "by": by, "at": time.time()}
        # Nur bei einem Auslösen mitgeführt (Punkt 407 der Werkbank) - die
        # Fehlalarm-Statistik braucht die Gerätekennung, alle anderen
        # Zeilenarten kamen bisher ohne sie aus und sollen es weiter tun.
        if entity_id:
            zeile["entity_id"] = entity_id
        self._history.insert(0, zeile)
        limit = int(self._settings.get("history_limit") or 50)
        del self._history[limit:]
        self._save()

    @property
    def history(self) -> list[dict[str, Any]]:
        return list(self._history)

    # ── Konfiguration ──────────────────────────────────────────────────────

    def config_dict(self) -> dict[str, Any]:
        return {
            "sensors": [
                {"entity_id": entity_id, **entry}
                for entity_id, entry in self._sensors.items()
            ],
            "settings": dict(self._settings),
            "after_trigger": {
                mode: dict(entry) for mode, entry in self._after_trigger.items()
            },
            "actions": {slot: list(entries) for slot, entries in self._actions.items()},
            "escalation": dict(self._escalation),
        }

    def _save(self) -> None:
        self.hub.data.set("alarm", [{**self.config_dict(), "history": self._history}])

    async def update_config(self, patch: dict[str, Any]) -> None:
        """Sensorzuordnung und Einstellungen aus der App übernehmen."""
        if "sensors" in patch:
            self._sensors = parse_sensors(patch["sensors"])
        if "settings" in patch:
            self._settings = {**self._settings, **(patch["settings"] or {})}
        if "after_trigger" in patch:
            self._after_trigger = parse_after(patch["after_trigger"], self._after_trigger)
        if "actions" in patch:
            self._actions = parse_actions(patch["actions"])
        if "escalation" in patch:
            self._escalation = parse_escalation(patch["escalation"])
        self._save()
        await self._publish()

    # ── Kommandos ──────────────────────────────────────────────────────────

    async def handle_command(
        self, entity: Entity, command: str, data: dict[str, Any]
    ) -> None:
        force = bool(data.get("force"))
        # Die PIN kann als data.pin mitkommen (Karten, Szenen); fehlt sie
        # und ist eine gesetzt, erklärt der Fehler, was zu tun ist.
        pin = str(data.get("pin") or "") or None
        # Setzt die API-Schicht für Gemeinschaftsgeräte - siehe check_pin().
        require_pin = bool(data.get("require_pin"))
        # Wer geschaltet hat, gehört in den Verlauf: «Unscharf geschaltet ·
        # Ablauf «Nach Hause»». Ohne das steht dort ein Vorgang ohne
        # Urheber - und genau danach fragt man, wenn die Anlage von selbst
        # aufgegangen ist.
        wer = quellen_name(source.current())
        if command in ("disarm", "turn_off"):
            await self.disarm(by=wer, pin=pin, require_pin=require_pin)
            return
        if command == "panic":
            # Ohne PIN und aus jedem Zustand - die Begründung steht bei
            # panic() selbst. Auch als Kommando, damit ein Wandtaster
            # neben der Haustüre ihn auslösen kann.
            await self.panic(by=wer or "Panikknopf")
            return
        if command == "toggle":
            if self._state == DISARMED:
                await self.arm("ausser_haus", force=force)
            else:
                await self.disarm(by=wer, pin=pin, require_pin=require_pin)
            return
        mode = {
            "arm_night": "nacht",
            "arm_away": "ausser_haus",
            "arm_vacation": "urlaub",
            "turn_on": "ausser_haus",
        }.get(command)
        if mode is None:
            await super().handle_command(entity, command, data)
            return
        result = await self.arm(mode, force=force)
        if not result.get("ok"):
            raise HomePilotError(
                "Scharfschalten nicht möglich, noch offen: "
                + ", ".join(result.get("open", []))
            )


INTEGRATION = AlarmIntegration
