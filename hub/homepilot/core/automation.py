"""Deklarative Automations-Engine: Trigger → Bedingungen → Aktionen.

Trigger:
  - {type: state, entity_id, attribute?: "state", from?, to?}
  - {type: state, entity_id, attribute, above? | below?}   # Schwelle gekreuzt
  - {type: availability, entity_id, to: false|true}  # meldet sich (nicht) mehr
  - {type: interval, seconds}
  - {type: time, at: "HH:MM", jitter?: minuten}   # jitter: ± zufällig (155)
  - {type: sun, event: "sunrise"|"sunset", offset?: minuten, jitter?: minuten}
  - {type: calendar, contains?: "Wort", event?: "start"|"end",
     minutes_before?: minuten, entity_id?}   # Termin beginnt/endet (153)

Bedingungen:
  - {type: state, entity_id, attribute?: "state", equals? | above? | below?}
  - {type: time, after?: "HH:MM", before?: "HH:MM", weekdays?: [0..6],
     except_holidays?: true}   # Luzerner Feiertage, siehe feiertage.py (154)
  - {type: sun, state: "up"|"down"}   # steht die Sonne über dem Horizont?
  - {type: group, match: "any"|"all", conditions: [...]}  # und/oder geschachtelt

Aktionen:
  - {type: command, entity_id, command, data?}
  - {type: delay, seconds}
  - {type: scene, scene} / {type: hue_scene, scene}
  - {type: music, do: favorite|sleep|pause_all|night|fade, …} – siehe docs/musik.md
  - {type: notify, title?, body?, to?, camera?}
  - {type: wait_until, ...Bedingung, timeout?: sekunden}
  - {type: fade, entity_id, to: 0..100, minutes}   # weich dimmen (157)
  - {type: automation, automation_id}   # die Aktionen eines anderen mitausführen

Läuft ein Ablauf noch (etwa in einem ``delay``) und wird erneut
ausgelöst, entscheidet ``mode``:

  - ``single`` (Vorgabe) verwirft den zweiten Auslöser.
  - ``restart`` bricht den laufenden Durchgang ab und beginnt von vorn -
    der Nachlauf eines Treppenhauslichts, vier Minuten nach der *letzten*
    Bewegung statt nach der ersten.
  - ``queued`` reiht ihn an: Zweimal klingeln gibt zwei Nachrichten, nicht
    eine verworfene. Höchstens ``QUEUE_LIMIT`` stauen sich.

``quiet_until`` (Unix-Sekunden oder ISO-Zeitstempel) lässt einen Ablauf
bis zu einem Zeitpunkt ruhen. Anders als ``enabled: false`` meldet er sich
von selbst zurück - wer über die Festtage das Bewegungslicht abschaltet,
schaltet es im Januar sonst nicht wieder ein.

Wird der Hub mitten in einer Wartezeit beendet, schreibt er den offenen
Rest weg und holt ihn beim nächsten Start nach (fällig heisst sofort,
sonst nach der Restzeit; älter als zwei Stunden wird verworfen). Ohne das
blieb nach jeder Auslieferung ein Licht an, das hätte ausgehen sollen.

Passt eine Bedingung nicht, kann statt der Aktionen ein zweiter Satz
laufen (``otherwise``) – sonst bräuchte «sonst mach das andere» zwei
Abläufe mit gegenteiliger Bedingung, die man beim Ändern beide anfassen
muss.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from . import astro, babysitter, feiertage, kamera, personenbild
from . import light as licht
from . import push as push_service
from .source import as_source, automation_source

if TYPE_CHECKING:
    from .hub import Hub

# Standard-Standort (Zell LU), falls in der Config keiner steht.
DEFAULT_LAT = 47.13844
DEFAULT_LON = 7.92059

log = logging.getLogger(__name__)

# So lange darf ein Standbild eine Nachricht aufhalten.
#
# `snapshot()` holt kein fertiges Bild ab, sondern stösst eines an: Bei
# Ring weckt das die Kamera, die Bibliothek fragt danach in Runden nach,
# ob es schon da ist. Im guten Fall sind das ein paar Sekunden, im
# schlechten wartet sie, bis der Aufruf von selbst aufgibt - und solange
# stand die ganze Nachricht still. Es hatte geklingelt, der Hub hatte
# alles beisammen, und das Telefon schwieg, weil noch ein Foto fehlte.
#
# Nach Ablauf geht sie ohne Bild raus. Für eine Türklingel ist das die
# richtige Reihenfolge: Erst wissen, dass jemand da ist, dann sehen wer.
# Ein Bild, das den Besucher um eine halbe Minute verpasst, ist ohnehin
# keines mehr - und die Kachel in der App zeigt es dann trotzdem.
BILD_WARTEZEIT = 4.0


def crosses_threshold(
    old: Any, new: Any, above: Any = None, below: Any = None
) -> bool:
    """Wurde eine Schwelle gerade überschritten? (rein, testbar)

    Für Messwerte, die sich dauernd ändern – Leistung, Temperatur. Ein
    Trigger soll dann genau beim Übertritt auslösen, nicht bei jeder
    Schwankung darunter: Der Tumbler ist fertig, wenn die Leistung von
    «über 5 W» auf «unter 5 W» fällt, nicht jedes Mal, wenn 2.1 W zu 2.0 W
    wird. Ein unbekannter alter Wert zählt nicht als Übertritt.
    """
    try:
        new_value = float(new)
        old_value = float(old)
    except (TypeError, ValueError):
        return False
    if above is not None:
        return old_value <= float(above) < new_value
    if below is not None:
        return new_value < float(below) <= old_value
    return False


# Manche Meldungen tragen bei jedem Mal denselben Wert: Ein Wandtaster
# meldet wieder «kurz gedrückt», eine Klingel wieder «klingelt». Die
# Prüfung «hat sich etwas geändert?» würde das zweite Mal verwerfen - und
# genau das ist der Fall, den man automatisieren will.
#
# Deshalb führen solche Entitäten neben dem Wert einen Zeitstempel mit.
# Welcher zu welchem Feld gehört, steht hier: Der Stempel zählt nur für
# sein eigenes Feld. Täte er es für alle, liesse ein Klingeln auch einen
# Ablauf loslaufen, der auf «Gerät ist online» wartet - obwohl dort nichts
# geschehen ist.
EVENT_MARKERS = {
    "state": "last_press",
    "ring": "last_ring",
    "motion": "last_motion",
}


def event_marker(attribute: str) -> str | None:
    """Welches Zeitstempel-Feld zu diesem Zustandsfeld gehört (rein, testbar).

    Kamera-Erkennungen kommen in Paaren: `detected_person` sagt, ob
    gerade jemand zu sehen ist, `last_person`, wann zuletzt. Sie einzeln
    aufzuzählen wäre eine Liste, die bei jeder neuen Erkennungsart
    nachzuführen ist - und genau das vergisst man.
    """
    if attribute in EVENT_MARKERS:
        return EVENT_MARKERS[attribute]
    if attribute.startswith("detected_"):
        return "last_" + attribute[len("detected_") :]
    return None


def _event_again(attribute: str, data: dict[str, Any]) -> bool:
    """Ein neues Ereignis trotz gleichen Zustands? (rein, testbar)

    Ohne das hätte ein Wandtaster genau einmal funktioniert - und eine
    Türklingel auch nur so lange, bis das Feld «ring» einmal auf «on»
    hängen blieb: Beim nächsten Läuten stünde dort wieder «on», und die
    Änderungsprüfung liesse den Ablauf still durchfallen.
    """
    marker = event_marker(attribute)
    if marker is None:
        return False
    new = data.get("new_state") or {}
    if marker not in new:
        return False
    return (data.get("old_state") or {}).get(marker) != new[marker]


@dataclass
class Automation:
    id: str
    alias: str
    triggers: list[dict[str, Any]]
    conditions: list[dict[str, Any]] = field(default_factory=list)
    actions: list[dict[str, Any]] = field(default_factory=list)
    # Was stattdessen läuft, wenn die Bedingungen nicht passen. Leer =
    # nichts, wie bisher.
    otherwise: list[dict[str, Any]] = field(default_factory=list)
    # Aus der config.yaml stammende sind in der App nur lesbar.
    editable: bool = False
    # Ausgeschaltete Abläufe bleiben stehen, laufen aber nicht. Besser als
    # löschen: Ein Ablauf, den man im Sommer nicht braucht, ist im Winter
    # sonst neu zu bauen.
    enabled: bool = True
    # Was geschieht, wenn der Ablauf noch läuft und erneut ausgelöst wird.
    #
    # «single» (Vorgabe): Der zweite Auslöser wird verworfen. Richtig für
    # alles, was einmal geschehen soll - eine Nachricht kommt sonst
    # doppelt.
    #
    # «restart»: Der laufende Durchgang wird abgebrochen und von vorn
    # begonnen. Das ist der Nachlauf, den man von einem Treppenhauslicht
    # kennt: Bewegung schaltet ein und wartet vier Minuten; kommt in
    # dieser Zeit neue Bewegung, beginnen die vier Minuten von vorn, und
    # erst vier Minuten nach der letzten Bewegung geht es aus. Ohne diesen
    # Modus stünde man nach genau vier Minuten im Dunkeln, egal wie viel
    # Betrieb war.
    mode: str = "single"
    # Bis wann der Ablauf ruht (Unix-Sekunden). Ein-/Ausschalten allein
    # genügte nicht: Wer über die Festtage das Bewegungslicht ruhen lässt,
    # schaltet es ab - und im Januar nicht wieder ein. Mit einer Frist
    # meldet er sich von selbst zurück.
    quiet_until: float | None = None
    # Frühestens wieder nach so vielen Sekunden. «mode» schützt nur,
    # solange der Ablauf *läuft* – ein Ablauf ohne Wartezeit ist in einer
    # Millisekunde durch, und ein zuckender Melder im Wind macht dann aus
    # einer Durchsage zwanzig. Null heisst: kein Mindestabstand.
    cooldown: float = 0.0
    # Wie die Bedingungen verknüpft sind: «all» = alle müssen stimmen,
    # «any» = eine genügt. Auslöser sind davon nicht betroffen – sie sind
    # Ereignisse und können gar nicht gleichzeitig eintreten, ein «und»
    # zwischen ihnen wäre also nie erfüllt.
    match: str = "all"
    # Frei benannte Kategorie zum Gruppieren in der App. Es gibt keine
    # Liste erlaubter Namen: Wer einen neuen tippt, hat ihn damit angelegt –
    # eine Kategorie ohne Einträge braucht niemand.
    category: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "alias": self.alias,
            "triggers": self.triggers,
            "conditions": self.conditions,
            "actions": self.actions,
            "otherwise": self.otherwise,
            "editable": self.editable,
            "enabled": self.enabled,
            "mode": self.mode,
            "quiet_until": self.quiet_until,
            "cooldown": self.cooldown,
            "match": self.match,
            "category": self.category,
        }

    def as_config(self) -> dict[str, Any]:
        """Zurück in die Form, in der sie gespeichert wird."""
        return {
            "id": self.id,
            "alias": self.alias,
            "trigger": self.triggers,
            "condition": self.conditions,
            "action": self.actions,
            "otherwise": self.otherwise,
            "enabled": self.enabled,
            "mode": self.mode,
            "quiet_until": self.quiet_until,
            "cooldown": self.cooldown,
            "match": self.match,
            "category": self.category,
        }


# So viele Läufe merkt sich der Hub – genug, um einen Abend nachzuvollziehen.
RUN_LIMIT = 100

# Wo die unterbrochenen Wartezeiten liegen, und wie viele höchstens.
PENDING_KEY = "automation_pending"
PENDING_LIMIT = 50
# Älter als das wird nicht mehr nachgeholt. Zwei Stunden decken jedes
# Update und jeden Stromausfall ab; was länger her ist, will man nicht
# mitten in der Nacht noch ausgeführt bekommen.
PENDING_MAX_AGE = 2 * 3600

# Wie viele Läufe sich bei «queued» höchstens stauen dürfen. Ohne Grenze
# baute ein Melder im Dauerfeuer tausend Durchgänge auf, die dann
# stundenlang nacheinander abliefen.
QUEUE_LIMIT = 20

# Wie tief ein Ablauf andere Abläufe aufrufen darf. Drei Ebenen decken
# jeden sinnvollen Fall; alles darüber ist ein Kreis, den man nicht
# bemerkt hat.
CALL_DEPTH = 3

# «Warten bis»: wie oft nachgesehen wird, und wie lange höchstens, wenn im
# Ablauf keine eigene Frist steht. Eine Frist muss sein – sonst bliebe ein
# Ablauf für immer stehen, wenn die Tür offen bleibt.
WAIT_POLL = 1.0
WAIT_TIMEOUT = 300.0


WEEKDAYS = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")


def parse_weekdays(raw: Any) -> set[int]:
    """Erlaubte Wochentage einlesen (rein, testbar).

    0 ist Montag, wie bei ``datetime.weekday()``. Eine leere oder kaputte
    Angabe heisst «alle Tage» und nicht «kein Tag»: Wer sich vertippt, soll
    einen Ablauf haben, der zu oft läuft und auffällt – nicht einen, der
    stumm bleibt und den man erst im Winter vermisst.
    """
    days: set[int] = set()
    for entry in raw or []:
        try:
            number = int(entry)
        except (TypeError, ValueError):
            continue
        if 0 <= number <= 6:
            days.add(number)
    return days


def weekday_label(days: set[int]) -> str:
    """«Mo, Di, Mi» – oder «Werktage» bzw. «Wochenende» (rein, testbar)."""
    if not days or len(days) == 7:
        return "jeden Tag"
    if days == {0, 1, 2, 3, 4}:
        return "Werktage"
    if days == {5, 6}:
        return "Wochenende"
    return ", ".join(WEEKDAYS[day] for day in sorted(days))


def describe_target(condition: dict[str, Any], named: Any = str) -> str:
    """Worauf eine Bedingung hinauswill – bejahend (rein, testbar).

    Das Gegenstück zu ``describe_condition``, die sagt, warum etwas *nicht*
    passte. Beim Warten will man das Ziel lesen, nicht den Fehlschlag.
    """
    name = named(condition.get("entity_id"))
    if "above" in condition:
        return f"{name} über {condition['above']} steht"
    if "below" in condition:
        return f"{name} unter {condition['below']} steht"
    if "equals" in condition:
        return f"{name} «{condition['equals']}» ist"
    return f"{name} sich meldet"


def describe_action(action: dict[str, Any], name_of: Any = None) -> str:
    """Eine Aktion in einem Satz – für den Trockenlauf (rein, testbar).

    ``name_of`` bildet eine Entitäts-Kennung auf den Anzeigenamen ab; ohne
    sie steht die Kennung da. Der Trockenlauf soll zeigen, was passieren
    *würde*, und dafür muss man es lesen können.
    """
    def named(entity_id: Any) -> str:
        text = str(entity_id or "?")
        return str(name_of(text)) if name_of else text

    atype = action.get("type", "command")
    if atype == "command":
        data = action.get("data") or {}
        extra = ""
        if "brightness" in data:
            extra = f" auf {data['brightness']} %"
        elif "position" in data:
            extra = f" auf {data['position']} %"
        return f"{named(action.get('entity_id'))}: {action.get('command', '?')}{extra}"
    if atype == "light":
        teile: list[str] = []
        helligkeit = action.get("brightness")
        if isinstance(helligkeit, str) and helligkeit.lower() == "adaptive":
            teile.append("an die Umgebung angepasst")
        elif helligkeit is not None:
            teile.append(f"{helligkeit} %")
        if action.get("color"):
            teile.append(f"Farbe {action['color']}")
        if action.get("color_temp"):
            teile.append(f"{round(1_000_000 / float(action['color_temp']))} K")
        wie = ", ".join(teile) if teile else "an"
        nachlauf = _seconds(action.get("off_after"))
        # «und in 4 Min wieder aus» gehört in den Trockenlauf: Sonst steht
        # da nur, dass das Licht angeht, und die Frage «und wann geht es
        # aus?» bleibt offen.
        dazu = (
            f", {offset_label(nachlauf).replace('nach', 'in')} wieder aus"
            if nachlauf > 0
            else ""
        )
        return f"{named(action.get('entity_id'))}: Licht {wie}{dazu}"
    if atype == "toggle_all":
        namen = [named(entity_id) for entity_id in action.get("entity_ids") or []]
        return f"{', '.join(namen) or '?'}: gemeinsam umschalten"
    if atype == "delay":
        return f"{action.get('seconds', 0)} Sekunden warten"
    if atype == "wait_until":
        timeout = action.get("timeout")
        grenze = f" (höchstens {timeout} s)" if timeout else ""
        return f"warten bis {describe_target(action, named)}{grenze}"
    if atype == "scene":
        return f"Szene «{action.get('scene', '?')}»"
    if atype == "hue_scene":
        return f"Hue-Szene «{action.get('scene', '?')}»"
    if atype == "notify":
        wer = action.get("to") or "alle"
        bild = " mit Kamerabild" if action.get("camera") else ""
        return f"Nachricht an {wer}: «{action.get('title') or action.get('body') or ''}»{bild}"
    if atype == "broadcast":
        boxen = action.get("speakers") or []
        wo = f" auf {len(boxen)} Box(en)" if boxen else " auf allen Boxen"
        return f"Durchsage{wo}: «{action.get('text') or ''}»"
    if atype == "fade":
        return (
            f"{named(action.get('entity_id'))}: über {action.get('minutes', 0)} Min "
            f"auf {action.get('to', 0)} % dimmen"
        )
    if atype == "music":
        return musik_satz(action, named)
    return f"unbekannte Aktion «{atype}»"


#: Was ein Musik-Schritt tun kann. Der Schlüssel steht in `do`.
MUSIK_TATEN = ("favorite", "sleep", "pause_all", "night", "fade")


def musik_satz(action: dict[str, Any], named: Any) -> str:
    """Ein Musik-Schritt in einem Satz (rein, testbar).

    Der Trockenlauf soll lesbar sein, bevor der Ablauf zum ersten Mal
    läuft - «Musik-Aktion» wäre keine Auskunft.
    """
    tat = str(action.get("do") or "").strip().lower()
    if tat == "favorite":
        wo = action.get("device")
        return (
            f"Favorit «{action.get('favorite') or '?'}» abspielen"
            + (f" auf {wo}" if wo else "")
        )
    if tat == "sleep":
        return (
            f"{named(action.get('entity_id'))}: nach "
            f"{action.get('minutes', 30)} Min ausblenden"
        )
    if tat == "pause_all":
        return "überall Pause"
    if tat == "night":
        return "Nachtruhe " + ("ein" if action.get("on", True) else "aus")
    if tat == "fade":
        return (
            f"{named(action.get('entity_id'))}: leise starten bis "
            f"{action.get('volume', 30)} %"
        )
    return f"unbekannter Musik-Schritt «{tat or 'nichts'}»"


def _seconds(value: Any) -> float:
    """Eine Sekundenangabe aus der Konfiguration (rein, testbar).

    Unsinn und Negatives ergeben 0 – also «kein Nachlauf», nicht «sofort
    wieder aus»: Ein Tippfehler soll das Licht nicht ausknipsen, kaum dass
    es an ist.
    """
    try:
        zahl = float(value)
    except (TypeError, ValueError):
        return 0.0
    return zahl if zahl > 0 else 0.0


def offset_label(seconds: float) -> str:
    """«sofort», «nach 30 s», «nach 4 Min» – wann eine Aktion dran ist
    (rein, testbar)."""
    ganze = int(round(seconds))
    if ganze <= 0:
        return "sofort"
    if ganze < 60:
        return f"nach {ganze} s"
    stunden, rest = divmod(ganze, 3600)
    minuten, sekunden = divmod(rest, 60)
    teile: list[str] = []
    if stunden:
        teile.append(f"{stunden} Std")
    if minuten:
        teile.append(f"{minuten} Min")
    # Sekundenreste nur unterhalb einer Stunde – «nach 2 Std 5 s» hilft
    # niemandem, «nach 4 Min 30 s» dagegen schon.
    if sekunden and not stunden:
        teile.append(f"{sekunden} s")
    return "nach " + " ".join(teile)


def timed_actions(actions: list[dict[str, Any]], name_of: Any = None) -> list[str]:
    """Die Aktionsliste mit Zeitversatz – für den Trockenlauf (rein, testbar).

    «Was geschieht in fünf Minuten – und geht das Licht dann wirklich
    aus?» Bisher zählte der Trockenlauf die Aktionen nur auf; bei einem
    Ablauf mit Wartezeiten musste man den Versatz im Kopf aufsummieren.
    Jetzt trägt jede Aktion ihren Zeitpunkt: Verzögerungen summieren
    sich, ein «warten bis» zählt mit seiner Frist als spätester
    Zeitpunkt («spätestens nach …»). Ohne Wartezeiten bleibt die Liste,
    wie sie war – ein «sofort» vor jeder Zeile wäre nur Lärm.
    """
    hat_wartezeit = any(
        action.get("type") in ("delay", "wait_until", "fade") for action in actions
    )
    lines: list[str] = []
    offset = 0.0
    nur_spaetestens = False
    for action in actions:
        atype = action.get("type", "command")
        if atype == "delay":
            try:
                offset += float(action.get("seconds") or 0)
            except (TypeError, ValueError):
                pass
            lines.append(describe_action(action, name_of))
            continue
        if atype == "fade":
            # Dimmen dauert - was danach kommt, kommt danach.
            zeile = describe_action(action, name_of)
            if offset > 0:
                praefix = offset_label(offset)
                if nur_spaetestens:
                    praefix = f"spätestens {praefix}"
                zeile = f"{praefix}: {zeile}"
            lines.append(zeile)
            try:
                offset += float(action.get("minutes") or 0) * 60
            except (TypeError, ValueError):
                pass
            continue
        if atype == "wait_until":
            try:
                offset += max(1.0, float(action.get("timeout") or WAIT_TIMEOUT))
            except (TypeError, ValueError):
                offset += WAIT_TIMEOUT
            # Die Bedingung kann früher zutreffen – ab hier ist der
            # Versatz eine Obergrenze, kein Termin.
            nur_spaetestens = True
            lines.append(describe_action(action, name_of))
            continue
        if not hat_wartezeit:
            lines.append(describe_action(action, name_of))
            continue
        prefix = offset_label(offset)
        if nur_spaetestens and offset > 0:
            prefix = f"spätestens {prefix}"
        lines.append(f"{prefix}: {describe_action(action, name_of)}")
    return lines


def describe_condition(condition: dict[str, Any], value: Any) -> str:
    """Warum eine Bedingung nicht passte, in einem Satz (rein, testbar).

    «Bedingung 2 war falsch» hilft niemandem. «Helligkeit war 44, verlangt
    ist unter 30» beantwortet die Frage sofort.
    """
    ctype = condition.get("type", "state")
    if ctype == "group":
        subs = [c for c in condition.get("conditions") or [] if isinstance(c, dict)]
        art = "oder" if str(condition.get("match", "all")) == "any" else "und"
        return f"«{art}»-Gruppe mit {len(subs)} Bedingungen nicht erfüllt"
    if ctype == "time":
        days = parse_weekdays(condition.get("weekdays"))
        if days and datetime.now().weekday() not in days:
            return f"Heute ist {WEEKDAYS[datetime.now().weekday()]}, verlangt sind {weekday_label(days)}"
        if condition.get("except_holidays") and feiertage.ist_feiertag(
            datetime.now().date()
        ):
            name = feiertage.feiertage(datetime.now().year).get(datetime.now().date(), "")
            return f"Heute ist ein Feiertag ({name})"
        window = " bis ".join(
            part for part in (condition.get("after"), condition.get("before")) if part
        )
        return f"Uhrzeit ausserhalb {window or '(kein Fenster)'}"
    if ctype == "sun":
        want = "Tag" if str(condition.get("state", "up")) == "up" else "Nacht"
        return f"Es ist nicht {want}"
    name = condition.get("entity_id", "Gerät")
    shown = "nichts" if value is None else f"«{value}»"
    if "above" in condition:
        return f"{name} ist {shown}, verlangt ist über {condition['above']}"
    if "below" in condition:
        return f"{name} ist {shown}, verlangt ist unter {condition['below']}"
    if "equals" in condition:
        return f"{name} ist {shown}, verlangt ist «{condition['equals']}»"
    return f"{name} passt nicht"


# Die drei Arten, mit einem erneuten Auslöser umzugehen.
MODES = ("single", "restart", "queued")


def parse_mode(value: Any) -> str:
    """Welcher Modus gemeint ist (rein, testbar).

    Alles Unbekannte wird «single»: Ein Tippfehler soll nicht dazu führen,
    dass ein laufender Ablauf abgebrochen oder eine Nachricht doppelt
    verschickt wird. Die zurückhaltende Variante ist die sichere.
    """
    text = str(value or "").strip().lower()
    return text if text in MODES else "single"


def parse_cooldown(value: Any) -> float:
    """Der Mindestabstand in Sekunden (rein, testbar).

    Unbrauchbares und Negatives heisst null: Ein Tippfehler darf einen
    Ablauf bremsen, aber nicht stummschalten.
    """
    try:
        sekunden = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, sekunden)


def parse_quiet_until(value: Any) -> float | None:
    """Bis wann ein Ablauf ruht (rein, testbar).

    Erlaubt sind Unix-Sekunden und ein ISO-Zeitstempel - Letzteres, weil
    das die App schickt und man es in der config.yaml lesen kann.
    Unbrauchbares heisst «ruht nicht»: Ein Ablauf, der wegen eines
    Tippfehlers für immer schweigt, ist schlimmer als einer, der zu früh
    wieder anläuft.
    """
    if value is None or value is False:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    try:
        return datetime.fromisoformat(str(value)).timestamp()
    except (TypeError, ValueError):
        return None


def describe_trigger_health(
    trigger: dict[str, Any],
    wert: Any,
    gefeuert: float | None,
    gemeldet: float | None,
    jetzt: float,
) -> dict[str, Any]:
    """Warum ein Auslöser schweigt, in einem Satz (rein, testbar).

    Der häufigste Support-Fall lautet «der Ablauf geht nicht», und dahinter
    stecken drei ganz verschiedene Ursachen:

      - Das Gerät meldet sich gar nicht (Batterie leer, Funk weg).
      - Es meldet sich, aber nie mit dem gesuchten Wert (falscher Kanal,
        falscher Zustand eingetragen).
      - Es hat gefeuert, und dann hat eine Bedingung geblockt - das steht
        schon im Lauf-Verlauf.

    Der Lauf-Verlauf kennt nur den dritten Fall. Diese Auskunft trennt die
    beiden anderen.
    """
    def her(zeitpunkt: float | None) -> float | None:
        return None if zeitpunkt is None else round(jetzt - zeitpunkt, 1)

    art = str(trigger.get("type", "state"))
    if art == "availability":
        return {
            "type": art,
            "ok": True,
            "hinweis": (
                "Erreichbarkeits-Auslöser – er feuert, wenn das Gerät "
                "verstummt oder wiederkommt, nicht auf einen Zustand."
            ),
        }
    if art != "state":
        return {
            "type": art,
            "ok": True,
            "hinweis": "Zeit- oder Sonnen-Auslöser – er hängt an keinem Gerät.",
        }

    entity_id = str(trigger.get("entity_id") or "")
    ziel = trigger.get("to")
    if gemeldet is None:
        hinweis = (
            f"«{entity_id}» hat sich noch nie gemeldet, seit der Hub läuft. "
            "Stimmt die Kennung, und ist das Gerät erreichbar?"
        )
        ok = False
    elif gefeuert is None:
        hinweis = (
            f"«{entity_id}» meldet sich, aber nie mit dem gesuchten Wert. "
            f"Jetzt steht dort «{wert}»"
            + (f", gesucht ist «{ziel}»." if ziel is not None else ".")
        )
        ok = False
    else:
        hinweis = "Der Auslöser hat schon gefeuert – was danach geschah, steht im Verlauf."
        ok = True
    return {
        "type": art,
        "entity_id": entity_id,
        "ok": ok,
        "wert": wert,
        "zuletzt_gefeuert_vor": her(gefeuert),
        "zuletzt_gemeldet_vor": her(gemeldet),
        "hinweis": hinweis,
    }


# Wie lange ein Zeit-Auslöser höchstens am Stück schläft.
#
# Vorher wurde die ganze Differenz bis zum Ziel in einem Zug verschlafen.
# `asyncio.sleep` rechnet in monotoner Zeit, die Wanduhr aber nicht: Bei
# der Umstellung im Frühling verschiebt sich alles um eine Stunde, im
# Herbst ebenso in die andere Richtung, und nach einem Ruhezustand des
# Rechners stimmt gar nichts mehr. Wer stattdessen in Stücken schläft und
# jedes Mal neu gegen die Wanduhr rechnet, trifft die Zeit auch dann.
TIME_STEP = 900.0


def next_time_fire(
    jetzt: datetime, hour: int, minute: int, gefeuert_am: Any
) -> tuple[bool, float, Any]:
    """Ist ein Zeit-Auslöser fällig, und wie lange bis zur nächsten Prüfung?

    Rein und testbar - und das ist der Punkt: Die Zeitumstellung lässt
    sich sonst nur zweimal im Jahr beobachten.

    ``gefeuert_am`` ist das Datum, an dem zuletzt ausgelöst wurde. Daran
    hängt der Herbst: Am Umstellungstag gibt es 02:30 zweimal, und ein
    Ablauf soll trotzdem einmal laufen.

    Der Frühling geht andersherum: 02:30 gibt es an diesem Tag gar nicht.
    Statt den Lauf zu verlieren, feuert er, sobald die Uhr daran vorbei
    ist - also um 03:00. Lieber eine halbe Stunde spät als gar nicht.
    """
    ziel = jetzt.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if jetzt >= ziel:
        feuern = gefeuert_am != jetzt.date()
        if feuern:
            gefeuert_am = jetzt.date()
        rest = ((ziel + timedelta(days=1)) - jetzt).total_seconds()
    else:
        feuern = False
        rest = (ziel - jetzt).total_seconds()
    return feuern, min(max(rest, 1.0), TIME_STEP), gefeuert_am


def jitter_minutes(trigger: dict[str, Any]) -> int:
    """± Minuten Zufalls-Versatz eines Zeit-/Sonnen-Auslösers (rein).

    Punkt 155 der Werkbank: Storen, die 365 Tage im Jahr sekundengleich
    fahren, erzählen jedem Beobachter «hier wohnt eine Zeitschaltuhr».
    Unbrauchbares heisst null, und mehr als vier Stunden sind kein
    Versatz mehr, sondern ein anderer Zeitpunkt.
    """
    try:
        wert = float(trigger.get("jitter") or 0)
    except (TypeError, ValueError):
        return 0
    return int(max(0.0, min(240.0, wert)))


def shifted_hhmm(hour: int, minute: int, minus_minutes: int) -> tuple[int, int]:
    """Eine Uhrzeit um Minuten nach vorn schieben, über Mitternacht hinweg
    (rein, testbar). Der Zufalls-Versatz beginnt am frühesten Punkt des
    Fensters und würfelt von dort nach hinten."""
    total = (hour * 60 + minute - minus_minutes) % (24 * 60)
    return total // 60, total % 60


def fade_plan(von: float, nach: float, minuten: float) -> tuple[list[int], float]:
    """Die Helligkeitsstufen eines Dimm-Schritts (rein, testbar) - Punkt 157.

    Ergebnis: die Stufen der Reihe nach und die Pause dazwischen. Alle
    ~15 Sekunden eine Stufe, höchstens 60 - feiner sieht kein Auge, und
    jede Stufe ist ein Funkbefehl. Gleiche aufeinanderfolgende Werte
    fallen weg: Von 20 auf 21 % in zehn Minuten sind zwei Befehle, nicht
    vierzig.
    """
    minuten = max(0.05, min(120.0, minuten))
    dauer = minuten * 60
    schritte = int(min(60, max(2, dauer / 15)))
    werte: list[int] = []
    for i in range(1, schritte + 1):
        wert = round(von + (nach - von) * i / schritte)
        if not werte or werte[-1] != wert:
            werte.append(wert)
    return werte, dauer / schritte


def calendar_due(
    events: list[dict[str, Any]],
    contains: str,
    kind: str,
    minutes_before: float,
    jetzt_ts: float,
    gefeuert: set[str],
) -> list[str]:
    """Welche Kalender-Termine JETZT einen Ablauf auslösen (rein) - 153.

    Gibt die Schlüssel der fälligen Termine zurück; wer schon in
    ``gefeuert`` steht, feuert nicht noch einmal. Das Fenster ist fünf
    Minuten breit: Der Kalender wird nur alle paar Minuten abgefragt,
    und ein Termin soll deswegen nicht durchrutschen.
    """
    needle = contains.strip().lower()
    faellig: list[str] = []
    for event in events or []:
        summary = str(event.get("summary") or "")
        if needle and needle not in summary.lower():
            continue
        grenze = event.get("end" if kind == "end" else "start")
        if not grenze:
            continue
        try:
            zeitpunkt = datetime.fromisoformat(str(grenze).replace("Z", "+00:00"))
        except ValueError:
            continue
        if zeitpunkt.tzinfo is not None:
            zeitpunkt = zeitpunkt.astimezone().replace(tzinfo=None)
        feuer_ab = zeitpunkt.timestamp() - minutes_before * 60
        schluessel = f"{summary}|{grenze}|{kind}"
        if schluessel in gefeuert:
            continue
        if feuer_ab <= jetzt_ts < feuer_ab + 300:
            faellig.append(schluessel)
    return faellig


def _as_list(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, dict):
        return [value]
    return list(value)


def parse_automations(
    configs: list[dict[str, Any]], editable: bool = False
) -> list[Automation]:
    automations = []
    for index, config in enumerate(configs):
        auto_id = str(config.get("id") or f"automation_{index}")
        automations.append(
            Automation(
                id=auto_id,
                alias=str(config.get("alias") or auto_id),
                triggers=_as_list(config.get("trigger")),
                conditions=_as_list(config.get("condition")),
                actions=_as_list(config.get("action")),
                otherwise=_as_list(config.get("otherwise")),
                editable=editable,
                enabled=config.get("enabled", True) is not False,
                mode=parse_mode(config.get("mode")),
                quiet_until=parse_quiet_until(config.get("quiet_until")),
                cooldown=parse_cooldown(config.get("cooldown")),
                match="any" if str(config.get("match")) == "any" else "all",
                category=str(config["category"]) if config.get("category") else None,
            )
        )
    return automations


def parse_hhmm(value: Any) -> tuple[int, int] | None:
    """Eine Uhrzeit einlesen, wie sie getippt wird (rein, testbar).

    Die Felder im Editor sind freie Eingaben, und getippt wird alles
    Mögliche: «22», «22.00», «2200», « 8:5 ». Bisher zerbrach jedes
    davon ausser «22:00» - und zwar mitten im Lauf, nicht beim
    Speichern. Der Ablauf lief dann einfach nie, ohne einen Grund zu
    nennen.

    Zurück kommt None, wenn wirklich keine Uhrzeit darin steckt. Was der
    Aufrufer daraus macht, entscheidet er selbst: Der Auslöser bricht ab,
    die Bedingung schlägt fehl. Beides ist besser als eine Automation,
    die zur falschen Zeit läuft.
    """
    text = str(value or "").strip().replace(".", ":").replace(" ", "")
    if not text:
        return None
    if ":" not in text and text.isdigit():
        # «2200» und «800» - vierstellig sind die letzten zwei Minuten.
        text = f"{text[:-2]}:{text[-2:]}" if len(text) > 2 else f"{text}:00"
    teile = text.split(":", 1)
    if len(teile) != 2 or not teile[0].isdigit() or not teile[1].isdigit():
        return None
    stunde, minute = int(teile[0]), int(teile[1])
    if not (0 <= stunde <= 23 and 0 <= minute <= 59):
        return None
    return stunde, minute


def _parse_hhmm(value: str) -> tuple[int, int]:
    zeit = parse_hhmm(value)
    if zeit is None:
        raise ValueError(f"'{value}' ist keine Uhrzeit der Form HH:MM")
    return zeit


def time_in_window(now: Any, after: str | None, before: str | None) -> bool:
    """Liegt die Uhrzeit im Fenster? (rein, testbar)

    Der Sonderfall ist der Abend: «nach 22:00 und vor 06:00» meint ein
    Fenster über Mitternacht, und wörtlich genommen ist es leer - keine
    Uhrzeit ist gleichzeitig später als 22 und früher als 6. Wer das so
    einträgt, bekäme einen Ablauf, der nie läuft und dafür keinen Grund
    nennt.

    Deshalb: Ist `after` später als `before`, gilt das Fenster über
    Mitternacht. Nur eine der beiden Angaben verhält sich wie bisher.
    """
    if after is None and before is None:
        return True
    minuten = now.hour * 60 + now.minute
    von = None if after is None else parse_hhmm(after)
    bis = None if before is None else parse_hhmm(before)
    # Steht da etwas, das keine Uhrzeit ist, gilt die Bedingung als nicht
    # erfüllt. Sie zu überspringen wäre der gefährlichere Fehler: Aus
    # «nur nachts» würde «immer».
    if (after and von is None) or (before and bis is None):
        log.warning("Zeitbedingung mit ungültiger Uhrzeit: after=%r before=%r", after, before)
        return False
    von_min = None if von is None else von[0] * 60 + von[1]
    bis_min = None if bis is None else bis[0] * 60 + bis[1]
    if von_min is not None and bis_min is not None:
        if von_min <= bis_min:
            return von_min <= minuten < bis_min
        # Über Mitternacht: Abend oder früher Morgen genügt.
        return minuten >= von_min or minuten < bis_min
    if von_min is not None:
        return minuten >= von_min
    return minuten < (bis_min or 0)


def opposing(first: str, second: str) -> bool:
    """Heben sich zwei Befehle gegenseitig auf? (rein, testbar)"""
    pairs = (
        {"turn_on", "turn_off"},
        {"open", "close"},
        {"lock", "unlock"},
        {"arm", "disarm"},
        {"start", "stop"},
        {"play", "pause"},
    )
    return any({first, second} == pair for pair in pairs)


def _targets(actions: list[dict[str, Any]]) -> dict[str, set[str]]:
    """Gerät → Befehle, die dieser Ablauf darauf loslässt (rein)."""
    result: dict[str, set[str]] = {}
    for action in actions or []:
        if not isinstance(action, dict):
            continue
        entity_id = action.get("entity_id")
        command = action.get("command")
        # Ein Licht-Schritt trägt kein «command», schaltet die Lampe aber
        # ein - für die Frage «wer macht nachts das Licht an?» zählt er.
        if action.get("type") == "light" and isinstance(entity_id, str):
            result.setdefault(entity_id, set()).add("turn_on")
            continue
        # «Gemeinsam umschalten» kann beides und ist damit zu nichts
        # gegensätzlich - aber die Geräte gehören trotzdem erfasst.
        if action.get("type") == "toggle_all":
            for entry in action.get("entity_ids") or []:
                if isinstance(entry, str):
                    result.setdefault(entry, set()).add("toggle")
            continue
        if isinstance(entity_id, str) and isinstance(command, str):
            result.setdefault(entity_id, set()).add(command)
    return result


def find_conflicts(automations: list[Any]) -> list[dict[str, Any]]:
    """Abläufe, die dasselbe Gerät gegensätzlich schalten (rein, testbar).

    Kein Fehler, sondern ein Hinweis: Manchmal ist genau das gewollt (der
    eine schaltet ein, der andere später aus). Aber wenn nachts das Licht
    von selbst angeht, sucht man genau diese Liste - und findet sie sonst
    erst nach einer halben Stunde Lesen.
    """
    rows: list[dict[str, Any]] = []
    enabled = [a for a in automations if getattr(a, "enabled", True)]
    for index, first in enumerate(enabled):
        first_targets = _targets(
            list(getattr(first, "actions", [])) + list(getattr(first, "otherwise", []))
        )
        for second in enabled[index + 1 :]:
            second_targets = _targets(
                list(getattr(second, "actions", []))
                + list(getattr(second, "otherwise", []))
            )
            for entity_id, commands in first_targets.items():
                other = second_targets.get(entity_id)
                if not other:
                    continue
                clashing = sorted(
                    {
                        f"{one}/{two}"
                        for one in commands
                        for two in other
                        if opposing(one, two)
                    }
                )
                if clashing:
                    rows.append(
                        {
                            "entity_id": entity_id,
                            "commands": clashing,
                            "automations": [
                                {"id": first.id, "alias": first.alias},
                                {"id": second.id, "alias": second.alias},
                            ],
                        }
                    )
    return rows


class AutomationEngine:
    def __init__(self, hub: Hub) -> None:
        # Protokoll der letzten Läufe, jüngster zuerst – auch der nicht
        # ausgeführten, denn genau die wirft man dem Hub vor.
        self.runs: list[dict[str, Any]] = []
        self.hub = hub
        self.automations: list[Automation] = []
        # Wann jeder Ablauf zuletzt anlief – für den Mindestabstand.
        self._last_started: dict[str, float] = {}
        self._unsubscribe = None
        self._timer_tasks: list[asyncio.Task] = []
        self._run_tasks: set[asyncio.Task] = set()
        self._running: set[str] = set()
        # Der laufende Durchgang je Ablauf - nur «restart» braucht ihn,
        # um ihn abbrechen zu können.
        self._tasks_by_id: dict[str, asyncio.Task] = {}
        # Fährt der Hub herunter? Dann ist ein Abbruch kein Neubeginn,
        # sondern eine unterbrochene Wartezeit, die später weitergehen soll.
        self._stopping = False
        # Wann die Wartezeit des jeweils laufenden Durchgangs endet. Je
        # Task, weil mehrere Abläufe gleichzeitig warten können.
        self._deadlines: dict[asyncio.Task, float] = {}
        # Wie viele Läufe je Ablauf noch anstehen (nur bei «queued»).
        self._queued: dict[str, int] = {}
        # Laufende Nachläufe je Lampe: der Zeitgeber, der sie wieder
        # ausschaltet, und wann er fällig ist. Je Lampe genau einer -
        # neue Bewegung verlängert, statt einen zweiten zu starten.
        self._nachlauf: dict[str, tuple[asyncio.Task, float]] = {}
        # Wann ein Auslöser zuletzt gepasst hat und wann sich sein Gerät
        # zuletzt überhaupt gemeldet hat - je (Ablauf, Nummer des
        # Auslösers). Das beantwortet «kam der Auslöser an?», was der
        # Lauf-Verlauf nicht kann: Dort steht nur, was gelaufen ist.
        self._gefeuert: dict[tuple[str, int], float] = {}
        self._gemeldet: dict[tuple[str, int], float] = {}
        # Wie tief die Aufrufkette gerade ist (Ablauf ruft Ablauf).
        self._depth: dict[str, int] = {}
        # Laufende «bleibt so für X»-Wartezeiten je (Automation, Auslöser).
        self._held_tasks: dict[tuple[str, int], asyncio.Task] = {}
        # Bis zu diesem Zeitpunkt laufen keine Automationen – für Abende mit
        # Gästen oder wenn man selbst am Basteln ist.
        self.paused_until: datetime | None = None

    @property
    def paused(self) -> bool:
        if self.paused_until is None:
            return False
        if datetime.now() >= self.paused_until:
            self.paused_until = None
            return False
        return True

    def pause(self, seconds: float) -> datetime | None:
        """Pausiert für n Sekunden; 0 hebt die Pause auf."""
        self.paused_until = (
            datetime.now() + timedelta(seconds=seconds) if seconds > 0 else None
        )
        if self.paused_until:
            log.info("Automationen pausiert bis %s", self.paused_until.strftime("%H:%M"))
        else:
            log.info("Automationen wieder aktiv")
        return self.paused_until

    async def start(
        self,
        configs: list[dict[str, Any]],
        stored: list[dict[str, Any]] | None = None,
    ) -> None:
        # Konfigurierte zuerst, danach die in der App angelegten.
        self.automations = parse_automations(configs) + parse_automations(
            stored or [], editable=True
        )
        self._restore_runs()
        # Was der letzte Halt offen liess, zuerst - noch vor den Auslösern.
        self._hole_rest()
        self._unsubscribe = self.hub.bus.subscribe("state_changed", self._on_state_changed)
        for automation in self.automations:
            for trigger in automation.triggers:
                if trigger.get("type") == "interval":
                    task = asyncio.create_task(
                        self._interval_loop(automation, float(trigger["seconds"]))
                    )
                    self._timer_tasks.append(task)
                elif trigger.get("type") == "time":
                    task = asyncio.create_task(
                        self._time_loop(
                            automation, str(trigger["at"]), jitter_minutes(trigger)
                        )
                    )
                    self._timer_tasks.append(task)
                elif trigger.get("type") == "sun":
                    task = asyncio.create_task(
                        self._sun_loop(
                            automation,
                            str(trigger.get("event", "sunset")),
                            float(trigger.get("offset", 0)),
                            jitter_minutes(trigger),
                        )
                    )
                    self._timer_tasks.append(task)
                elif trigger.get("type") == "calendar":
                    task = asyncio.create_task(self._calendar_loop(automation, trigger))
                    self._timer_tasks.append(task)
        if self.automations:
            log.info("%d Automationen geladen", len(self.automations))

    async def stop(self) -> None:
        # Vor dem Abbrechen: Was jetzt an Wartezeiten stirbt, soll beim
        # nächsten Start weitergehen und nicht als «restart» gelten.
        self._stopping = True
        # Was jetzt an Nachläufen stirbt, schaltet sonst nie wieder aus.
        self._merke_nachlaeufe()
        if self._unsubscribe:
            self._unsubscribe()
            self._unsubscribe = None
        for task, _ in self._nachlauf.values():
            task.cancel()
        self._nachlauf.clear()
        for task in [*self._timer_tasks, *self._run_tasks, *self._held_tasks.values()]:
            task.cancel()
        for task in [*self._timer_tasks, *self._run_tasks, *self._held_tasks.values()]:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._timer_tasks.clear()
        self._run_tasks.clear()
        self._held_tasks.clear()
        # Sonst hielte die Zuordnung Ablauf → Durchgang nach dem Halt
        # abgebrochene Tasks fest.
        self._tasks_by_id.clear()

    # ── Trigger ────────────────────────────────────────────────────────────

    def _on_state_changed(self, _event_type: str, data: dict[str, Any]) -> None:
        jetzt = time.time()
        for automation in self.automations:
            if not automation.enabled:
                continue
            for index, trigger in enumerate(automation.triggers):
                art = trigger.get("type", "state")
                if art == "availability":
                    # Die Flanke der Erreichbarkeit, nicht der Zustand:
                    # Der Wächter schickt dafür bisher nur eine Push-
                    # Nachricht – ein Ablauf kann jetzt darauf reagieren
                    # («wenn der Rauchmelder verstummt, sag es laut»).
                    if self._availability_trigger_matches(trigger, data):
                        self._gefeuert[(automation.id, index)] = jetzt
                        hold = float(trigger.get("for") or 0)
                        if hold > 0:
                            self._schedule_held(automation, index, trigger, hold)
                        else:
                            self._schedule(automation, str(data.get("entity_id") or "") or None)
                        break
                    continue
                if art != "state":
                    continue
                # Auch wenn der Auslöser *nicht* passt: Dass sich das Gerät
                # überhaupt gemeldet hat, ist die halbe Antwort auf «warum
                # geht der Ablauf nicht». Ohne das bleibt nur Raten, ob der
                # Melder schweigt oder ob er nur nie den gesuchten Wert
                # meldet.
                if trigger.get("entity_id") == data.get("entity_id"):
                    self._gemeldet[(automation.id, index)] = jetzt
                if self._state_trigger_matches(trigger, data):
                    self._gefeuert[(automation.id, index)] = jetzt
                    hold = float(trigger.get("for") or 0)
                    if hold > 0:
                        # «bleibt so für X»: erst warten, dann prüfen, ob
                        # der Zustand noch gilt - «alle weg» heisst erst
                        # nach zehn Minuten wirklich alle weg, nicht beim
                        # kurzen Gang zum Briefkasten.
                        self._schedule_held(automation, index, trigger, hold)
                    else:
                        # Welcher Melder gefeuert hat, entscheidet bei
                        # «an die Helligkeit angepasst», wessen Lux gelten.
                        self._schedule(automation, str(data.get("entity_id") or "") or None)
                    break

    def _schedule_held(
        self,
        automation: Automation,
        index: int,
        trigger: dict[str, Any],
        hold: float,
    ) -> None:
        key = (automation.id, index)
        pending = self._held_tasks.get(key)
        if pending is not None and not pending.done():
            # Es läuft schon eine Wartezeit für genau diesen Auslöser -
            # ein Flackern startet sie nicht neu.
            return

        async def wait_and_check() -> None:
            await asyncio.sleep(hold)
            if self._trigger_still_holds(trigger):
                self._schedule(automation, str(trigger.get("entity_id") or "") or None)

        task = asyncio.create_task(wait_and_check())
        self._held_tasks[key] = task
        task.add_done_callback(lambda _t: self._held_tasks.pop(key, None))

    def _trigger_still_holds(self, trigger: dict[str, Any]) -> bool:
        """Gilt der Zielzustand des Auslösers immer noch? (für ``for``)

        Nur der Zielzustand zählt - «from» ist nach der Wartezeit
        naturgemäss Geschichte. Ohne prüfbares Ziel (bare Trigger) gilt
        die Wartezeit als bestanden.
        """
        entity = self.hub.registry.get(str(trigger.get("entity_id") or ""))
        if entity is None:
            return False
        if trigger.get("type") == "availability":
            # «seit zehn Minuten stumm»: Nach der Wartezeit zählt, ob das
            # Gerät immer noch (un)erreichbar ist – nicht die Flanke.
            if "to" in trigger:
                return bool(entity.available) == bool(trigger["to"])
            return True
        value = entity.state.get(trigger.get("attribute", "state"))
        if "above" in trigger or "below" in trigger:
            try:
                number = float(value)
            except (TypeError, ValueError):
                return False
            if "above" in trigger and not number > float(trigger["above"]):
                return False
            if "below" in trigger and not number < float(trigger["below"]):
                return False
            return True
        if "to" in trigger:
            return value == trigger["to"]
        return True

    @staticmethod
    def _availability_trigger_matches(
        trigger: dict[str, Any], data: dict[str, Any]
    ) -> bool:
        """Hat sich die Erreichbarkeit dieses Geräts eben geändert?

        ``to: false`` heisst «meldet sich nicht mehr» – der Fall, für den
        es den Auslöser gibt. ``to: true`` («ist wieder da») gibt es der
        Vollständigkeit halber mit; ohne ``to`` zählt jede Flanke.
        """
        if trigger.get("entity_id") != data.get("entity_id"):
            return False
        if not data.get("availability_changed"):
            return False
        entity = data.get("entity") or {}
        if "to" in trigger:
            return bool(entity.get("available")) == bool(trigger["to"])
        return True

    @staticmethod
    def _state_trigger_matches(trigger: dict[str, Any], data: dict[str, Any]) -> bool:
        if trigger.get("entity_id") != data["entity_id"]:
            return False
        attribute = trigger.get("attribute", "state")
        old = data["old_state"].get(attribute)
        new = data["new_state"].get(attribute)
        if old == new and not _event_again(attribute, data):
            return False
        if "above" in trigger or "below" in trigger:
            return crosses_threshold(old, new, trigger.get("above"), trigger.get("below"))
        if "from" in trigger and old != trigger["from"]:
            return False
        if "to" in trigger and new != trigger["to"]:
            return False
        return True

    async def _interval_loop(self, automation: Automation, seconds: float) -> None:
        while True:
            await asyncio.sleep(seconds)
            self._schedule(automation)

    async def _time_loop(self, automation: Automation, at: str, jitter: int = 0) -> None:
        # Mit Zufalls-Versatz (Punkt 155) beginnt das Fenster `jitter`
        # Minuten VOR der eingestellten Zeit; gewürfelt wird dann bis zu
        # 2×`jitter` nach hinten - zusammen ±jitter um den Zielpunkt.
        hour, minute = shifted_hhmm(*_parse_hhmm(at), jitter)
        start = datetime.now()
        # Beim Start nicht nachträglich feuern: Wer den Hub um 20 Uhr neu
        # startet, will den 18:30-Ablauf nicht sofort ausgeführt bekommen.
        ziel_heute = start.replace(hour=hour, minute=minute, second=0, microsecond=0)
        gefeuert_am = start.date() if start >= ziel_heute else None
        while True:
            feuern, schlafen, gefeuert_am = next_time_fire(
                datetime.now(), hour, minute, gefeuert_am
            )
            if feuern:
                if jitter > 0:
                    await asyncio.sleep(random.uniform(0, 2 * jitter * 60))
                self._schedule(automation)
            await asyncio.sleep(schlafen)

    # ── Unterbrochene Wartezeiten ──────────────────────────────────────────
    #
    # Der Fall: Ein Bewegungslicht ist an und wartet vier Minuten aufs
    # Ausschalten. Genau dann kommt ein Update, der Hub startet neu - und
    # das Licht bleibt an, bis es jemand bemerkt. Nach jeder Auslieferung
    # passiert das, und niemand sagt es.
    #
    # Deshalb wird beim Herunterfahren weggeschrieben, was noch offen war
    # und wann es fällig gewesen wäre. Beim nächsten Start wird es
    # nachgeholt: fällig heisst sofort, sonst nach der Restzeit.

    def _merke_rest(
        self, automation: Automation, actions: list[dict[str, Any]], position: int
    ) -> None:
        """Den unerledigten Teil eines Laufs wegschreiben."""
        rest = actions[position + 1 :]
        if not rest:
            return
        task = asyncio.current_task()
        faellig = self._deadlines.get(task) if task is not None else None
        offen = [
            eintrag
            for eintrag in self.hub.data.get(PENDING_KEY)
            if eintrag.get("automation_id") != automation.id
        ]
        offen.append(
            {
                "automation_id": automation.id,
                "alias": automation.alias,
                "actions": rest,
                # Ohne laufende Wartezeit sofort fällig: Dann wurde mitten
                # in einer Aktion abgebrochen, und der Rest gehört gleich
                # nachgeholt.
                "resume_at": faellig if faellig is not None else time.time(),
            }
        )
        try:
            self.hub.data.set(PENDING_KEY, offen[:PENDING_LIMIT])
        except Exception:
            log.debug("Offene Wartezeit nicht schreibbar", exc_info=True)
        log.info(
            "Automation '%s': %d Schritt(e) offen, wird nach dem Start nachgeholt",
            automation.alias,
            len(rest),
        )

    def _hole_rest(self) -> None:
        """Beim Start: nachholen, was der letzte Halt offen liess."""
        try:
            offen = list(self.hub.data.get(PENDING_KEY))
        except (TypeError, ValueError):
            # Ein kaputter Eintrag im Datenspeicher - dann eben ohne
            # Nachholen starten, statt gar nicht.
            return
        if not offen:
            return
        # Sofort leeren: Scheitert das Nachholen, soll es nicht bei jedem
        # Start erneut versucht werden - ein Licht, das seit gestern aus
        # ist, muss nicht heute nochmals ausgeschaltet werden.
        try:
            self.hub.data.set(PENDING_KEY, [])
        except TypeError:
            # Nicht serialisierbar hiesse: schon beim Schreiben kaputt.
            # Das Leeren scheitern zu lassen, wäre trotzdem falsch.
            pass
        for eintrag in offen:
            task = asyncio.create_task(self._rest_nachholen(eintrag))
            self._run_tasks.add(task)
            task.add_done_callback(self._run_tasks.discard)

    async def _rest_nachholen(self, eintrag: dict[str, Any]) -> None:
        alias = str(eintrag.get("alias") or eintrag.get("automation_id") or "?")
        actions = [a for a in eintrag.get("actions") or [] if isinstance(a, dict)]
        if not actions:
            return
        wartet = float(eintrag.get("resume_at") or 0) - time.time()
        # Zu lange her: Was gestern hätte geschehen sollen, holt man heute
        # nicht nach. Ein Ausschalten wäre harmlos, eine Durchsage um drei
        # Uhr morgens nicht.
        if wartet < -PENDING_MAX_AGE:
            log.info(
                "Automation '%s': offener Rest ist %.0f Minuten alt - verworfen",
                alias,
                -wartet / 60,
            )
            return
        if wartet > 0:
            log.info(
                "Automation '%s': noch %.0f Sekunden Wartezeit aus der Zeit vor "
                "dem Neustart",
                alias,
                wartet,
            )
            await asyncio.sleep(wartet)
        automation = next(
            (a for a in self.automations if a.id == eintrag.get("automation_id")), None
        )
        if automation is None:
            # Der Ablauf wurde inzwischen gelöscht oder umbenannt. Der Rest
            # läuft trotzdem: Er war schon beschlossen, als der Hub ging.
            automation = Automation(
                id=str(eintrag.get("automation_id") or "?"), alias=alias, triggers=[]
            )
        log.info("Automation '%s': hole %d offene(n) Schritt(e) nach", alias, len(actions))
        try:
            with as_source(automation_source(automation.id, automation.alias)):
                for action in actions:
                    await self._execute_action(automation, action)
        except asyncio.CancelledError:
            raise
        except Exception as err:
            log.warning("Automation '%s': Nachholen fehlgeschlagen: %s", alias, err)

    def get(self, automation_id: str) -> Automation | None:
        """Ein laufender Ablauf, egal woher er stammt.

        Die API kennt sonst nur die in der App angelegten (die stehen in
        der homepilot-data.json). Was aus der config.yaml kommt, gab es
        für sie nicht – und damit auch keinen Weg, es zu kopieren.
        """
        return next((a for a in self.automations if a.id == automation_id), None)

    def diagnose(self, automation_id: str) -> dict[str, Any] | None:
        """Warum ein Ablauf schweigt – je Auslöser eine Auskunft."""
        automation = self.get(automation_id)
        if automation is None:
            return None
        jetzt = time.time()
        auslöser = []
        for index, trigger in enumerate(automation.triggers):
            entity = self.hub.registry.get(str(trigger.get("entity_id") or ""))
            wert = (
                entity.state.get(trigger.get("attribute", "state"))
                if entity is not None
                else None
            )
            auslöser.append(
                describe_trigger_health(
                    trigger,
                    wert,
                    self._gefeuert.get((automation.id, index)),
                    self._gemeldet.get((automation.id, index)),
                    jetzt,
                )
            )
        return {
            "automation_id": automation.id,
            "alias": automation.alias,
            "enabled": automation.enabled,
            "ruht_bis": automation.quiet_until,
            "laeuft_gerade": automation.id in self._running,
            "triggers": auslöser,
            "runs": [r for r in self.runs if r.get("automation_id") == automation.id][:10],
        }

    def _restore_runs(self) -> None:
        """Den Verlauf früherer Läufe zurückholen (jüngste zuerst)."""
        try:
            stored = self.hub.data.get("automation_runs")
        except (TypeError, ValueError):
            # Kaputter Verlauf: lieber ohne Geschichte starten als gar nicht.
            return
        if stored:
            self.runs = list(stored)[:RUN_LIMIT]

    def _location(self) -> tuple[float, float]:
        loc = getattr(self.hub.config, "location", None) or {}
        try:
            return float(loc.get("latitude", DEFAULT_LAT)), float(
                loc.get("longitude", DEFAULT_LON)
            )
        except (TypeError, ValueError):
            return DEFAULT_LAT, DEFAULT_LON

    async def _sun_loop(
        self, automation: Automation, event: str, offset: float, jitter: int = 0
    ) -> None:
        lat, lon = self._location()
        sunset = event != "sunrise"
        while True:
            nxt = astro.next_sun_event(datetime.now(), lat, lon, sunset, offset)
            if nxt is None:
                # In Polarnähe an manchen Tagen kein Ereignis – später erneut.
                await asyncio.sleep(6 * 3600)
                continue
            delay = (nxt - datetime.now()).total_seconds()
            if jitter > 0:
                # Jeden Tag neu gewürfelt (Punkt 155): mal vor, mal nach
                # dem Sonnenstand, nie zweimal gleich.
                delay += random.uniform(-jitter * 60, jitter * 60)
            if delay > 0:
                await asyncio.sleep(delay)
            self._schedule(automation)
            # Etwas über den Zeitpunkt hinaus schlafen, damit nicht im selben
            # Moment gleich das nächste (identische) Ziel berechnet wird.
            await asyncio.sleep(60)

    def _calendar_events(self, entity_id: str) -> list[dict[str, Any]]:
        """Die Terminliste - vom benannten Kalender oder dem ersten, der
        einen führt."""
        if entity_id:
            entity = self.hub.registry.get(entity_id)
            events = entity.state.get("events") if entity else None
            return events if isinstance(events, list) else []
        for entity in self.hub.registry.all():
            events = entity.state.get("events")
            if isinstance(events, list):
                return events
        return []

    async def _calendar_loop(
        self, automation: Automation, trigger: dict[str, Any]
    ) -> None:
        """Kalender-Auslöser (Punkt 153): «wenn ein Termin ‹…› beginnt».

        Der Kalender wird ohnehin gepollt und liegt als Gerätezustand
        bereit - hier wird nur minütlich nachgesehen, ob ein passender
        Termin gerade seine Schwelle überschreitet. ``minutes_before``
        macht daraus die Erinnerung am Vorabend (720 = 12 Stunden).
        """
        gefeuert: dict[str, float] = {}
        try:
            vorlauf = float(trigger.get("minutes_before") or 0)
        except (TypeError, ValueError):
            vorlauf = 0.0
        while True:
            await asyncio.sleep(60)
            faellig = calendar_due(
                self._calendar_events(str(trigger.get("entity_id") or "")),
                str(trigger.get("contains") or ""),
                str(trigger.get("event") or "start"),
                vorlauf,
                time.time(),
                set(gefeuert),
            )
            for schluessel in faellig:
                gefeuert[schluessel] = time.time()
                self._schedule(automation)
            # Das Gedächtnis soll nicht mit jedem Termin wachsen.
            grenze = time.time() - 48 * 3600
            for schluessel in [k for k, ts in gefeuert.items() if ts < grenze]:
                del gefeuert[schluessel]

    def _schedule(self, automation: Automation, ausloeser: str | None = None) -> None:
        """Einen Lauf anstossen.

        ``ausloeser`` ist das Gerät, dessen Meldung den Lauf ausgelöst hat -
        nur Zustands- und Erreichbarkeits-Auslöser haben eines. Gebraucht
        wird es von «Licht an die Helligkeit angepasst»: Hängen zwei Melder
        am selben Ablauf, zählt die Helligkeit dort, wo sich etwas bewegt
        hat, nicht die des anderen Zimmers."""
        if self.paused:
            log.debug("Automation '%s' übersprungen (pausiert)", automation.alias)
            return
        # Der Babysitter sitzt im Wohnzimmer, und die Anwesenheit weiss
        # nichts davon. Solange sein Modus läuft, ruht alles, was nicht
        # ausdrücklich freigegeben ist - allen voran «alles aus, wenn
        # niemand mehr zuhause ist».
        if babysitter.blocks(self.hub.data.get(babysitter.KEY), automation.id):
            log.info("Automation '%s' übersprungen (Babysitter-Modus)", automation.alias)
            self._note(
                automation,
                executed=False,
                error=None,
                skipped=["Babysitter-Modus"],
            )
            return
        if automation.quiet_until and time.time() < automation.quiet_until:
            # Ruht noch. Anders als «ausgeschaltet» meldet er sich von
            # selbst zurück - deshalb hier und nicht in `enabled`.
            log.debug(
                "Automation '%s' ruht noch (%.0f Minuten)",
                automation.alias,
                (automation.quiet_until - time.time()) / 60,
            )
            return
        if automation.cooldown > 0:
            zuletzt = self._last_started.get(automation.id)
            if zuletzt is not None and time.time() - zuletzt < automation.cooldown:
                log.debug(
                    "Automation '%s' übersprungen (Mindestabstand %.0f s)",
                    automation.alias,
                    automation.cooldown,
                )
                return
        if automation.id in self._running:
            if automation.mode == "queued":
                # Der Reihe nach: Zweimal klingeln soll zwei Nachrichten
                # geben, nicht eine verworfene. Die Grenze ist da, damit
                # ein Melder im Dauerfeuer nicht tausend Läufe aufstaut.
                warteschlange = self._queued.setdefault(automation.id, 0)
                if warteschlange >= QUEUE_LIMIT:
                    log.warning(
                        "Automation '%s': %d Läufe stauen sich - weiterer verworfen",
                        automation.alias,
                        warteschlange,
                    )
                    return
                self._queued[automation.id] = warteschlange + 1
                return
            if automation.mode != "restart":
                # Läuft die Automation bereits (z.B. in einem delay),
                # nicht erneut starten.
                return
            # Nachlauf: Der laufende Durchgang wartet gerade ab - er wird
            # abgebrochen und gleich neu begonnen, damit die Wartezeit von
            # vorn zählt.
            laeuft = self._tasks_by_id.pop(automation.id, None)
            if laeuft is not None and not laeuft.done():
                laeuft.cancel()
            self._running.discard(automation.id)
        self._last_started[automation.id] = time.time()
        task = asyncio.create_task(self._run(automation, ausloeser))
        self._tasks_by_id[automation.id] = task
        self._run_tasks.add(task)
        task.add_done_callback(self._run_tasks.discard)
        task.add_done_callback(
            lambda done, key=automation.id: self._tasks_by_id.pop(key, None)
            if self._tasks_by_id.get(key) is done
            else None
        )

    def next_run(self, automation: Automation) -> float | None:
        """Wann der nächste Zeit- oder Sonnen-Auslöser fällig ist (Punkt 161).

        Unix-Sekunden, ``None`` wenn nichts planbar ist - Zustands- und
        Intervall-Auslöser haben keinen Kalender. Der Zufalls-Versatz
        bleibt aussen vor: Angezeigt wird der Zielpunkt, gewürfelt wird
        erst beim Feuern.
        """
        if not automation.enabled:
            return None
        jetzt = datetime.now()
        kandidaten: list[float] = []
        for trigger in automation.triggers:
            art = str(trigger.get("type", "state"))
            if art == "time":
                try:
                    hour, minute = _parse_hhmm(str(trigger.get("at")))
                except (TypeError, ValueError):
                    continue
                ziel = jetzt.replace(hour=hour, minute=minute, second=0, microsecond=0)
                if ziel <= jetzt:
                    ziel += timedelta(days=1)
                kandidaten.append(ziel.timestamp())
            elif art == "sun":
                lat, lon = self._location()
                nxt = astro.next_sun_event(
                    jetzt,
                    lat,
                    lon,
                    str(trigger.get("event", "sunset")) != "sunrise",
                    float(trigger.get("offset", 0) or 0),
                )
                if nxt is not None:
                    kandidaten.append(nxt.timestamp())
        return min(kandidaten) if kandidaten else None

    def tagesplan(self) -> list[dict[str, Any]]:
        """Was das Haus heute vorhat (Punkt 163).

        Alle Zeit- und Sonnen-Auslöser des heutigen Tages, auch die schon
        vorbeigezogenen - das Band in der App zeigt Erledigtes mit Haken
        und Kommendes mit Uhrzeit. Zustands-Auslöser haben keinen
        Kalender und stehen deshalb nicht hier.
        """
        heute = datetime.now()
        lat, lon = self._location()
        eintraege: list[dict[str, Any]] = []
        for automation in self.automations:
            if not automation.enabled:
                continue
            for trigger in automation.triggers:
                art = str(trigger.get("type", "state"))
                if art == "time":
                    try:
                        hour, minute = _parse_hhmm(str(trigger.get("at")))
                    except (TypeError, ValueError):
                        continue
                    zeitpunkt = heute.replace(
                        hour=hour, minute=minute, second=0, microsecond=0
                    )
                elif art == "sun":
                    ereignis = astro.sun_event(
                        heute.date(),
                        lat,
                        lon,
                        sunset=str(trigger.get("event", "sunset")) != "sunrise",
                    )
                    if ereignis is None:
                        continue
                    try:
                        versatz = float(trigger.get("offset", 0) or 0)
                    except (TypeError, ValueError):
                        versatz = 0.0
                    zeitpunkt = ereignis + timedelta(minutes=versatz)
                else:
                    continue
                eintraege.append(
                    {
                        "automation_id": automation.id,
                        "alias": automation.alias,
                        "at": zeitpunkt.timestamp(),
                        "art": art,
                    }
                )
        eintraege.sort(key=lambda eintrag: eintrag["at"])
        return eintraege

    async def probe_action(self, action: dict[str, Any]) -> None:
        """Eine einzelne Aktion ausführen, ohne den Ablauf (Punkt 164).

        Beim Einrichten will man oft nur wissen, ob Schritt drei - die
        Durchsage, das Kamerabild - so ankommt wie gedacht, ohne dass
        für jede Formulierungsprobe die Storen mitfahren.

        Warten wäre hier sinnlos, und einen anderen Ablauf aufzurufen
        wäre kein Einzelschritt mehr - beides wird abgelehnt.
        """
        atype = str(action.get("type", "command"))
        if atype in ("delay", "wait_until", "automation"):
            raise ValueError(f"«{atype}» lässt sich nicht einzeln ausprobieren")
        probe = Automation(id="probeschritt", alias="Probeschritt", triggers=[])
        await self._execute_action(probe, action)

    async def trigger_now(self, automation_id: str, ignore_conditions: bool = True) -> bool:
        """Einen Ablauf sofort ausführen – für den «Testen»-Knopf der App.

        ``ignore_conditions`` führt die Aktionen auch aus, wenn die
        Bedingungen gerade nicht passen (man will beim Testen das Ergebnis
        sehen, nicht die Bedingung prüfen). Gibt False zurück, wenn es den
        Ablauf nicht gibt.
        """
        automation = next(
            (a for a in self.automations if a.id == automation_id), None
        )
        if automation is None:
            return False
        with as_source(automation_source(automation.id, automation.alias)):
            for action in automation.actions:
                await self._execute_action(automation, action)
        return True

    # ── Ausführung ─────────────────────────────────────────────────────────

    async def _run(self, automation: Automation, ausloeser: str | None = None) -> None:
        self._running.add(automation.id)
        error: str | None = None
        executed = False
        actions: list[dict[str, Any]] = []
        # Die Schritt-Spur (Punkt 160): je Schritt, was er war, wann er
        # dran war und was dabei herauskam. «Fehlgeschlagen» allein
        # beantwortet die Frage «welcher Schritt hing?» nicht.
        spur: list[dict[str, Any]] = []
        start_ts = time.time()

        def name_of(entity_id: str) -> str:
            entity = self.hub.registry.get(entity_id)
            return entity.label if entity else entity_id

        # Bei welcher Aktion der Lauf gerade steht. Nur für den Fall, dass
        # der Hub mitten hinein herunterfährt - dann wird ab hier später
        # weitergemacht.
        position = 0
        try:
            held, failed = self._conditions_hold(automation)
            # Der «sonst»-Zweig ist ein vollwertiger Lauf und wird auch als
            # solcher protokolliert: Ein Ablauf, der etwas getan hat, darf im
            # Protokoll nicht als «übersprungen» stehen.
            actions = automation.actions if held else automation.otherwise
            if actions:
                executed = True
                log.info(
                    "Automation '%s' ausgelöst%s",
                    automation.alias,
                    "" if held else " (sonst-Zweig)",
                )
                # Alles, was jetzt folgt, wird der Automation zugeschrieben.
                with as_source(automation_source(automation.id, automation.alias)):
                    # Die Zählung wird nach der Schleife gebraucht, nicht
                    # darin - sie sagt im Abbruchfall, wo der Lauf stand.
                    # Deshalb unten die Ausnahme von B007.
                    for position, action in enumerate(actions):  # noqa: B007
                        notiz = await self._execute_action(automation, action, ausloeser)
                        if len(spur) < 40:
                            eintrag: dict[str, Any] = {
                                "label": describe_action(action, name_of),
                                "after": round(time.time() - start_ts, 1),
                            }
                            if notiz:
                                eintrag["note"] = notiz
                            spur.append(eintrag)
        except asyncio.CancelledError:
            # Abgebrochen, weil derselbe Ablauf gerade neu beginnt
            # (mode: restart). Das ist kein Fehler und gehört auch nicht
            # ins Protokoll - dort stünde sonst bei jeder Bewegung ein
            # abgebrochener Lauf neben dem neuen.
            #
            # Fährt dagegen der Hub herunter, ist es kein Neubeginn: Dann
            # bleibt eine Wartezeit auf halbem Weg stehen, und das Licht,
            # das in vier Minuten ausgehen sollte, bleibt an. Was noch
            # fehlt, wird deshalb weggeschrieben und beim nächsten Start
            # nachgeholt.
            self._running.discard(automation.id)
            if self._stopping and executed:
                self._merke_rest(automation, actions, position)
            raise
        except Exception as err:
            error = str(err)
            # Der gescheiterte Schritt gehört mit in die Spur - genau er
            # ist die Antwort auf «welcher hing?».
            if actions and len(spur) < 40:
                spur.append(
                    {
                        "label": describe_action(actions[position], name_of),
                        "after": round(time.time() - start_ts, 1),
                        "error": str(err),
                    }
                )
            log.exception("Automation '%s' fehlgeschlagen", automation.alias)
        finally:
            self._running.discard(automation.id)
            # Steht noch einer an? Dann jetzt - der Reihe nach heisst:
            # einer nach dem anderen, nicht alle gleichzeitig.
            offen = self._queued.get(automation.id, 0)
            if offen > 0 and not self._stopping:
                self._queued[automation.id] = offen - 1
                self._schedule(automation)
            else:
                self._queued.pop(automation.id, None)
            # Die Frist der eigenen Wartezeit ist jetzt ausgewertet.
            eigener = asyncio.current_task()
            if eigener is not None:
                self._deadlines.pop(eigener, None)

        # Auch der nicht ausgeführte Lauf wird protokolliert – mit dem
        # Grund. Genau danach sucht man, wenn ein Ablauf schweigt.
        self._note(
            automation,
            executed=executed,
            error=error,
            skipped=[] if executed else failed,
            steps=spur,
        )
        if executed:
            await self.hub.bus.publish(
                "automation_run",
                {
                    "automation_id": automation.id,
                    "alias": automation.alias,
                    "success": error is None,
                    "error": error,
                },
            )

    def _note(
        self,
        automation: Automation,
        *,
        executed: bool,
        error: str | None,
        skipped: list[str],
        steps: list[dict[str, Any]] | None = None,
    ) -> None:
        self.runs.insert(
            0,
            {
                "automation_id": automation.id,
                "alias": automation.alias,
                "at": time.time(),
                "executed": executed,
                "error": error,
                "skipped": skipped,
                # Die Schritt-Spur (Punkt 160). Leer bei übersprungenen
                # Läufen - dort ist «skipped» die Auskunft.
                "steps": steps or [],
            },
        )
        del self.runs[RUN_LIMIT:]
        # Auch auf die Platte: Nach einem Neustart ist sonst genau die
        # Spur weg, der man nachgeht - «heute Nacht ging das Licht an, und
        # jetzt weiss niemand, warum».
        try:
            self.hub.data.set("automation_runs", self.runs)
        except Exception:
            log.debug("Ablauf-Verlauf nicht schreibbar", exc_info=True)

    def _conditions_hold(self, automation: Automation) -> tuple[bool, list[str]]:
        """Stimmen die Bedingungen? Ohne Bedingungen: ja.

        Gibt zusätzlich zurück, welche Bedingungen nicht erfüllt waren.
        Ohne diese Begründung rätselt man bei einem stummen Ablauf, ob der
        Auslöser nicht kam oder eine Bedingung im Weg war – und das war
        bisher nirgends zu sehen.

        «any» ohne Bedingungen wäre sonst nie erfüllt; ein Ablauf ohne
        «nur wenn» soll aber immer laufen.
        """
        if not automation.conditions:
            return True, []
        results = [
            (condition, self._check_condition(condition))
            for condition in automation.conditions
        ]
        failed = [describe_condition(c, self._value_of(c)) for c, ok in results if not ok]
        held = (
            any(ok for _, ok in results)
            if automation.match == "any"
            else all(ok for _, ok in results)
        )
        return held, failed

    def dry_run(self, automation: Automation) -> dict[str, Any]:
        """Was *würde* passieren – ohne dass etwas passiert.

        Der Testlauf über /trigger führt wirklich aus; das schreckt bei
        allem ab, was die Storen bewegt oder die Familie anpiepst. Hier
        werden die Bedingungen gegen den jetzigen Zustand geprüft und die
        Aktionen bloss aufgezählt.
        """
        held, failed = self._conditions_hold(automation)
        actions = automation.actions if held else automation.otherwise

        def name_of(entity_id: str) -> str:
            entity = self.hub.registry.get(entity_id)
            return entity.label if entity else entity_id

        return {
            "conditions_hold": held,
            "skipped": failed,
            "branch": "aktionen" if held else "sonst",
            "would_run": timed_actions(actions, name_of),
        }

    def _value_of(self, condition: dict[str, Any]) -> Any:
        """Der Istwert einer Gerätebedingung – für die Begründung."""
        if condition.get("type", "state") != "state":
            return None
        entity = self.hub.registry.get(condition.get("entity_id", ""))
        if entity is None:
            return None
        return entity.state.get(condition.get("attribute", "state"))

    def _check_condition(self, condition: dict[str, Any]) -> bool:
        ctype = condition.get("type", "state")
        if ctype == "group":
            # «(Wochenende oder Ferien) und dunkel» ging bisher nicht: Die
            # Bedingungsliste kannte nur ein einziges und/oder für alles.
            # Eine Gruppe verknüpft ihre Unterbedingungen selbst und darf
            # weitere Gruppen enthalten.
            subs = [c for c in condition.get("conditions") or [] if isinstance(c, dict)]
            if not subs:
                # Wie bei der leeren Bedingungsliste: leer heisst «gilt» –
                # eine vergessene Gruppe soll auffallen, nicht lähmen.
                return True
            if str(condition.get("match", "all")) == "any":
                return any(self._check_condition(c) for c in subs)
            return all(self._check_condition(c) for c in subs)
        if ctype == "state":
            entity = self.hub.registry.get(condition.get("entity_id", ""))
            if entity is None:
                return False
            value = entity.state.get(condition.get("attribute", "state"))
            if "equals" in condition:
                return value == condition["equals"]
            if "above" in condition:
                return value is not None and float(value) > float(condition["above"])
            if "below" in condition:
                return value is not None and float(value) < float(condition["below"])
            return True
        if ctype == "time":
            days = parse_weekdays(condition.get("weekdays"))
            if days and datetime.now().weekday() not in days:
                return False
            # «ausser an Feiertagen» (Punkt 154): Auffahrt ist ein
            # Donnerstag, aber kein Werktag - der Sauger soll das wissen.
            if condition.get("except_holidays") and feiertage.ist_feiertag(
                datetime.now().date()
            ):
                return False
            return time_in_window(
                datetime.now(), condition.get("after"), condition.get("before")
            )
        if ctype == "sun":
            # {type: sun, state: "up"|"down"} – steht die Sonne gerade über
            # dem Horizont? Für Hitzeschutz nur bei Tag u.ä.
            now = datetime.now()
            lat, lon = self._location()
            rise = astro.sun_event(now.date(), lat, lon, sunset=False)
            set_ = astro.sun_event(now.date(), lat, lon, sunset=True)
            if rise is None or set_ is None:
                return False
            up = rise <= now <= set_
            want = str(condition.get("state", "up"))
            return up if want == "up" else not up
        log.warning("Unbekannter Bedingungstyp: %s", ctype)
        return False

    async def _execute_action(
        self,
        automation: Automation,
        action: dict[str, Any],
        ausloeser: str | None = None,
    ) -> str | None:
        """Eine Aktion ausführen. Die Rückgabe ist eine kurze Notiz für
        die Schritt-Spur des Laufs (Punkt 160) - oder None."""
        atype = action.get("type", "command")
        if atype == "command":
            await self.hub.integrations.dispatch_command(
                action["entity_id"], action["command"], action.get("data") or {}
            )
        elif atype == "delay":
            sekunden = float(action["seconds"])
            # Die Frist festhalten, solange gewartet wird: Bricht der Hub
            # mitten hinein ab, weiss der nächste Start, wie viel noch
            # übrig war - und nicht bloss, dass irgendetwas offen ist.
            task = asyncio.current_task()
            if task is not None:
                self._deadlines[task] = time.time() + sekunden
            try:
                await asyncio.sleep(sekunden)
            except BaseException:
                # Die Frist bewusst stehen lassen: Genau jetzt braucht sie
                # der Abbruchzweig in _run, um zu wissen, wie viel Wartezeit
                # noch offen war. Aufgeräumt wird dort im finally.
                raise
            else:
                if task is not None:
                    self._deadlines.pop(task, None)
        elif atype == "light":
            return await self._light(automation, action, ausloeser)
        elif atype == "toggle_all":
            return await self._toggle_all(automation, action)
        elif atype == "wait_until":
            return await self._wait_until(automation, action)
        elif atype == "fade":
            await self._fade(automation, action)
        elif atype == "scene":
            await self.hub.scenes.activate(action["scene"])
        elif atype == "hue_scene":
            # Szenen der Hue-Bridge: Farben und Helligkeiten stecken dort,
            # und nur die Bridge kann sie in einem Zug setzen.
            hue = self.hub.integrations.get("hue")
            if hue is None or not hasattr(hue, "activate_scene"):
                log.warning("Hue-Szene in '%s', aber keine Hue-Bridge", automation.alias)
                return
            await hue.activate_scene(str(action.get("scene") or ""))
        elif atype == "automation":
            await self._run_other(automation, action)
        elif atype == "notify":
            await self._notify(automation, action, ausloeser)
        elif atype == "broadcast":
            # Durchsage auf die Cast-Boxen: «Es hat geklingelt»,
            # «Waschmaschine ist fertig». Die Quelle bleibt der Ablauf -
            # say.speak() überschreibt sie nicht.
            from . import say

            await say.speak(
                self.hub,
                str(action.get("text") or ""),
                speakers=[str(s) for s in action.get("speakers") or []] or None,
                volume=action.get("volume"),
            )
        elif atype == "music":
            return await self._musik(automation, action)
        else:
            log.warning("Unbekannter Aktionstyp in '%s': %s", automation.alias, atype)
        return None

    async def _musik(self, automation: Automation, action: dict[str, Any]) -> str | None:
        """Musik-Schritte: Favorit, Schlummer, überall Pause, Nachtruhe.

        Alles davon gab es schon - als Knopf in der App, nicht als
        Schritt in einem Ablauf. «Wenn alle weg sind: Musik aus» ging
        deshalb nur über den nackten Pause-Befehl je Box, und wer eine
        Box vergass, merkte es erst beim Heimkommen.
        """
        tat = str(action.get("do") or "").strip().lower()
        musik = getattr(self.hub, "musik", None)
        ton = getattr(self.hub, "ton", None)
        if musik is None or ton is None:  # pragma: no cover - nur Teststummel
            return "Musik-Dienst nicht bereit"

        if tat == "favorite":
            gesucht = str(action.get("favorite") or "").strip()
            eintrag = next(
                (
                    zeile
                    for zeile in musik.favoriten()
                    if gesucht in (zeile.get("id"), zeile.get("name"))
                ),
                None,
            )
            if eintrag is None:
                # Kein Abbruch: Ein umbenannter Favorit soll den ganzen
                # Ablauf nicht anhalten - aber im Protokoll stehen.
                return f"Favorit «{gesucht}» gibt es nicht mehr"
            await musik.abspielen(eintrag, str(action.get("device") or eintrag.get("device") or ""))
            return None

        if tat == "sleep":
            musik.schlummer(str(action.get("entity_id") or ""), float(action.get("minutes", 30)))
            return None

        if tat == "pause_all":
            gestoppt = await self._alle_pausieren()
            return None if gestoppt else "es lief nichts"

        if tat == "night":
            ton.nachtruhe_setzen({"on": bool(action.get("on", True))})
            return None

        if tat == "fade":
            entity_id = str(action.get("entity_id") or "")
            if "play" in (self.hub.registry.get(entity_id).commands if self.hub.registry.get(entity_id) else ()):
                await self.hub.integrations.dispatch_command(entity_id, "play", {})
            await ton.einblenden(
                entity_id,
                int(action.get("volume", 30)),
                float(action.get("seconds", 8)),
            )
            return None

        log.warning("Unbekannter Musik-Schritt in '%s': %s", automation.alias, tat)
        return f"unbekannter Musik-Schritt «{tat or 'nichts'}»"

    async def _alle_pausieren(self) -> list[str]:
        """Überall Pause - nicht «aus»: Eine pausierte Box weiss noch, wo
        sie war."""
        from .entity import EntityKind

        gestoppt: list[str] = []
        for entity in self.hub.registry.all():
            if entity.kind != EntityKind.MEDIA_PLAYER or not entity.available:
                continue
            if "pause" not in entity.commands:
                continue
            if str(entity.state.get("state")) not in ("playing", "buffering"):
                continue
            try:
                await self.hub.integrations.dispatch_command(entity.id, "pause", {})
                gestoppt.append(entity.label)
            except Exception as err:
                log.debug("Pause auf %s ging nicht: %s", entity.id, err)
        return gestoppt

    async def _light(
        self,
        automation: Automation,
        action: dict[str, Any],
        ausloeser: str | None = None,
    ) -> str | None:
        """Licht einschalten – mit Helligkeit, Farbe und Weissanteil.

        Ein Bewegungslicht ist mehr als «an»: Nachts genügt ein gedämpftes
        Warmweiss, am trüben Nachmittag braucht es die volle Lampe. Der
        eine Schritt setzt beides in einem Zug, statt drei Aktionen
        hintereinanderzuhängen, zwischen denen die Lampe sichtbar
        umspringt.

        ``brightness: "adaptive"`` holt die Helligkeit aus dem Melder, der
        ausgelöst hat: siehe core/light.py, warum es dunkler statt heller
        wird, je dunkler es ist.
        """
        entity_id = str(action.get("entity_id") or "")
        entity = self.hub.registry.get(entity_id)
        if entity is None:
            log.warning(
                "Licht-Schritt in '%s': Gerät «%s» gibt es nicht",
                automation.alias,
                entity_id,
            )
            return None

        notiz: str | None = None
        helligkeit: float | None = None
        roh = action.get("brightness")
        if isinstance(roh, str) and roh.strip().lower() == "adaptive":
            lux = self._lux_for(automation, action, ausloeser)
            if lux is None:
                # Kein Messwert: Die Lampe geht trotzdem an - ein
                # Bewegungslicht, das wegen eines stummen Fühlers dunkel
                # bleibt, ist schlimmer als eines in Vorgabehelligkeit.
                notiz = "kein Helligkeitswert – Lampe ohne Vorgabe an"
            else:
                helligkeit = licht.brightness_from_lux(lux)
                notiz = f"{lux:.0f} lx → {helligkeit:.0f} %"
        elif roh is not None:
            try:
                helligkeit = max(0.0, min(100.0, float(roh)))
            except (TypeError, ValueError):
                helligkeit = None

        if helligkeit is not None and "set_brightness" in entity.commands:
            await self.hub.integrations.dispatch_command(
                entity_id, "set_brightness", {"brightness": helligkeit}
            )
        else:
            await self.hub.integrations.dispatch_command(entity_id, "turn_on", {})

        # Und wie lange sie an bleiben soll. Ohne diese Angabe brauchte ein
        # Bewegungslicht drei Schritte (an, warten, aus) - und der
        # Warte-Schritt hielt den ganzen Ablauf auf, sodass danach nichts
        # mehr kommen konnte, ohne mitzuwarten.
        nachlauf = _seconds(action.get("off_after"))
        if nachlauf > 0:
            self._plan_off(automation, entity_id, nachlauf)
            notiz = f"{notiz}, " if notiz else ""
            notiz = f"{notiz}danach {offset_label(nachlauf).removeprefix('nach ')} aus"

        # Farbe und Weissanteil erst danach: Die Lampe ist dann schon an,
        # und beides schliesst sich gegenseitig aus - wer eine Farbe
        # angibt, bekommt keine Farbtemperatur darübergebügelt.
        farbe = action.get("color")
        weiss = action.get("color_temp")
        if farbe and "set_color" in entity.commands:
            await self.hub.integrations.dispatch_command(
                entity_id, "set_color", {"color": str(farbe)}
            )
        elif weiss and "set_color_temp" in entity.commands:
            await self.hub.integrations.dispatch_command(
                entity_id, "set_color_temp", {"color_temp": float(weiss)}
            )
        return notiz

    def _lux_for(
        self,
        automation: Automation,
        action: dict[str, Any],
        ausloeser: str | None,
    ) -> float | None:
        """Die Umgebungshelligkeit, an die sich das Licht anpassen soll.

        In dieser Reihenfolge: das im Ablauf genannte Gerät (für von Hand
        geschriebene config.yaml), sonst der Melder, der gerade ausgelöst
        hat, sonst der erste Auslöser, der überhaupt Lux meldet. Ohne
        jeden Wert: None - der Aufrufer schaltet dann ohne Vorgabe ein.
        """
        kandidaten: list[str] = []
        genannt = action.get("lux_from")
        if isinstance(genannt, str) and genannt:
            kandidaten.append(genannt)
        if ausloeser:
            kandidaten.append(ausloeser)
        kandidaten.extend(licht.lux_sources(automation.triggers))

        for entity_id in kandidaten:
            entity = self.hub.registry.get(entity_id)
            if entity is None:
                continue
            wert = entity.state.get("illumination")
            if isinstance(wert, (int, float)):
                return float(wert)
        return None

    async def _toggle_all(
        self, automation: Automation, action: dict[str, Any]
    ) -> str | None:
        """Mehrere Geräte gemeinsam umschalten.

        Ein Wandtaster, der Eingang und Gang schaltet, schickte bisher zwei
        einzelne «umschalten» - aus «einer an, einer aus» wurde damit
        zuverlässig das Gegenteil. Hier entscheidet der gemeinsame Zustand
        (siehe core/light.py, common_target), und alle bekommen denselben
        Befehl.
        """
        ids = [str(entry) for entry in action.get("entity_ids") or [] if entry]
        if not ids:
            log.warning("«Gemeinsam umschalten» in '%s' ohne Geräte", automation.alias)
            return None
        entities = [(entity_id, self.hub.registry.get(entity_id)) for entity_id in ids]
        befehl = licht.common_target(
            [
                entity.state.get("state") if entity is not None else None
                for _entity_id, entity in entities
            ]
        )
        for entity_id, entity in entities:
            if entity is None:
                log.warning(
                    "«Gemeinsam umschalten» in '%s': Gerät «%s» gibt es nicht",
                    automation.alias,
                    entity_id,
                )
                continue
            # Wer den Befehl nicht kennt, wird übersprungen statt zum
            # Fehler zu werden - der Rest der Gruppe schaltet trotzdem.
            if befehl not in entity.commands:
                continue
            await self.hub.integrations.dispatch_command(entity_id, befehl, {})
        return "alle an" if befehl == "turn_on" else "alle aus"

    def _plan_off(self, automation: Automation, entity_id: str, seconds: float) -> None:
        """Die Lampe nach der Nachlaufzeit wieder ausschalten.

        Nebenher, nicht im Ablauf: Der Rest der Schritte läuft weiter,
        während die Lampe brennt. Ein «warten»-Schritt täte das nicht - er
        hielte alles auf, und ein zweiter Auslöser fände den Ablauf
        beschäftigt vor.

        Je Lampe genau ein Zeitgeber: Neue Bewegung während des Nachlaufs
        verlängert ihn. Zwei Zeitgeber nebeneinander hiessen, dass das
        Licht beim ersten ausgeht, obwohl gerade jemand im Flur steht.
        """
        laufend = self._nachlauf.pop(entity_id, None)
        if laufend is not None and not laufend[0].done():
            laufend[0].cancel()
        faellig = time.time() + seconds

        async def warten() -> None:
            await asyncio.sleep(seconds)
            entity = self.hub.registry.get(entity_id)
            if entity is None or str(entity.state.get("state")) != "on":
                # Jemand war schneller - dann gibt es nichts auszuschalten.
                return
            with as_source(automation_source(automation.id, automation.alias)):
                await self.hub.integrations.dispatch_command(entity_id, "turn_off", {})

        task = asyncio.create_task(warten())
        self._nachlauf[entity_id] = (task, faellig)
        self._run_tasks.add(task)
        task.add_done_callback(self._run_tasks.discard)
        task.add_done_callback(
            lambda done, key=entity_id: self._nachlauf.pop(key, None)
            if (self._nachlauf.get(key) or (None,))[0] is done
            else None
        )

    def _merke_nachlaeufe(self) -> None:
        """Offene Nachläufe über den Halt retten.

        Ohne das bliebe nach jeder Auslieferung irgendwo ein Licht an, bis
        es jemand bemerkt - genau der Fall, für den es die Nachhol-Liste
        schon gibt. Der Eintrag trägt einen eigenen Schlüssel, damit er
        einem offenen Rest desselben Ablaufs nicht in die Quere kommt.
        """
        if not self._nachlauf:
            return
        offen = [
            eintrag
            for eintrag in self.hub.data.get(PENDING_KEY)
            if not str(eintrag.get("automation_id") or "").startswith("nachlauf:")
        ]
        for entity_id, (_task, faellig) in self._nachlauf.items():
            offen.append(
                {
                    "automation_id": f"nachlauf:{entity_id}",
                    "alias": f"Nachlauf {entity_id}",
                    "actions": [
                        {
                            "type": "command",
                            "entity_id": entity_id,
                            "command": "turn_off",
                        }
                    ],
                    "resume_at": faellig,
                }
            )
        try:
            self.hub.data.set(PENDING_KEY, offen[:PENDING_LIMIT])
        except Exception:
            log.debug("Offener Nachlauf nicht schreibbar", exc_info=True)

    async def _fade(self, automation: Automation, action: dict[str, Any]) -> None:
        """Weiches Licht (Punkt 157): über n Minuten von jetzt zum Ziel.

        Es gab «schalten» und «warten», aber kein «weich»: Licht, das
        abends im Kinderzimmer ausglimmt statt zu knipsen - und das
        Aufwachlicht eine halbe Stunde vor dem Wecker.
        """
        entity_id = str(action.get("entity_id") or "")
        entity = self.hub.registry.get(entity_id)
        if entity is None:
            log.warning(
                "Dimm-Schritt in '%s': Gerät «%s» gibt es nicht",
                automation.alias,
                entity_id,
            )
            return
        try:
            nach = max(0.0, min(100.0, float(action.get("to") or 0)))
            minuten = float(action.get("minutes") or 1)
        except (TypeError, ValueError):
            return
        von = entity.state.get("brightness")
        if von is None:
            von = 100.0 if entity.state.get("state") == "on" else 0.0
        von = float(von)
        if entity.state.get("state") != "on" and nach > 0:
            # Aufwachlicht: erst ganz dunkel stellen, dann einschalten -
            # umgekehrt blitzte die Lampe kurz mit der alten Helligkeit auf.
            von = 0.0
            await self.hub.integrations.dispatch_command(
                entity_id, "set_brightness", {"brightness": 1}
            )
            await self.hub.integrations.dispatch_command(entity_id, "turn_on", {})
        werte, pause = fade_plan(von, nach, minuten)
        for wert in werte:
            if wert > 0:
                await self.hub.integrations.dispatch_command(
                    entity_id, "set_brightness", {"brightness": wert}
                )
            await asyncio.sleep(pause)
        if nach <= 0:
            await self.hub.integrations.dispatch_command(entity_id, "turn_off", {})

    async def _wait_until(self, automation: Automation, action: dict[str, Any]) -> str:
        """Warten, bis eine Bedingung zutrifft – statt auf gut Glück lange
        genug zu warten.

        «Erst scharf schalten, wenn die Tür zu ist» liess sich bisher nur
        mit einer geschätzten Verzögerung nachbauen. Zu kurz gewählt
        scheitert die Aktion, zu lang ärgert sie.

        Die Frist ist Pflicht, nicht Kür: Ohne sie bliebe ein Ablauf für
        immer stehen, wenn die Tür offen bleibt – und blockierte damit
        auch jeden weiteren Lauf desselben Ablaufs.
        """
        timeout = float(action.get("timeout") or WAIT_TIMEOUT)
        start = time.monotonic()
        deadline = start + max(1.0, timeout)
        while True:
            if self._check_condition({**action, "type": action.get("wait_type", "state")}):
                # Für die Schritt-Spur (Punkt 160): DASS gewartet wurde,
                # sagt der Schritt - hier steht, wie lange wirklich.
                return f"erfüllt nach {round(time.monotonic() - start)} s"
            if time.monotonic() >= deadline:
                log.info(
                    "Automation '%s': Wartezeit abgelaufen, %s",
                    automation.alias,
                    describe_condition(action, self._value_of(action)),
                )
                return f"Frist abgelaufen ({timeout:.0f} s)"
            await asyncio.sleep(WAIT_POLL)

    async def _run_other(self, automation: Automation, action: dict[str, Any]) -> None:
        """Die Aktionen eines anderen Ablaufs mitausführen.

        Wozu: «Alles aus» steht in fünf Abläufen fast gleich - beim
        Weggehen, zur Nacht, beim Scharfschalten. Bisher musste man es
        kopieren und beim Ändern alle fünf anfassen. Jetzt ruft man den
        einen auf.

        Nur die Aktionen, nicht die Bedingungen des anderen: Wer ihn hier
        aufruft, hat sich entschieden. Dessen Bedingungen gelten für seine
        eigenen Auslöser, nicht für diesen Aufruf - alles andere wäre eine
        Falle, die man erst im Betrieb bemerkt.
        """
        ziel_id = str(action.get("automation_id") or action.get("automation") or "")
        ziel = next((a for a in self.automations if a.id == ziel_id), None)
        if ziel is None:
            log.warning(
                "Automation '%s' ruft '%s' auf - den gibt es nicht",
                automation.alias,
                ziel_id or "(ohne Kennung)",
            )
            return
        if ziel.id == automation.id:
            # Ein Ablauf, der sich selbst aufruft, läuft bis der Speicher
            # voll ist. Lieber hier abfangen als im Haus.
            log.warning("Automation '%s' ruft sich selbst auf - übersprungen", ziel.alias)
            return
        tiefe = self._depth.get(automation.id, 0)
        if tiefe >= CALL_DEPTH:
            # Zwei Abläufe, die einander rufen, tun das sonst endlos.
            log.warning(
                "Automation '%s': Aufrufkette zu tief (%d) - '%s' nicht ausgeführt",
                automation.alias,
                tiefe,
                ziel.alias,
            )
            return
        log.info("Automation '%s' führt '%s' mit aus", automation.alias, ziel.alias)
        self._depth[ziel.id] = tiefe + 1
        try:
            for weitere in ziel.actions:
                await self._execute_action(ziel, weitere)
        finally:
            self._depth.pop(ziel.id, None)

    async def _notify(
        self,
        automation: Automation,
        action: dict[str, Any],
        ausloeser: str | None = None,
    ) -> None:
        """Eine Push-Nachricht aus einem Ablauf.

        Text und Kamera dürfen sich auf den Auslöser beziehen: «Jemand
        weint im Zimmer {raum}» und «die Kamera, die ausgelöst hat» gelten
        damit für alle Kinderzimmer auf einmal. Vorher brauchte jede
        Kamera einen eigenen Ablauf mit eigenem Text - fünf Zimmer, fünf
        fast gleiche Abläufe, und beim Ändern findet man den fünften nie.
        """
        quelle = self.hub.registry.get(ausloeser or "") if ausloeser else None
        camera = str(action.get("camera") or "") or None
        if camera == kamera.TRIGGER:
            # «Die Kamera, die ausgelöst hat»: die Kamera selbst, sonst
            # eine im selben Raum. Findet sich keine, geht die Nachricht
            # ohne Bild raus statt gar nicht.
            camera = (
                kamera.camera_for(quelle, self.hub.registry.all())
                if quelle is not None
                else None
            )
        tokens = self.hub.push.recipients(
            self.hub.users.users,
            str(action.get("to", "all")),
            # Je Ablauf ein eigener Schalter im Profil: Wer die
            # Gefriertruhe nicht mehr gemeldet haben will, schaltete
            # früher «Jemand weint im Kinderzimmer» mit ab.
            push_service.automation_key(automation.id),
        )
        await self.hub.push.send(
            tokens,
            title=kamera.fill(action.get("title") or automation.alias, quelle),
            body=kamera.fill(action.get("body") or "", quelle),
            data={
                "automation_id": automation.id,
                **({"camera": camera} if camera else {}),
            },
            image=await self._snapshot_url(camera),
            # Dieselbe Kategorie wie oben: Ein Ablauf, der meldet, meldet
            # dringend - auch wenn er «Gefriertruhe» heisst.
            category=push_service.automation_key(automation.id),
        )

    async def _snapshot_url(self, camera: str | None) -> str | None:
        """Ein Standbild für die Nachricht selbst – etwa wer vor der Tür steht.

        Aufgenommen wird jetzt und nicht beim Anschauen: Der Besucher ist
        längst weg, bis jemand das Telefon aus der Tasche zieht.

        «Jetzt» heisst dabei nicht mehr «im Moment des Auslösers»: Kann
        die Kamera Personen erkennen, wartet der Hub im Hintergrund
        darauf, dass sie eine meldet, und nimmt das Bild von *dem*
        Moment. Die Nachricht selbst wartet nie – warum das geht, steht
        in ``core/personenbild.py``.
        """
        return await personenbild.bild_adresse(
            self.hub, camera, BILD_WARTEZEIT, "die Nachricht aus einem Ablauf"
        )
