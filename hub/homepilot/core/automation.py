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
  - {type: presence, person, event: "arrives"|"leaves", zone?}   # (252)
  - {type: weather_warning, min_severity?, entity_id?}   # neue Warnung (252)

Bedingungen:
  - {type: state, entity_id, attribute?: "state", equals? | above? | below?}
  - {type: time, after?: "HH:MM", before?: "HH:MM", weekdays?: [0..6],
     except_holidays?: true}   # Luzerner Feiertage, siehe feiertage.py (154)
  - {type: sun, state: "up"|"down"}   # steht die Sonne über dem Horizont?
  - {type: group, match: "any"|"all", conditions: [...]}  # und/oder geschachtelt

Aktionen:
  - {type: command, entity_id, command, data?}
  - {type: light, entity_id, brightness?, color?, color_temp?, off_after?,
     toggle?}   # «mach sie an, und zwar so» - toggle: brennt sie, geht sie aus
  - {type: delay, seconds}
  - {type: scene, scene} / {type: hue_scene, scene}
  - {type: music, do: favorite|sleep|pause_all|night|fade, …} – siehe docs/musik.md
  - {type: notify, title?, body?, to?, camera?}
  - {type: presence, zone, event: enter|leave}   # «X ist da» ohne Telefon
  - {type: wait_until, ...Bedingung, timeout?: sekunden}
  - {type: fade, entity_id, to: 0..100, minutes}   # weich dimmen (157)
  - {type: automation, automation_id}   # die Aktionen eines anderen mitausführen
  - {type: if, conditions, match?, then: [...], else?: [...]}   # (251)
  - {type: repeat, count, actions} / {type: repeat, while: [...],
     actions, max?}   # (251) - harte Obergrenze, siehe REPEAT_LIMIT

Nachrichtentexte (notify, broadcast) dürfen Platzhalter tragen:
``{entity_id}`` (Zustand), ``{entity_id.attribut}`` und ``{time}`` -
siehe core/platzhalter.py, Punkt 251.

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
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Any

from . import (
    abschaltung,
    astro,
    babysitter,
    bildarchiv,
    cliparchiv,
    feiertage,
    gemeldet,
    kamera,
    nachtruhe,
    personenbild,
    platzhalter,
    pushziel,
    schulferien,
    stromrueckkehr,
    terminkontext,
    verwaist,
    wirkung,
)
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

#: Länger als so lange wartet keine Nachricht auf sich - eine Meldung,
#: die eine Minute nach dem Ereignis kommt, ist keine Meldung mehr,
#: sondern ein Eintrag im Protokoll. Wer wirklich lange warten will,
#: nimmt einen «Warten»-Schritt davor: Der hält den ganzen Ablauf an und
#: sagt das auch.
MELDE_VERZOEGERUNG_MAX = 60.0


def notify_verzoegerung(action: dict[str, Any]) -> float:
    """Wie viele Sekunden diese Nachricht auf sich warten lässt (rein, testbar).

    Der Fall aus dem Haus: «Jemand hat die Türe im Highlight geöffnet» -
    mit einem Bild, auf dem niemand steht. Kein Fehler, sondern
    Reihenfolge: Der Türkontakt meldet, während die Person noch hinter
    der Türe ist. Fünf Sekunden später steht sie im Bild.

    Deshalb je Nachricht einstellbar und nicht fest: Bei der Türklingel
    wäre dieselbe Verzögerung ein Fehler - dort steht der Besucher schon
    da, und die Meldung soll sofort kommen.

    Unsinn (Text, negative Zahlen) zählt als «sofort»: Eine Nachricht,
    die wegen eines Tippfehlers gar nicht mehr käme, wäre der schlimmere
    Fall.
    """
    try:
        zahl = float(action.get("delay") or 0)
    except (TypeError, ValueError):
        return 0.0
    if zahl <= 0:
        return 0.0
    return min(zahl, MELDE_VERZOEGERUNG_MAX)


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
    # Nachts nichts melden: Nachricht und Durchsage bleiben zwischen 22
    # und 8 Uhr aus, der Rest des Ablaufs läuft weiter. Für das, was
    # ohnehin bis zum Morgen Zeit hat - «Geschirrspüler ist fertig» um
    # 03:25 weckt jemanden und ändert nichts.
    #
    # Bewusst am einzelnen Ablauf und nicht am ganzen Haus: «Jemand
    # weint im Kinderzimmer» ist genau die Nachricht, die nachts kommen
    # muss, und eine Nachtruhe für alle hätte sie mit verschluckt.
    quiet_night: bool = False
    # Die Stunden dazu (Punkt 379 der Werkbank) - None heisst «die
    # üblichen 22 bis 8», wie es das Wort «Nachtruhe» im Editor
    # verspricht. Eigene Stunden sind der Ausnahmefall: Wer früh
    # aufsteht und der Ablauf schon um sechs sprechen soll, ändert nur
    # diesen einen Ablauf, nicht die Nachtruhe des ganzen Hauses (die
    # hängt weiter fest an core/nachtruhe.py und bleibt für alle anderen
    # Stellen unverändert - Push-Ruhezeit etwa hat ihre eigene).
    quiet_from: int | None = None
    quiet_to: int | None = None
    # Restzeit anzeigen: Schaltet dieser Ablauf etwas nach einer
    # Wartezeit wieder aus, schreibt die Maschine den Zeitpunkt als
    # «off_at» an die betroffenen Geräte - und die App zeigt «geht in
    # 12 Min aus», auf der Kachel, in der Raumkarte und im
    # «Lichter an»-Blatt (core/abschaltung.py).
    #
    # Freiwillig und je Ablauf: Beim Treppenhauslicht will man es sehen,
    # bei der Anwesenheits-Simulation gerade nicht - die soll aussehen
    # wie ein Mensch, der das Licht löscht, und nicht wie eine Schaltuhr.
    countdown: bool = False
    # Bis wann dieser Ablauf überhaupt gilt (Punkt 464 der Werkbank) -
    # «YYYY-MM-DD», der Tag selbst zählt noch mit.
    #
    # Nicht dasselbe wie `quiet_until`: Das ist eine Pause, nach der es
    # weitergeht. Hier geht es nicht weiter - «bis Ende der Ferien»,
    # «nur diese Woche». Ohne dieses Feld schaltete man einen solchen
    # Ablauf ein und vergass ihn; der Ferienmodus (Punkt 156) löst es
    # für einen einzigen Fall, gebraucht wird es an jedem.
    #
    # Abgelaufen heisst nicht gelöscht: Der Hub schaltet ihn aus und
    # lässt ihn stehen - im nächsten Jahr braucht man ihn wieder.
    valid_until: str | None = None
    # In welcher Reihenfolge dieser Ablauf an die Reihe kommt, wenn
    # mehrere gleichzeitig dran sind (Punkt 466 der Werkbank). Kleiner
    # zuerst, bei Gleichstand nach Name.
    #
    # Vorher gab es die Frage gar nicht: Zwei Abläufe um 07:00 liefen in
    # der Reihenfolge, in der sie zufällig in der Liste standen. Das war
    # kein Verhalten, sondern ein Zufall - und auf einen Zufall verlässt
    # sich irgendwann jemand («erst Storen hoch, dann Kaffee»).
    order: int = 0

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
            "quiet_night": self.quiet_night,
            "quiet_from": self.quiet_from,
            "quiet_to": self.quiet_to,
            "countdown": self.countdown,
            "valid_until": self.valid_until,
            "order": self.order,
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
            "quiet_night": self.quiet_night,
            "quiet_from": self.quiet_from,
            "quiet_to": self.quiet_to,
            "countdown": self.countdown,
            "valid_until": self.valid_until,
            "order": self.order,
        }


# So viele Läufe merkt sich der Hub – genug, um einen Abend nachzuvollziehen.
RUN_LIMIT = 100

#: So lange nach einem Lauf wird nachgesehen, ob er gewirkt hat. Die
#: Geräte melden ihren neuen Zustand über ihren eigenen Weg zurück -
#: sofort danach steht dort noch der alte, und jeder Lauf sähe
#: wirkungslos aus.
WIRKUNG_NACH = 6.0

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

# Wie tief sich «wenn» und «wiederholen» ineinander stecken dürfen
# (Punkt 251 der Werkbank). Dieselbe Überlegung wie bei CALL_DEPTH: Drei
# Ebenen decken jeden Fall, den jemand noch lesen kann - alles darüber
# ist ein Versehen, das sich sonst endlos selbst frisst.
NEST_DEPTH = 3

# Wie oft ein «wiederholen»-Schritt höchstens dreht (Punkt 251). Die
# Grenze ist hart und gilt auch für `while`-Schleifen mit eigener
# `max`-Angabe: Eine Bedingung, die nie kippt (der Sensor ist tot, die
# Türe bleibt offen), liefe sonst für immer - und blockierte mit `mode:
# single` gleich noch jeden weiteren Lauf desselben Ablaufs.
REPEAT_LIMIT = 50

# Wie oft der Motor nach verwaisten Abläufen sieht (Punkt 262). Sechs
# Stunden sind bewusst grob: Verwaist wird man über Monate, nicht über
# Mittag - und der Sammel-Hinweis ist ohnehin auf einmal im Monat
# gedeckelt (gemeldet.py-Marke, siehe _verwaiste_pruefen).
VERWAIST_TAKT = 6 * 3600

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


def stolpersatz(gestolpert: list[tuple[str, str]], gesamt: int) -> str:
    """Was von einem Lauf mit hängenden Schritten übrig bleibt (rein, testbar).

    Der Satz muss zwei Dinge sagen, und das zweite ist das wichtigere:
    *welcher* Schritt hing - und dass der Rest trotzdem gelaufen ist.
    Vorher stand am Ablauf nur «Fehlgeschlagen: Failed to execute
    pause.» Daran liess sich weder ablesen, welche der sechzig Boxen es
    war, noch ob die Türe danach noch abgeschlossen hat.
    """
    anzahl = len(gestolpert)
    if anzahl == 0:
        return ""
    erster, meldung = gestolpert[0]
    kopf = (
        f"{erster}: {meldung}"
        if anzahl == 1
        else f"{anzahl} von {gesamt} Schritten hingen, zuerst {erster}: {meldung}"
    )
    return f"{kopf} Der Rest lief durch."


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
            teile.append("an die Raumhelligkeit angepasst")
        elif isinstance(helligkeit, str) and helligkeit.lower() == "tageszeit":
            teile.append("nach Tageszeit")
        elif helligkeit is not None:
            teile.append(f"{helligkeit} %")
        if action.get("color"):
            teile.append(f"Farbe {action['color']}")
        if action.get("color_temp"):
            teile.append(f"{round(1_000_000 / float(action['color_temp']))} K")
        wie = ", ".join(teile) if teile else "an"
        # «umschalten» ist eine andere Zusage als «an»: Brennt die Lampe,
        # geht sie aus - und dann gilt nichts von dem, was daneben steht.
        if action.get("toggle"):
            wie = f"umschalten, beim Einschalten {wie}" if teile else "umschalten"
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
        wartet = notify_verzoegerung(action)
        spaeter = f", {wartet:g} s später" if wartet else ""
        return (
            f"Nachricht an {wer}: «{action.get('title') or action.get('body') or ''}»"
            f"{bild}{spaeter}"
        )
    if atype == "presence":
        richtung = str(action.get("event") or "enter").strip().lower()
        wohin = "weg" if richtung in ("leave", "left", "exit", "away", "out") else "zuhause"
        return f"{action.get('zone') or '?'} gilt als {wohin}"
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
    if atype == "if":
        # Der Trockenlauf zählt nicht bloss («2 Schritte»), er zeigt die
        # Zweige - sonst weiss man erst im Betrieb, was «sonst» tut.
        dann = "; ".join(
            describe_action(a, name_of) for a in action.get("then") or []
        )
        sonst = "; ".join(
            describe_action(a, name_of) for a in action.get("else") or []
        )
        conds = [c for c in action.get("conditions") or [] if isinstance(c, dict)]
        art = "eine genügt" if str(action.get("match", "all")) == "any" else "alle"
        satz = f"wenn {len(conds)} Bedingung(en) ({art}): {dann or 'nichts'}"
        return f"{satz} – sonst: {sonst}" if sonst else satz
    if atype == "repeat":
        drin = "; ".join(
            describe_action(a, name_of) for a in action.get("actions") or []
        )
        if action.get("while") is not None:
            grenze = parse_repeat_count(action.get("max") or REPEAT_LIMIT)
            conds = [c for c in action.get("while") or [] if isinstance(c, dict)]
            return (
                f"solange {len(conds)} Bedingung(en) gelten "
                f"(höchstens {grenze}-mal): {drin or 'nichts'}"
            )
        return f"{parse_repeat_count(action.get('count'))}-mal: {drin or 'nichts'}"
    return f"unbekannte Aktion «{atype}»"


def letzter_lauf(
    runs: list[dict[str, Any]], automation_id: str
) -> dict[str, Any] | None:
    """Der jüngste Lauf dieses Ablaufs - oder None (rein, testbar).

    Die Liste steht jüngste zuerst; gesucht wird der erste Treffer. None
    heisst «seit dem Anlegen nie ausgelöst» - und das ist eine eigene
    Auskunft, nicht dasselbe wie «lief und tat nichts». Wer einen Ablauf
    baut, der stumm bleibt, will genau diesen Unterschied wissen: Kam
    der Auslöser nicht, oder stand eine Bedingung im Weg?
    """
    for run in runs:
        if run.get("automation_id") == automation_id:
            return run
    return None


#: Was ein Musik-Schritt tun kann. Der Schlüssel steht in `do`.
MUSIK_TATEN = ("favorite", "sleep", "pause_all", "night", "fade", "follow")


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
    if tat == "follow":
        return (
            f"Musik von {named(action.get('entity_id'))} nach "
            f"{named(action.get('target'))} mitnehmen"
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


def describe_condition(
    condition: dict[str, Any], value: Any, ferien_name: str | None = None
) -> str:
    """Warum eine Bedingung nicht passte, in einem Satz (rein, testbar).

    «Bedingung 2 war falsch» hilft niemandem. «Helligkeit war 44, verlangt
    ist unter 30» beantwortet die Frage sofort.

    ``ferien_name`` kommt von aussen herein (Punkt 470): Die Ferientermine
    liegen in der Ablage des Hubs, und diese Funktion soll rein bleiben.
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
        if condition.get("except_school_holidays") and ferien_name:
            return f"Heute sind Schulferien ({ferien_name})"
        window = " bis ".join(
            part for part in (condition.get("after"), condition.get("before")) if part
        )
        return f"Uhrzeit ausserhalb {window or '(kein Fenster)'}"
    if ctype == "sun":
        want = "Tag" if str(condition.get("state", "up")) == "up" else "Nacht"
        return f"Es ist nicht {want}"
    if ctype == "presence":
        wer = condition.get("person") or "die Person"
        zone = str(condition.get("zone") or "home")
        ort = "zuhause" if zone == "home" else f"in «{zone}»"
        if str(condition.get("state", "present")) == "absent":
            return f"{wer} ist {ort} - verlangt ist abwesend"
        return f"{wer} ist nicht {ort}"
    if ctype == "availability":
        name = condition.get("entity_id", "Gerät")
        if condition.get("available", True):
            return f"{name} meldet sich nicht"
        return f"{name} ist erreichbar - verlangt ist «meldet sich nicht»"
    if ctype == "weather_warning":
        stufe = condition.get("min_severity")
        ab = f" ab Stufe {stufe}" if stufe else ""
        if condition.get("active", True):
            return f"Keine Wetterwarnung{ab} läuft"
        return f"Eine Wetterwarnung{ab} läuft - verlangt ist keine"
    if ctype == "calendar":
        wort = condition.get("contains")
        was = f"Termin «{wort}»" if wort else "Termin"
        if condition.get("active", True):
            return f"Kein {was} läuft gerade"
        return f"Ein {was} läuft gerade - verlangt ist keiner"
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


def trigger_wort(
    triggers: list[dict[str, Any]], ausloeser_label: str | None
) -> str | None:
    """Was diesen Lauf angestossen hat, in einem Wort (rein, testbar).

    Am liebsten das Gerät, dessen Meldung kam - «Bewegung Flur» ist die
    Antwort, nach der man sucht. Ohne Gerät bleibt die Uhrzeit, sofern
    der Ablauf nur einen einzigen Auslöser hat: Bei zweien wüsste
    niemand, welcher es war, und ein geratener Auslöser ist schlimmer
    als keiner. Dann steht am Gerät weiterhin nur der Ablauf.
    """
    if ausloeser_label:
        return ausloeser_label
    if len(triggers) != 1:
        return None
    einzig = triggers[0]
    typ = str(einzig.get("type") or "")
    if typ == "time" and einzig.get("at"):
        return f"um {einzig['at']}"
    if typ == "sun":
        wann = str(einzig.get("event") or einzig.get("state") or "")
        return "Sonnenaufgang" if wann in ("sunrise", "up") else "Sonnenuntergang"
    return None


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
    erreichbar: bool | None = None,
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
    if art == "presence":
        return {
            "type": art,
            "ok": True,
            "hinweis": (
                "Anwesenheits-Auslöser – er feuert beim Kommen oder Gehen "
                "der Person, nicht auf einen Dauerzustand."
            ),
        }
    if art == "weather_warning":
        return {
            "type": art,
            "ok": True,
            "hinweis": (
                "Wetterwarnungs-Auslöser – er feuert, wenn eine neue "
                "Warnung eintrifft (integrations/meteoalarm.py)."
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
        if erreichbar:
            # Die Entität gibt es, sie ist erreichbar - sie hatte nur
            # noch nichts zu melden. Das ist bei manchen der Normalfall:
            # «Jemand zuhause» meldet nur echte Wechsel, und solange seit
            # dem Hub-Start niemand ging oder kam, herrscht zu Recht
            # Stille. Daraus «Gerät kaputt?» zu machen, schickte die
            # Leute auf eine Fehlersuche ohne Fehler.
            hinweis = (
                f"«{entity_id}» ist da und steht auf «{wert}» - seit dem "
                "Hub-Start gab es nur noch keinen Wechsel. Der Auslöser "
                "feuert beim nächsten."
            )
            ok = True
        else:
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


def parse_repeat_count(value: Any, maximum: int = REPEAT_LIMIT) -> int:
    """Wie oft ein «wiederholen»-Schritt drehen soll (rein, testbar).

    Unsinn und Negatives heisst null - ein Tippfehler soll den Schritt
    stumm machen, nicht fünfzigmal die Storen fahren. Nach oben deckelt
    REPEAT_LIMIT auch eine ausdrücklich grössere Angabe: Die Grenze
    schützt vor Endlosschleifen, und eine Grenze mit Ausnahme ist keine.
    """
    try:
        anzahl = int(float(value))
    except (TypeError, ValueError):
        return 0
    return max(0, min(int(maximum), anzahl))


def person_matches(person: str, entity_id: str, label: str) -> bool:
    """Meint dieser Auslöser diese Anwesenheits-Zone? (rein, testbar)

    Erlaubt sind die Zonenkennung («livia»), die volle Entitäts-Kennung
    («geofence.livia») und der Name («Livia Gross» oder nur «Livia») -
    dieselbe Grosszügigkeit wie beim Zusammenführen der Zonen
    (presence.zone_fuer): Wer den Auslöser in der App baut, tippt den
    Namen, wie er ihn kennt, und soll nicht raten müssen, wie die
    Kennung intern heisst.
    """
    gesucht = " ".join(str(person or "").split()).casefold()
    if not gesucht:
        return False
    if gesucht == str(entity_id or "").casefold():
        return True
    kennung = str(entity_id or "").rsplit(".", 1)[-1].casefold()
    if gesucht == kennung:
        return True
    name = " ".join(str(label or "").split()).casefold()
    if not name:
        return False
    return name == gesucht or name.split(" ")[0] == gesucht


def presence_trigger_matches(trigger: dict[str, Any], data: dict[str, Any]) -> bool:
    """Ist diese Zustandsmeldung das gesuchte Kommen oder Gehen?

    (rein, testbar) - Punkt 252 der Werkbank.

    Der Auslöser hängt an derselben Quelle wie die «Livia ist
    angekommen»-Nachrichten (Punkt 199): an den Zonen-Entitäten der
    Geofence-Integration, die jede Meldung ohnehin als state_changed
    auf den Bus legt. Kein eigenes Polling - eine zweite Uhr, die
    dieselbe Frage stellt, gäbe früher oder später eine zweite Antwort.

    Ein leerer oder unbekannter Vorzustand zählt nicht als Ankunft -
    dieselbe Regel wie bei den Nachrichten (geofence._sagen): Nach einem
    Neustart melden alle Telefone einmal, und das wäre sonst eine
    Ankunftswelle für Leute, die längst dasitzen.
    """
    new_state = data.get("new_state") or {}
    if str(new_state.get("device_class") or "") != "presence":
        return False
    entity = data.get("entity") or {}
    if not person_matches(
        str(trigger.get("person") or ""),
        str(data.get("entity_id") or ""),
        str(entity.get("name") or ""),
    ):
        return False
    alt = str((data.get("old_state") or {}).get("state") or "")
    neu = str(new_state.get("state") or "")
    if not alt or alt == "unknown" or alt == neu:
        return False
    # Ohne Zonenangabe zählt das Zuhause - «kommt an» heisst im Alltag
    # «kommt heim». Ein benannter Ort («schule») ist als Zustand selbst
    # sichtbar und lässt sich genauso abfragen.
    zone = str(trigger.get("zone") or "home").strip().lower()
    event = str(trigger.get("event") or "arrives").strip().lower()
    if event in ("leaves", "leave", "left", "exit", "geht"):
        return alt == zone and neu != zone
    return neu == zone and alt != zone


#: Die Warnstufen von MeteoAlarm, schwächste zuerst - dieselbe Reihe wie
#: in integrations/meteoalarm.py. Bewusst hier noch einmal: Der Kern darf
#: nicht von einer Integration importieren, sonst hängt jeder Ablauf an
#: deren Abhängigkeiten.
WARNSTUFEN = ("Minor", "Moderate", "Severe", "Extreme")


def warnungs_schluessel(alert: dict[str, Any]) -> str:
    """Woran eine Warnung wiederzuerkennen ist (rein, testbar).

    Titel, Ereignis und Beginn zusammen: Eine Warnung, die bei jeder
    Feed-Runde erneut in der Liste steht, bleibt dieselbe - eine mit
    neuem Beginn oder anderem Ereignis ist eine neue.
    """
    return "|".join(
        str(alert.get(feld) or "") for feld in ("title", "event", "onset")
    )


def neue_warnungen(
    old_state: dict[str, Any],
    new_state: dict[str, Any],
    min_severity: Any = None,
) -> list[dict[str, Any]]:
    """Welche Wetterwarnungen sind eben NEU dazugekommen? (rein, testbar)

    Punkt 252 der Werkbank. Verglichen werden die Warnlisten am
    Alert-Gerät (integrations/meteoalarm.py legt sie dort ab) - der
    Auslöser feuert nur für Warnungen, die vorher nicht da waren, nicht
    bei jeder Feed-Runde erneut.

    ``min_severity`` filtert nach der Stufe. Eine Warnung ohne Stufe und
    eine unlesbare Schwelle zählen mit statt wegzufallen: Bei
    Unwetterwarnungen ist «eine zu viel» der billigere Fehler als «eine
    unterschlagene» - dieselbe Haltung wie beim Gebietsfilter des Feeds.
    """
    bekannt = {
        warnungs_schluessel(alert)
        for alert in old_state.get("alerts") or []
        if isinstance(alert, dict)
    }
    schwelle = None
    if min_severity is not None:
        wort = str(min_severity).strip().capitalize()
        schwelle = WARNSTUFEN.index(wort) if wort in WARNSTUFEN else None
    neu: list[dict[str, Any]] = []
    for alert in new_state.get("alerts") or []:
        if not isinstance(alert, dict):
            continue
        if warnungs_schluessel(alert) in bekannt:
            continue
        if schwelle is not None:
            stufe = str(alert.get("severity") or "")
            if stufe in WARNSTUFEN and WARNSTUFEN.index(stufe) < schwelle:
                continue
        neu.append(alert)
    return neu


def standbild_meta(automation: Automation, entity: Any, jetzt: float) -> dict[str, Any]:
    """Die Metadaten für das Standbild eines Kamera-Auslösers (rein, testbar).

    Dieselbe Bauart wie beim Alarm (integrations/alarm.py): Das Bild liegt
    im Bildarchiv neben der Datendatei, mit derselben Frist wie die
    Alarm-Clips. Zusätzlich trägt der Eintrag die Kennung des Ablaufs,
    damit das Ereignisblatt ein Ablauf-Bild von einem Alarm-Bild
    unterscheiden kann.
    """
    meta = cliparchiv.eintrag(
        cliparchiv.neue_kennung(jetzt),
        entity.id,
        f"Ablauf «{automation.alias}»",
        jetzt,
        name=entity.label,
        room=entity.room,
        integration=entity.integration,
    )
    meta["automation_id"] = automation.id
    return meta


def warnung_aktiv(state: dict[str, Any], min_severity: Any = None) -> bool:
    """Läuft am Warn-Gerät gerade eine Wetterwarnung? (rein, testbar)

    Die Bedingung zum Auslöser aus Punkt 252: Der Auslöser feuert, wenn
    eine Warnung *neu* kommt - «Storen nicht hochfahren, solange eine
    Sturmwarnung läuft» braucht aber den Dauerzustand. Dieselbe
    Stufenregel wie bei neue_warnungen: ohne lesbare Schwelle zählt
    jede Warnung.
    """
    schwelle = None
    if min_severity is not None:
        wort = str(min_severity).strip().capitalize()
        schwelle = WARNSTUFEN.index(wort) if wort in WARNSTUFEN else None
    for alert in state.get("alerts") or []:
        if not isinstance(alert, dict):
            continue
        if schwelle is not None:
            stufe = str(alert.get("severity") or "")
            if stufe in WARNSTUFEN and WARNSTUFEN.index(stufe) < schwelle:
                continue
        return True
    return False


def termin_laeuft(events: list[dict[str, Any]], contains: str, jetzt: datetime) -> bool:
    """Läuft gerade ein Termin, dessen Titel das Wort trägt? (rein, testbar)

    Die Bedingung zum Kalender-Auslöser (Punkt 153): Der feuert am
    Beginn - «nur wenn gerade ‹Homeoffice› im Kalender steht» will den
    laufenden Termin. Ganztägige Termine ohne Uhrzeit zählen den ganzen
    Tag; ein Termin ohne Ende gilt bis Mitternacht.
    """
    needle = contains.strip().lower()
    for event in events or []:
        summary = str(event.get("summary") or "")
        if needle and needle not in summary.lower():
            continue
        start, ende = event.get("start"), event.get("end")
        if not start:
            continue
        try:
            von = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
            bis = (
                datetime.fromisoformat(str(ende).replace("Z", "+00:00"))
                if ende
                else von.replace(hour=23, minute=59, second=59)
            )
        except ValueError:
            continue
        if von.tzinfo is not None:
            von = von.astimezone().replace(tzinfo=None)
        if bis.tzinfo is not None:
            bis = bis.astimezone().replace(tzinfo=None)
        if von <= jetzt < bis:
            return True
    return False


def zeitfenster_bedingungen(triggers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Die stillen Zeitbedingungen aus «Zeitraum»-Auslösern (rein, testbar).

    Ein Auslöser vom Typ ``window`` feuert zu Beginn seines Fensters wie
    ein Zeit-Auslöser - und sagt zugleich, dass der Ablauf nur *in*
    diesem Fenster laufen soll. Bisher brauchte das zwei Bausteine, die
    dieselben zwei Uhrzeiten trugen: einen Zeit-Auslöser und eine
    Zeit-Bedingung. Wer eine änderte und die andere vergass, hatte einen
    Ablauf, der um sieben feuert und um sieben nicht darf.
    """
    fenster: list[dict[str, Any]] = []
    for trigger in triggers:
        if trigger.get("type") != "window":
            continue
        bedingung: dict[str, Any] = {"type": "time"}
        if trigger.get("after"):
            bedingung["after"] = str(trigger["after"])
        if trigger.get("before"):
            bedingung["before"] = str(trigger["before"])
        if trigger.get("weekdays"):
            bedingung["weekdays"] = trigger["weekdays"]
        fenster.append(bedingung)
    return fenster


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
                quiet_night=bool(config.get("quiet_night")),
                quiet_from=parse_stunde(config.get("quiet_from")),
                quiet_to=parse_stunde(config.get("quiet_to")),
                countdown=bool(config.get("countdown")),
                valid_until=parse_gueltig_bis(config.get("valid_until")),
                order=parse_order(config.get("order")),
            )
        )
    return automations


def parse_gueltig_bis(value: Any) -> str | None:
    """Bis wann dieser Ablauf gilt, eingelesen (rein, testbar) - Punkt 464.

    Nur ein echtes Datum bleibt stehen; alles andere wird None, also
    «unbefristet». Geklemmt wird nicht: Ein falsch getipptes Datum soll
    nicht dazu führen, dass ein Ablauf ab morgen schweigt - das wäre
    genau die Art stiller Ausfall, gegen die es die Befristung gibt.
    """
    text = str(value or "").strip()[:10]
    if not text:
        return None
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def parse_order(value: Any) -> int:
    """Die Reihenfolge-Zahl (rein, testbar) - Punkt 466 der Werkbank.

    Geklemmt auf -99 bis 99: mehr Spielraum, als ein Haushalt je
    braucht, und es schliesst die Zahl aus, die sich jemand zum
    Sortieren von etwas anderem ausgedacht hat. Unlesbares wird 0 - die
    Mitte, also «egal», und das ist bei fast allen Abläufen die Wahrheit.
    """
    try:
        zahl = int(value)
    except (TypeError, ValueError):
        return 0
    return max(-99, min(99, zahl))


def abgelaufen(automation: Automation, heute: date) -> bool:
    """Ist die Frist dieses Ablaufs vorbei? (rein, testbar) - Punkt 464.

    Der letzte Tag zählt noch mit, wie bei den Gutscheinen: «gültig bis
    30.06.» heisst am 30.06. noch gültig.
    """
    if not automation.valid_until:
        return False
    try:
        return date.fromisoformat(automation.valid_until) < heute
    except ValueError:
        return False


def nach_reihenfolge(automations: list[Automation]) -> list[Automation]:
    """Die Abläufe in der Reihenfolge, in der sie drankommen (rein,
    testbar) - Punkt 466 der Werkbank.

    Kleine Zahl zuerst, bei Gleichstand nach Name, zuletzt nach Kennung.
    Der Name als zweites Kriterium und nicht die Listenreihenfolge: Die
    ändert sich beim Bearbeiten, und dann liefe dasselbe Haus morgen
    anders herum als heute, ohne dass jemand etwas an der Reihenfolge
    geändert hätte.
    """
    return sorted(automations, key=lambda a: (a.order, a.alias.lower(), a.id))



def parse_stunde(value: Any) -> int | None:
    """Eine Stunde 0-23 (rein, testbar) - für die eigenen Nachtruhe-
    Stunden eines Ablaufs (Punkt 379 der Werkbank). Alles ausserhalb
    davon wird None, nicht geklemmt: Eine falsch getippte Stunde soll auf
    die Vorgabe (22-8) zurückfallen, nicht still auf 0 oder 23 rutschen.
    """
    try:
        stunde = int(value)
    except (TypeError, ValueError):
        return None
    return stunde if 0 <= stunde <= 23 else None


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


def konflikte_mit(entwurf: Any, andere: list[Any]) -> list[dict[str, Any]]:
    """Womit dieser eine Ablauf sich beisst (rein, testbar) - Punkt 462.

    `find_conflicts` sammelt alle Widersprüche des Hauses; gefragt ist
    hier nur der eine, der gerade entsteht. Bemerkt wurde er bisher erst
    in der Liste unter «Widersprüche» - also Tage später, an einem
    Licht, das flackert, und nicht in dem Moment, in dem man ihn baut.

    Der Ablauf mit derselben Kennung fällt raus: Beim Bearbeiten läge
    sonst die gespeicherte Fassung im Vergleich, und jeder Ablauf, der
    ein Gerät ein- *und* ausschaltet, widerspräche sich selbst.
    """
    eigene_id = str(getattr(entwurf, "id", "") or "")
    vergleich = [
        automation
        for automation in andere
        if str(getattr(automation, "id", "") or "") != eigene_id
    ]
    return [
        zeile
        for zeile in find_conflicts([entwurf, *vergleich])
        if any(teil["id"] == eigene_id for teil in zeile["automations"])
    ]


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
        # Nachrichten, die ein paar Sekunden auf sich warten lassen
        # (notify_verzoegerung). Sie laufen neben dem Ablauf weiter -
        # gehalten wird die Referenz nur, damit der Sammler sie nicht
        # mittendrin abräumt.
        self._spaetere_meldungen: set[asyncio.Task] = set()
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
        # Geräte mit angezeigter Restzeit: Kennung → (Zeitpunkt, wer
        # wartet). Der Eigentümer ist die wartende Aufgabe - endet sie,
        # räumt ihr Rückruf den Eintrag weg. Ohne diesen Besitz bliebe
        # nach einem abgebrochenen Lauf ein «geht in 12 Min aus» an einem
        # Licht stehen, das niemand mehr ausschaltet (core/abschaltung.py).
        self._abschaltungen: dict[str, tuple[float, asyncio.Task | None]] = {}
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
        # Wer von Hand abgebrochen wurde (Punkt 461). Ein Abbruch sieht
        # von innen aus wie der bei «restart» - und der gehört
        # ausdrücklich nicht ins Protokoll. Dieser hier schon: Er ist das
        # Einzige, was später erklärt, warum die Storen zu blieben.
        self._abgebrochen: set[str] = set()
        # Welcher Ablauf heute schon einmal als gestolpert gemeldet wurde
        # (Punkt 465): «<id>:<YYYY-MM-DD>». Ein totes Gerät macht sonst
        # aus jeder Bewegung im Flur eine Push-Nachricht.
        self._fehlschlag_gemeldet: set[str] = set()
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
        # Auch die Zeitgeber in fester Reihenfolge anlegen (Punkt 466):
        # Zwei Abläufe um 07:00 hängen an zwei Schlafenden, die in der
        # Reihenfolge geweckt werden, in der sie sich schlafen legten.
        for automation in nach_reihenfolge(self.automations):
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
                elif trigger.get("type") == "window" and trigger.get("after"):
                    # «Zeitraum»: feuert zu Beginn wie ein Zeit-Auslöser;
                    # dass der Ablauf nur im Fenster laufen darf, prüft
                    # _conditions_hold (zeitfenster_bedingungen).
                    task = asyncio.create_task(
                        self._time_loop(
                            automation, str(trigger["after"]), jitter_minutes(trigger)
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
                elif trigger.get("type") == "power_restore":
                    task = asyncio.create_task(
                        self._stromausfall_loop(automation, trigger)
                    )
                    self._timer_tasks.append(task)
        # Der eigene Takt des Motors: nach verwaisten Abläufen sehen
        # (Punkt 262). Hier und nicht im Wächter, weil der Motor seine
        # Abläufe kennt - der Wächter müsste sie sich erst geben lassen.
        self._timer_tasks.append(asyncio.create_task(self._verwaiste_loop()))
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
        # Die verzögerten Nachrichten gehen mit: Sie hängen an keinem
        # Durchgang mehr, und eine Meldung, die nach dem Neustart des
        # Hubs eintrifft, wäre älter als alles, was sie meldet.
        warten = [
            *self._timer_tasks,
            *self._run_tasks,
            *self._held_tasks.values(),
            *self._spaetere_meldungen,
        ]
        for task in warten:
            task.cancel()
        for task in warten:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._timer_tasks.clear()
        self._run_tasks.clear()
        self._held_tasks.clear()
        self._spaetere_meldungen.clear()
        # Sonst hielte die Zuordnung Ablauf → Durchgang nach dem Halt
        # abgebrochene Tasks fest.
        self._tasks_by_id.clear()

    # ── Trigger ────────────────────────────────────────────────────────────

    def _on_state_changed(self, _event_type: str, data: dict[str, Any]) -> None:
        jetzt = time.time()
        # Wer von Hand ausschaltet, hat die Restzeit beantwortet: Die
        # Anzeige muss weg, sonst steht «geht in 12 Min aus» an einem
        # längst dunklen Licht. Auch der Ablauf selbst kommt hier vorbei,
        # wenn er ausschaltet - einmal aufräumen genügt für beide Wege.
        entity_id = str(data.get("entity_id") or "")
        if entity_id in self._abschaltungen:
            neuer = (data.get("new_state") or {}).get("state")
            if neuer is not None and str(neuer) != "on":
                self._start_task(self._countdown_loeschen(entity_id))
        # In fester Reihenfolge (Punkt 466 der Werkbank): Zwei Abläufe am
        # selben Ereignis liefen bisher in der Reihenfolge, in der sie
        # zufällig in der Liste standen - kein Verhalten, sondern ein
        # Zufall, auf den sich irgendwann jemand verlässt.
        for automation in nach_reihenfolge(self.automations):
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
                if art == "presence":
                    # Punkt 252: Kommen und Gehen als Auslöser - an
                    # derselben Quelle wie die Ankunfts-Nachrichten (die
                    # Zonen-Entitäten des Geofence), nicht an einem
                    # eigenen Polling.
                    if presence_trigger_matches(trigger, data):
                        self._gefeuert[(automation.id, index)] = jetzt
                        self._schedule(
                            automation, str(data.get("entity_id") or "") or None
                        )
                        break
                    continue
                if art == "weather_warning":
                    # Punkt 252: Die Warnliste liegt als Zustand am
                    # Alert-Gerät (integrations/meteoalarm.py) - gefeuert
                    # wird nur für Warnungen, die eben NEU dazukamen,
                    # nicht bei jeder Feed-Runde erneut.
                    if trigger.get("entity_id") and trigger.get(
                        "entity_id"
                    ) != data.get("entity_id"):
                        continue
                    if neue_warnungen(
                        data.get("old_state") or {},
                        data.get("new_state") or {},
                        trigger.get("min_severity"),
                    ):
                        self._gefeuert[(automation.id, index)] = jetzt
                        self._schedule(
                            automation, str(data.get("entity_id") or "") or None
                        )
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

    def _ablauf_ziele(self, automation: Automation) -> list[str]:
        """Welche Geräte dieser Ablauf anfasst (für das Nachfassen).

        Nur die, die er beim Namen nennt - eine Szene oder eine
        Nachricht hat keine Adresse, auf deren Erreichbarkeit man warten
        könnte.
        """
        ids: list[str] = []
        for action in automation.actions:
            einzeln = action.get("entity_id")
            if einzeln:
                ids.append(str(einzeln))
            for entry in action.get("entity_ids") or []:
                if entry:
                    ids.append(str(entry))
        return ids

    async def _stromausfall_loop(
        self, automation: Automation, trigger: dict[str, Any]
    ) -> None:
        """«Nach Stromausfall»: einmal auslösen - und geduldig nachfassen.

        Der Ablauf läuft nur, wenn der Hub wirklich nach einem
        Stromausfall hochgefahren ist (core/stromrueckkehr.py); ein
        Update ist keiner.

        Und dann nicht ein einziges Mal: Ein Haus kommt nicht auf einmal
        zurück. Die Lampe hat Strom, lange bevor Switch, Accesspoint und
        Bridge wieder stehen - ein Befehl an sie verpufft, und sie
        brennt weiter. Also läuft der Ablauf erneut, sobald eines der
        fehlenden Geräte auftaucht. Erneut und nicht dauernd: Wer im
        Dunkeln von Hand Licht macht, während noch aufgeräumt wird, soll
        es behalten, solange nichts Neues dazukommt.
        """
        if not getattr(self.hub, "_kaltstart", False):
            return
        await asyncio.sleep(stromrueckkehr.wartezeit(trigger))
        schluss = time.monotonic() + stromrueckkehr.fenster(trigger)
        self._schedule(automation)
        ziele = self._ablauf_ziele(automation)
        fehlten = self._fehlende(ziele)
        while fehlten and time.monotonic() < schluss:
            await asyncio.sleep(stromrueckkehr.takt(trigger))
            jetzt = self._fehlende(ziele)
            if jetzt != fehlten:
                # Etwas ist aufgetaucht - der Ablauf bekommt seine
                # zweite Gelegenheit, jetzt mit mehr Geräten am Netz.
                self._schedule(automation)
                fehlten = jetzt

    def _fehlende(self, ziele: list[str]) -> set[str]:
        """Welche der Geräte gerade nicht erreichbar sind."""
        stand = []
        for entity_id in ziele:
            entity = self.hub.registry.get(entity_id)
            stand.append((entity_id, bool(entity and entity.available)))
        return stromrueckkehr.wer_fehlt(stand)

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
                    # Ob die Entität existiert und erreichbar ist,
                    # unterscheidet «kaputt» von «hatte nur nichts zu
                    # melden» - siehe describe_trigger_health.
                    erreichbar=entity is not None and entity.available,
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
        if babysitter.blocks(
            self.hub.data.get(babysitter.KEY), automation.id, time.time()
        ):
            log.info("Automation '%s' übersprungen (Babysitter-Modus)", automation.alias)
            self._note(
                automation,
                executed=False,
                error=None,
                skipped=["Babysitter-Modus"],
            )
            return
        # Befristet und vorbei (Punkt 464 der Werkbank). Vor `quiet_until`
        # geprüft, weil das eine Pause ist, nach der es weitergeht - hier
        # geht es nicht weiter. Der Ablauf bleibt stehen und wird nur
        # stumm; ausgeschaltet wird er einmal täglich (_fristen_loop),
        # damit die Liste ihn als «aus» zeigt statt als «läuft, tut aber
        # nichts».
        if abgelaufen(automation, date.today()):
            log.debug(
                "Automation '%s' übersprungen (Frist bis %s abgelaufen)",
                automation.alias,
                automation.valid_until,
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

    @property
    def laufend(self) -> set[str]:
        """Welche Abläufe gerade mitten in einem Durchgang stehen.

        Die App braucht das, um den Abbrechen-Knopf überhaupt zu zeigen
        (Punkt 461) - ein Knopf, der bei fast jedem Ablauf nichts tut,
        wäre schlimmer als keiner.
        """
        return {
            auto_id for auto_id, task in self._tasks_by_id.items() if not task.done()
        }

    def abbrechen(self, automation_id: str) -> bool:
        """Einen laufenden Durchgang abbrechen (Punkt 461 der Werkbank).

        «Gute Nacht» mit drei Wartezeiten läuft zwölf Minuten. Wer nach
        der ersten Minute merkt, dass noch jemand im Wohnzimmer sitzt,
        hatte bisher keinen Knopf - der Ablauf fuhr die Storen trotzdem.
        Die drei Wiederanlauf-Arten (single, restart, queued) regeln den
        *zweiten* Auslöser, nicht den Abbruch.

        Was schon geschaltet ist, bleibt geschaltet: Ein Abbruch nimmt
        die ersten Schritte nicht zurück. Das ist die ehrliche Grenze -
        ein Abbruch, der heimlich Licht wieder einschaltet, wäre ein
        zweiter Ablauf, den niemand gebaut hat.

        Die Warteschlange wird mit geleert: Wer abbricht, meint diesen
        Abend, nicht nur diese Sekunde - sonst begänne bei «queued»
        sofort der nächste aufgestaute Lauf.
        """
        task = self._tasks_by_id.get(automation_id)
        if task is None or task.done():
            return False
        self._queued.pop(automation_id, None)
        self._abgebrochen.add(automation_id)
        task.cancel()
        return True

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

        Der Lauf steht danach im Verlauf und ist als Probe gekennzeichnet.
        Vorher hinterliess er keine Spur: Eine halbe Stunde später war
        nicht mehr zu unterscheiden, ob das Licht wegen eines Tests
        anging oder von selbst - und genau danach sucht man, wenn etwas
        nicht stimmt. Welche Bedingungen dabei übergangen wurden, steht
        mit dabei; ein Test, der lief, obwohl der Ablauf im Alltag
        gestoppt worden wäre, ist nur die halbe Auskunft.
        """
        automation = next(
            (a for a in self.automations if a.id == automation_id), None
        )
        if automation is None:
            return False
        _erfuellt, offen = self._conditions_hold(automation)

        def name_of(entity_id: str) -> str:
            entity = self.hub.registry.get(entity_id)
            return entity.label if entity else entity_id

        # Wie beim regulären Lauf: Ein hängender Schritt hält den Rest
        # nicht an. Von Hand gestartet gilt das erst recht - man drückt,
        # steht daneben und will sehen, was durchkommt.
        gestolpert: list[tuple[str, str]] = []
        with as_source(automation_source(automation.id, automation.alias)):
            for position, action in enumerate(automation.actions):
                try:
                    # Auch der Probelauf zeigt die Restzeit: Wer den
                    # Testen-Knopf drückt, will genau sehen, was im Haus
                    # ankommt - und dazu gehört «geht in 12 Min aus».
                    self._countdown_planen(automation, automation.actions, position)
                    await self._execute_action(automation, action)
                except Exception as err:
                    gestolpert.append((describe_action(action, name_of), str(err)))
                    log.warning(
                        "Handstart '%s': ein Schritt hing (%s) - weiter",
                        automation.alias,
                        err,
                    )
        self._note(
            automation,
            executed=True,
            error=stolpersatz(gestolpert, len(automation.actions)) or None,
            skipped=offen,
            test=True,
        )
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
        # Schritte, die hingen: (Beschreibung, Fehlertext). Der Lauf geht
        # trotzdem weiter - siehe unten in der Schleife.
        gestolpert: list[tuple[str, str]] = []
        start_ts = time.time()
        # Löst eine Kamera aus, hält der Lauf den Moment fest (Punkt 510):
        # Das Bild wird jetzt angestossen, nicht erst nach den Schritten -
        # danach wäre die Person längst aus dem Bild.
        standbild = self._standbild_starten(automation, ausloeser)

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
                # Alles, was jetzt folgt, wird der Automation zugeschrieben -
                # samt Auslöser, damit am Gerät die ganze Kette steht:
                # Melder → Ablauf → Gerät (core/source.py).
                with as_source(
                    automation_source(
                        automation.id,
                        automation.alias,
                        trigger_wort(
                            automation.triggers,
                            name_of(ausloeser) if ausloeser else None,
                        ),
                    )
                ):
                    # Die Zählung wird nach der Schleife gebraucht, nicht
                    # darin - sie sagt im Abbruchfall, wo der Lauf stand.
                    # Deshalb unten die Ausnahme von B007.
                    for position, action in enumerate(actions):  # noqa: B007
                        notiz: str | None = None
                        schritt_fehler: str | None = None
                        # Vor der Wartezeit, nicht danach: Wer jetzt aufs
                        # Telefon schaut, will wissen, wie lange das Licht
                        # noch brennt (core/abschaltung.py).
                        self._countdown_planen(automation, actions, position)
                        try:
                            notiz = await self._execute_action(
                                automation, action, ausloeser
                            )
                        except Exception as err:
                            # Ein Schritt, der hängt, hält den Ablauf nicht
                            # mehr an.
                            #
                            # «Niemand mehr zuhause» stellt der Reihe nach
                            # sechzig Geräte ab und schliesst zuletzt die
                            # Türe. Eine Box, auf der gerade nichts lief,
                            # brachte den ganzen Lauf zum Stehen - die
                            # Wohnung blieb offen und unscharf, und im
                            # Protokoll stand nur «Fehlgeschlagen». Das ist
                            # die schlechteste aller Reihenfolgen: Der
                            # unwichtigste Schritt entscheidet über die
                            # wichtigsten.
                            #
                            # Dieselbe Haltung hatten einzelne Schritte
                            # schon für sich (ein Favorit, den es nicht
                            # mehr gibt, hielt nie an) - sie gilt jetzt für
                            # alle.
                            schritt_fehler = str(err)
                            gestolpert.append(
                                (describe_action(action, name_of), schritt_fehler)
                            )
                            log.warning(
                                "Automation '%s': Schritt %d hing (%s) - weiter",
                                automation.alias,
                                position + 1,
                                err,
                            )
                        if len(spur) < 40:
                            eintrag: dict[str, Any] = {
                                "label": describe_action(action, name_of),
                                "after": round(time.time() - start_ts, 1),
                            }
                            if notiz:
                                eintrag["note"] = notiz
                            if schritt_fehler:
                                eintrag["error"] = schritt_fehler
                            spur.append(eintrag)
                if gestolpert:
                    error = stolpersatz(gestolpert, len(actions))
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
            if automation.id in self._abgebrochen:
                self._abgebrochen.discard(automation.id)
                self._note(
                    automation,
                    executed=False,
                    error=None,
                    skipped=[f"Von Hand abgebrochen bei Schritt {position + 1}"],
                    steps=spur,
                )
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
        eintrag = self._note(
            automation,
            executed=executed,
            error=error,
            skipped=[] if executed else failed,
            steps=spur,
        )
        if standbild is not None:
            await self._standbild_anhaengen(eintrag, standbild)
        if executed and error is None:
            self._wirkung_planen(eintrag, actions)
        if executed and error is not None:
            await self._melde_fehlschlag(automation, error)
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

    async def _melde_fehlschlag(self, automation: Automation, fehler: str) -> None:
        """Sagen, dass ein Ablauf gestolpert ist (Punkt 465 der Werkbank).

        Bisher stand ein hängender Schritt im Lauf-Verlauf - und sonst
        nirgends. Ein «Gute Nacht», das zur Hälfte lief, ist schlechter
        als eines, das gar nicht lief: Man glaubt, das Haus sei zu.

        Drei Entscheidungen, die man im Betrieb merkt:

        - **Höchstens einmal am Tag je Ablauf.** Ein Gerät, das seit
          Wochen tot ist, macht aus jeder Bewegung im Flur eine
          Nachricht. Die erste ist die Auskunft, die dreissigste der
          Grund, die Kategorie abzubestellen - und dann kommt auch die
          nächste echte nicht mehr an.
        - **Kategorie «maintenance».** Dieselbe wie beim verwaisten
          Ablauf: Es ist kein Notfall, aber etwas, das jemand richten
          muss. Damit gilt auch die Ruhezeit dafür - um drei Uhr nachts
          ändert diese Nachricht nichts.
        - **Der Tipp führt in den Lauf-Verlauf.** Dort steht, welcher
          Schritt hing; die blosse Liste der Abläufe sagt es nicht.
        """
        heute = datetime.now().strftime("%Y-%m-%d")
        marke = f"{automation.id}:{heute}"
        if marke in self._fehlschlag_gemeldet:
            return
        self._fehlschlag_gemeldet.add(marke)
        tokens = self.hub.push.recipients(self.hub.users.users, "all", "maintenance")
        await self.hub.push.send(
            tokens,
            "Ablauf gestolpert",
            f"{automation.alias}: {fehler}",
            data={"ziel": f"ablauf:{automation.id}"},
            category="maintenance",
        )
    def _standbild_starten(
        self, automation: Automation, ausloeser: str | None
    ) -> asyncio.Task[str | None] | None:
        """Ein Standbild der auslösenden Kamera holen - nebenher.

        Nur wenn der Auslöser eine Kamera ist und es ein Archiv gibt
        (Tests und die Demo im Speicher haben keines). Das Holen läuft
        als eigene Aufgabe: Die Schritte des Ablaufs warten nicht auf
        eine Kamera, die vielleicht erst aufwachen muss.
        """
        from .entity import EntityKind

        if not ausloeser:
            return None
        entity = self.hub.registry.get(ausloeser)
        if entity is None or entity.kind != EntityKind.CAMERA:
            return None
        folder = bildarchiv.ordner(self.hub.config.data_file)
        integration = self.hub.integrations.get(entity.integration)
        if folder is None or integration is None:
            return None

        async def holen() -> str | None:
            try:
                daten = await asyncio.wait_for(integration.snapshot(entity), BILD_WARTEZEIT)
            except Exception as err:
                log.debug("Kein Standbild von %s für den Lauf: %s", entity.id, err)
                return None
            if not daten:
                return None
            abgelegt = bildarchiv.ablegen(
                folder, daten, standbild_meta(automation, entity, time.time())
            )
            return str(abgelegt["id"]) if abgelegt else None

        task = asyncio.create_task(holen())
        self._run_tasks.add(task)
        task.add_done_callback(self._run_tasks.discard)
        return task

    async def _standbild_anhaengen(
        self, eintrag: dict[str, Any], standbild: asyncio.Task[str | None]
    ) -> None:
        """Die Kennung des Standbilds an den Lauf hängen.

        Meist ist das Bild längst da, wenn die Schritte durch sind; dann
        steht es schon im ersten Abruf des Verlaufs. Wenn nicht, wird kurz
        gewartet - länger als die Kamera-Frist kann es nicht dauern - und
        sonst nachgetragen, sobald es kommt.
        """
        try:
            kennung = await asyncio.wait_for(asyncio.shield(standbild), BILD_WARTEZEIT)
        except TimeoutError:

            def nachtragen(task: asyncio.Task[str | None]) -> None:
                spaet = task.result() if not task.cancelled() and not task.exception() else None
                if spaet:
                    eintrag["image"] = spaet
                    self._verlauf_sichern()

            standbild.add_done_callback(nachtragen)
            return
        except Exception:
            return
        if kennung:
            eintrag["image"] = kennung
            self._verlauf_sichern()

    def _wirkung_planen(
        self, eintrag: dict[str, Any], actions: list[dict[str, Any]]
    ) -> None:
        """Ein paar Sekunden später nachsehen, ob der Lauf gewirkt hat.

        «Ausgeführt» heisst bisher nur: abgeschickt. Ein Funkbefehl, der
        nicht ankommt, sieht im Protokoll genauso aus wie einer, der das
        Licht einschaltet – und man sucht dann am falschen Ende.

        Warum nicht sofort: Die Geräte melden ihren neuen Zustand über
        ihren eigenen Weg zurück (Funk, Bridge, Cloud). Direkt nach dem
        Befehl steht dort noch der alte, und jeder Lauf sähe wirkungslos
        aus. Was sich nicht vorhersagen lässt, wird gar nicht erst
        geprüft (core/wirkung.py).
        """
        punkte = wirkung.pruefpunkte(actions)
        if not punkte or self._stopping:
            return

        async def nachsehen() -> None:
            await asyncio.sleep(WIRKUNG_NACH)
            stand = {
                entity.id: dict(entity.state) for entity in self.hub.registry.all()
            }
            ergebnis = wirkung.abgleich(punkte, stand)
            spruch = wirkung.urteil(ergebnis)
            if spruch is None:
                return
            eintrag["effect"] = {
                "urteil": spruch,
                "geprueft": len(ergebnis["ok"]) + len(ergebnis["fehlt"]),
                # Die Namen und nicht die Kennungen: Der Satz steht in der
                # App neben dem Lauf, und dort liest ihn ein Mensch.
                "nicht": [
                    entity.label
                    for entity in (
                        self.hub.registry.get(entity_id)
                        for entity_id in ergebnis["fehlt"]
                    )
                    if entity is not None
                ],
            }
            self._verlauf_sichern()

        task = asyncio.create_task(nachsehen())
        self._run_tasks.add(task)
        task.add_done_callback(self._run_tasks.discard)

    def _note(
        self,
        automation: Automation,
        *,
        executed: bool,
        error: str | None,
        skipped: list[str],
        steps: list[dict[str, Any]] | None = None,
        test: bool = False,
    ) -> dict[str, Any]:
        """Den Lauf ins Protokoll – und den Eintrag zurückgeben.

        Zurück kommt er, weil die Nachschau ihn ein paar Sekunden später
        ergänzt (``_wirkung_planen``): Ob der Befehl auch angekommen ist,
        weiss man erst dann.
        """
        eintrag: dict[str, Any] = {
            "automation_id": automation.id,
            "alias": automation.alias,
            "at": time.time(),
            "executed": executed,
            "error": error,
            "skipped": skipped,
            # Von Hand angestossen? Dann sagt der Verlauf das auch. Ein
            # Testlauf sieht sonst aus wie ein echter, und die Frage
            # «warum ging das Licht an?» führt in die Irre.
            "test": test,
            # Die Schritt-Spur (Punkt 160). Leer bei übersprungenen
            # Läufen - dort ist «skipped» die Auskunft.
            "steps": steps or [],
        }
        self.runs.insert(0, eintrag)
        del self.runs[RUN_LIMIT:]
        # Auch auf die Platte: Nach einem Neustart ist sonst genau die
        # Spur weg, der man nachgeht - «heute Nacht ging das Licht an, und
        # jetzt weiss niemand, warum».
        self._verlauf_sichern()
        # Das dauerhafte «zuletzt gefeuert» (Punkt 262). Nur echte Läufe:
        # Ein übersprungener Lauf («nie erfüllte Bedingung») ist genau
        # eine der Arten, verwaist zu sein, und der Testen-Knopf würde
        # die Uhr eines toten Ablaufs zurückstellen, ohne dass er je von
        # selbst gefeuert hätte.
        if executed and not test:
            self._feuer_merken(automation)
        return eintrag

    def _feuer_merken(self, automation: Automation) -> None:
        try:
            self.hub.data.set(
                verwaist.STORE_KEY,
                verwaist.merke_feuer(
                    self.hub.data.get(verwaist.STORE_KEY), automation.id, time.time()
                ),
            )
        except Exception:
            log.debug("«Zuletzt gefeuert» nicht schreibbar", exc_info=True)

    def _verlauf_sichern(self) -> None:
        try:
            self.hub.data.set("automation_runs", self.runs)
        except Exception:
            log.debug("Ablauf-Verlauf nicht schreibbar", exc_info=True)

    # ── Verwaiste Abläufe (Punkt 262) ──────────────────────────────────────
    #
    # Ein Ablauf, der seit Monaten nicht gefeuert hat (umbenanntes Gerät,
    # nie erfüllte Bedingung), ist meist tot - und Stille sieht wie Erfolg
    # aus. Das Rechnen steht in core/verwaist.py; hier hängt es am eigenen
    # Takt des Motors.

    async def _verwaiste_loop(self) -> None:
        while True:
            await asyncio.sleep(VERWAIST_TAKT)
            try:
                await self._verwaiste_pruefen()
            except asyncio.CancelledError:
                raise
            except Exception:
                # Der Takt läuft weiter: Eine kaputte Zeile in der Datei
                # darf die Prüfung von übermorgen nicht mitreissen.
                log.debug("Verwaisten-Prüfung fehlgeschlagen", exc_info=True)
            try:
                await self.fristen_pruefen()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.debug("Fristen-Prüfung fehlgeschlagen", exc_info=True)

    async def fristen_pruefen(self) -> list[Automation]:
        """Abgelaufene Abläufe ausschalten (Punkt 464 der Werkbank).

        Stumm wären sie schon (siehe `_schedule`); ausgeschaltet werden
        sie, weil die Liste sonst «läuft» sagt und nichts tut. Das ist
        der Zustand, in dem jemand eine Stunde sucht, warum das Licht
        nicht angeht.

        Gelöscht wird nichts: «Bis Ende der Ferien» kommt nächstes Jahr
        wieder, und ein Ablauf, der sich selbst löscht, ist eine Arbeit,
        die zweimal gemacht werden muss. Die Frist bleibt ebenfalls
        stehen - wer ihn wieder einschaltet, sieht, wonach er sie neu
        setzen muss.
        """
        heute = date.today()
        faellig = [
            automation
            for automation in self.automations
            if automation.enabled and abgelaufen(automation, heute)
        ]
        if not faellig:
            return []
        betroffen = {automation.id for automation in faellig}
        for automation in faellig:
            automation.enabled = False
            log.info(
                "Automation '%s' ausgeschaltet - Frist bis %s ist vorbei",
                automation.alias,
                automation.valid_until,
            )
        # Abgelegt wird wie in der Route (api/routes/automations.py): Die
        # Abläufe aus der config.yaml stehen nicht in der hub.data und
        # bleiben nur zur Laufzeit aus - dort gehört die Frist ohnehin
        # von Hand gepflegt, die Datei ist die Wahrheit.
        gespeichert = self.hub.data.get("automations")
        if any(str(eintrag.get("id")) in betroffen for eintrag in gespeichert):
            self.hub.data.set(
                "automations",
                [
                    {**eintrag, "enabled": False}
                    if str(eintrag.get("id")) in betroffen
                    else eintrag
                    for eintrag in gespeichert
                ],
            )
        tokens = self.hub.push.recipients(self.hub.users.users, "all", "maintenance")
        namen = ", ".join(automation.alias for automation in faellig[:3])
        rest = "" if len(faellig) <= 3 else f" und {len(faellig) - 3} weitere"
        await self.hub.push.send(
            tokens,
            "Frist abgelaufen",
            f"{namen}{rest}: die Frist ist vorbei, der Ablauf ist jetzt aus.",
            data={"ziel": "bereich:automations"},
            category="maintenance",
        )
        return faellig

    async def _verwaiste_pruefen(self) -> None:
        jetzt = time.time()
        rows = self.hub.data.get(verwaist.STORE_KEY)
        # Zuerst das «zuerst gesehen» nachführen: Ohne Anlagedatum ist es
        # der einzige Beleg, dass ein Ablauf schon lange genug da ist, um
        # verwaist sein zu können.
        neu = verwaist.merke_gesehen(
            rows, [automation.id for automation in self.automations], jetzt
        )
        if neu is not None:
            self.hub.data.set(verwaist.STORE_KEY, neu)
            rows = neu
        tote = verwaist.verwaiste(rows, self.automations, jetzt)
        if not tote:
            return
        # Höchstens einmal im Monat: Die Marke trägt den Kalendermonat,
        # das Gedächtnis liegt in der hub.data und überlebt so den
        # Neustart - dasselbe Muster wie beim Wächter (gemeldet.py).
        marke = f"verwaiste_ablaeufe:{datetime.fromtimestamp(jetzt):%Y-%m}"
        notified = self.hub.data.get("notified")
        if gemeldet.schon(notified, marke):
            return
        # Vormerken *bevor* die Meldung rausgeht: Scheitert der Versand,
        # soll er nicht im nächsten Takt erneut versucht werden.
        self.hub.data.set("notified", gemeldet.merke(notified, marke, jetzt))
        titel, text = verwaist.hinweis(tote)
        tokens = self.hub.push.recipients(self.hub.users.users, "all", "maintenance")
        await self.hub.push.send(
            tokens,
            titel,
            text,
            # «maintenance» hat ein Ziel (core/pushziel.py: das
            # Sorgen-Blatt) - aufräumen tut man Abläufe aber in ihrer
            # Liste, also führt der Tipp dorthin.
            data={"ziel": "bereich:automations"},
            category="maintenance",
        )
        log.info("Verwaisten-Hinweis verschickt: %d Ablauf/Abläufe", len(tote))

    def _conditions_hold(self, automation: Automation) -> tuple[bool, list[str]]:
        """Stimmen die Bedingungen? Ohne Bedingungen: ja.

        Gibt zusätzlich zurück, welche Bedingungen nicht erfüllt waren.
        Ohne diese Begründung rätselt man bei einem stummen Ablauf, ob der
        Auslöser nicht kam oder eine Bedingung im Weg war – und das war
        bisher nirgends zu sehen.

        «any» ohne Bedingungen wäre sonst nie erfüllt; ein Ablauf ohne
        «nur wenn» soll aber immer laufen.
        """
        # Ein «Zeitraum»-Auslöser bringt seine Zeitbedingung selbst mit:
        # Was ein anderer Auslöser ausserhalb des Fensters anstösst, läuft
        # nicht - dafür ist das Fenster da (zeitfenster_bedingungen).
        # Das Fenster gilt immer - auch bei «eine Bedingung genügt»: Es ist
        # kein Wunsch neben anderen, sondern der Rahmen des Ablaufs.
        fenster = zeitfenster_bedingungen(automation.triggers)
        daneben = [f for f in fenster if not self._check_condition(f)]
        if daneben:
            return False, [describe_condition(f, None) for f in daneben]
        if not automation.conditions:
            return True, []
        results = [
            (condition, self._check_condition(condition))
            for condition in automation.conditions
        ]
        ferien_name = schulferien.ferien_am(
            self.hub.data.get(schulferien.STORE_KEY), date.today()
        )
        failed = [
            describe_condition(c, self._value_of(c), ferien_name)
            for c, ok in results
            if not ok
        ]
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

    def simulation(self, automation_id: str, tage: int) -> dict[str, Any] | None:
        """Wie oft hätte dieser Ablauf in den letzten Tagen gefeuert?

        (Punkt 254 der Werkbank.) Die Rechnung selbst ist rein und liegt
        in core/ablaufsimulation.py - hier wird nur zusammengetragen, was
        sie braucht: Standort, Ereignisprotokoll, Ferientermine und die
        Terminliste des Kalenders. None, wenn es den Ablauf nicht gibt.
        """
        automation = self.get(automation_id)
        if automation is None:
            return None
        # Erst hier importiert: ablaufsimulation braucht die reinen
        # Helfer dieses Moduls (parse_hhmm, time_in_window) - ein Import
        # beim Laden wäre ein Kreis.
        from . import ablaufsimulation, schulferien

        lat, lon = self._location()
        return ablaufsimulation.simulieren(
            automation.triggers,
            automation.conditions,
            automation.match,
            tage,
            datetime.now(),
            lat,
            lon,
            schulferien_rows=self.hub.data.get(schulferien.STORE_KEY),
            events=self.hub.eventlog.all(),
            log_start=self.hub.eventlog.started,
            calendar_events=self._calendar_events(""),
        )

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
            # «ausser in den Schulferien» (Punkt 470 der Werkbank). Die
            # Luzerner Ferientermine liegen seit je im Hub, benutzt hat
            # sie nur die Simulation - «Wecklicht um 06:30» war im Juli
            # falsch, und abgestellt hat das jeden Sommer jemand von Hand.
            #
            # Feiertage sind damit nicht mit erschlagen: Wer beides will,
            # setzt beide Haken. Ein Ferienhaken, der stillschweigend auch
            # Auffahrt abdeckte, wäre eine zweite Bedeutung in einem Wort.
            if condition.get("except_school_holidays") and schulferien.ferien_am(
                self.hub.data.get(schulferien.STORE_KEY), datetime.now().date()
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
        # Die vier Auslöser aus Punkt 252/153, hier als Dauerzustand: Der
        # Auslöser feuert bei der Flanke (kommt an, Warnung neu, Termin
        # beginnt), die Bedingung fragt, ob es *gerade so ist*. Ohne sie
        # musste «nur wenn Livia daheim ist» als Gerätebedingung auf die
        # Zonen-Entität nachgebaut werden - und dafür musste man deren
        # Kennung kennen.
        if ctype == "presence":
            person = str(condition.get("person") or "")
            zone = str(condition.get("zone") or "home").strip().lower()
            da = any(
                str(entity.state.get("state") or "").strip().lower() == zone
                for entity in self.hub.registry.all()
                if str(entity.state.get("device_class") or "") == "presence"
                and person_matches(person, entity.id, entity.name)
            )
            return not da if str(condition.get("state", "present")) == "absent" else da
        if ctype == "availability":
            entity = self.hub.registry.get(str(condition.get("entity_id") or ""))
            if entity is None:
                return False
            return bool(entity.available) == bool(condition.get("available", True))
        if ctype == "weather_warning":
            gesucht = str(condition.get("entity_id") or "")
            aktiv = any(
                warnung_aktiv(entity.state, condition.get("min_severity"))
                for entity in self.hub.registry.all()
                if isinstance(entity.state.get("alerts"), list)
                and (not gesucht or entity.id == gesucht)
            )
            return aktiv if condition.get("active", True) else not aktiv
        if ctype == "calendar":
            laeuft = termin_laeuft(
                self._calendar_events(str(condition.get("entity_id") or "")),
                str(condition.get("contains") or ""),
                datetime.now(),
            )
            return laeuft if condition.get("active", True) else not laeuft
        log.warning("Unbekannter Bedingungstyp: %s", ctype)
        return False

    async def _execute_action(
        self,
        automation: Automation,
        action: dict[str, Any],
        ausloeser: str | None = None,
        tiefe: int = 0,
    ) -> str | None:
        """Eine Aktion ausführen. Die Rückgabe ist eine kurze Notiz für
        die Schritt-Spur des Laufs (Punkt 160) - oder None.

        ``tiefe`` zählt, wie tief «wenn» und «wiederholen» ineinander
        stecken (Punkt 251) - ab NEST_DEPTH wird abgebrochen, damit sich
        eine versehentliche Verschachtelung nicht endlos frisst.
        """
        atype = action.get("type", "command")
        if atype == "command":
            ziel = str(action["entity_id"])
            if ziel == kamera.TRIGGER:
                # «Das Gerät, das ausgelöst hat»: Ein Ablauf «Taster
                # gedrückt → dieselbe Lampe umschalten» gilt so für alle
                # Taster, statt je Taster abgeschrieben zu werden. Ohne
                # Auslöser (von Hand gestartet) gibt es nichts zu schalten.
                if not ausloeser:
                    return "kein auslösendes Gerät - Schritt übersprungen"
                ziel = ausloeser
            await self.hub.integrations.dispatch_command(
                ziel, action["command"], action.get("data") or {}
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
        elif atype == "if":
            return await self._verzweigung(automation, action, ausloeser, tiefe)
        elif atype == "repeat":
            return await self._wiederholung(automation, action, ausloeser, tiefe)
        elif atype == "notify":
            if self._nachts_still(automation):
                return "nachts still - nicht gemeldet"
            await self._notify(automation, action, ausloeser)
        elif atype == "broadcast":
            if self._nachts_still(automation):
                # Eine Durchsage um drei Uhr weckt zuverlässiger als
                # jede Push - erst recht die eine still zu lassen und
                # die andere nicht, wäre nicht zu erklären.
                return "nachts still - keine Durchsage"
            # Durchsage auf die Cast-Boxen: «Es hat geklingelt»,
            # «Waschmaschine ist fertig». Die Quelle bleibt der Ablauf -
            # say.speak() überschreibt sie nicht.
            from . import say

            # Dieselben Platzhalter wie in der Nachricht: {gerät}, {raum},
            # {wert} des Auslösers (kamera.fill) - «{gerät} im {raum}
            # meldet {wert}» gilt damit für alle Melder auf einmal.
            quelle = self.hub.registry.get(ausloeser or "") if ausloeser else None
            await say.speak(
                self.hub,
                self._mit_platzhaltern(
                    self._mit_termin(kamera.fill(str(action.get("text") or ""), quelle))
                ),
                speakers=[str(s) for s in action.get("speakers") or []] or None,
                volume=action.get("volume"),
            )
        elif atype == "presence":
            return await self._anwesenheit(action)
        elif atype == "music":
            return await self._musik(automation, action)
        else:
            log.warning("Unbekannter Aktionstyp in '%s': %s", automation.alias, atype)
        return None

    def _nachts_still(self, automation: Automation) -> bool:
        """Meldet dieser Ablauf gerade absichtlich nicht?

        Nur die meldenden Schritte fallen weg, nicht der ganze Lauf: Wer
        nachts das Licht löschen und dabei nichts sagen will, hat einen
        Ablauf und nicht zwei.

        Eigene Stunden, falls gesetzt (Punkt 379 der Werkbank) - sonst
        die üblichen 22 bis 8 aus core/nachtruhe.py.
        """
        if not automation.quiet_night:
            return False
        von = automation.quiet_from if automation.quiet_from is not None else nachtruhe.VON
        bis = automation.quiet_to if automation.quiet_to is not None else nachtruhe.BIS
        return nachtruhe.still(time.time(), von=von, bis=bis)

    async def _anwesenheit(self, action: dict[str, Any]) -> str | None:
        """«Levin ist da» – gemeldet von einem Ablauf statt von einem Telefon.

        Wer kein Telefon trägt, hat bisher keine Anwesenheit gehabt. Die
        Zone gab es (sie entsteht aus der Benutzerliste), aber melden
        konnte nur das Telefon selbst: `handle_command` an einer
        Geofence-Zone weist ausdrücklich ab, und das zu Recht - eine Zone
        ist nichts, was man schaltet.

        Etwas anderes ist es, wenn ein Ereignis im Haus die Ankunft
        *beweist*: ein Knopf am Schlüsselanhänger, ein eigener
        Keypad-Code, ein Fob am Türschloss. Dann ist die Meldung so gut
        wie die des Telefons - und dieser Schritt ist der Weg dafür.

        Die Quelle heisst darum «ablauf» und nicht «geofence»: In der
        Diagnose steht sonst bei Levin dasselbe wie bei allen anderen,
        und die Frage «warum meldet sich das Telefon nicht» wäre bei
        jemandem gestellt, der keines hat.

        Ein Ankommen darf ohnehin jede Quelle melden - das «weg» bleibt
        beim Führenden (core/presence.py: meldung_annehmen). Wer ein
        Telefon *und* einen Knopf hat, kann sich damit früher anmelden,
        aber nicht selbst abmelden.
        """
        zone = str(action.get("zone") or "").strip().lower()
        if not zone:
            return "Anwesenheit: keine Person angegeben"
        dienst = self.hub.integrations.get("geofence")
        if dienst is None or not hasattr(dienst, "report"):
            return "Anwesenheit: die geofence-Integration ist nicht eingerichtet"
        try:
            await dienst.report(
                zone, str(action.get("event") or "enter"), source="ablauf"
            )
        except KeyError:
            # Kein Absturz, sondern ein Satz im Verlauf: Eine Zone
            # verschwindet, wenn jemand aus der Benutzerliste fällt, und
            # dann soll der Ablauf sagen, wen er nicht findet.
            return f"Anwesenheit: «{zone}» kennt der Hub nicht"
        except ValueError as err:
            return f"Anwesenheit: {err}"
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

        if tat == "follow":
            # Punkt 419: Wer den Raum wechselt, nimmt die Musik mit - aber
            # nur den Sender, nicht «was auch immer gerade läuft». Ein
            # Radiosender ist die eine Auskunft, die jede Box gleich
            # versteht (play_radio/station, dieselbe Zuordnung wie bei
            # einem Favoriten); eine Spotify-Wiedergabe liesse sich so
            # nicht ehrlich fortsetzen, darum bleibt es beim Sender.
            quelle_id = str(action.get("entity_id") or "")
            ziel_id = str(action.get("target") or "")
            if not quelle_id or not ziel_id:
                return "Musik folgt: Quelle oder Ziel fehlt"
            quelle = self.hub.registry.get(quelle_id)
            if quelle is None or str(quelle.state.get("state")) not in (
                "playing",
                "buffering",
            ):
                return "es lief nichts, das hätte folgen können"
            station = str(quelle.state.get("station") or "").strip()
            if not station:
                return "kein Sender erkennbar, der sich übernehmen liesse"
            await self.hub.integrations.dispatch_command(
                ziel_id, "play_radio", {"station": station}
            )
            if "pause" in quelle.commands:
                # Pause, nicht Stopp: Kommt man zurück, ist die Box nicht
                # einfach still, sondern bereit, wo sie aufgehört hat.
                await self.hub.integrations.dispatch_command(quelle_id, "pause", {})
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

        Mit ``toggle: true`` gilt dasselbe für einen Wandtaster: Brennt
        die Lampe, geht sie aus; brennt sie nicht, geht sie so an, wie es
        hier steht. Ohne das musste man sich zwischen «immer an» und
        «umschalten ohne Vorgaben» entscheiden.

        Für die Helligkeit gibt es drei Wege, und der Unterschied
        entscheidet, ob abends jemand geblendet wird:

        - eine Zahl: immer dieselbe Prozentzahl;
        - ``brightness: "adaptive"``: nach der gemessenen Helligkeit -
          erst der Melder, der ausgelöst hat, dann ein Fühler im Raum der
          Lampe (core/light.py, warum es dunkler statt heller wird, je
          dunkler es ist);
        - ``brightness: "tageszeit"``: nach der Uhr. Für die meisten
          Räume, in denen gar kein Fühler steht.
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

        # Umschalten mit Vorgaben: Brennt sie, geht sie aus - und alles
        # Weitere entfällt. Der Wandtaster im Flur ist genau dieser Fall:
        # ein Knopf, und wenn er einschaltet, dann bitte nachts gedämpft
        # und warm. Ohne diesen Zweig musste man sich zwischen «immer an»
        # und «ohne Vorgaben» entscheiden.
        if action.get("toggle") and str(entity.state.get("state") or "") == "on":
            await self.hub.integrations.dispatch_command(entity_id, "turn_off", {})
            # Auch den Nachlauf abbestellen: Sonst liefe der Zeitgeber
            # von vorhin weiter und schaltete die Lampe aus, die
            # inzwischen jemand von Hand wieder angemacht hat.
            self._nachlauf_stoppen(entity_id)
            return "war an - ausgeschaltet"

        notiz: str | None = None
        helligkeit: float | None = None
        roh = action.get("brightness")
        wort = roh.strip().lower() if isinstance(roh, str) else ""
        if wort == "adaptive":
            lux = self._lux_for(automation, action, ausloeser, entity.room)
            if lux is None:
                # Kein Messwert: Die Lampe geht trotzdem an - ein
                # Bewegungslicht, das wegen eines stummen Fühlers dunkel
                # bleibt, ist schlimmer als eines in Vorgabehelligkeit.
                notiz = "kein Helligkeitswert – Lampe ohne Vorgabe an"
            else:
                helligkeit = licht.brightness_from_lux(lux)
                notiz = f"{lux:.0f} lx → {helligkeit:.0f} %"
        elif wort == "tageszeit":
            jetzt = datetime.now()
            helligkeit = licht.brightness_from_time(jetzt.hour, jetzt.minute)
            notiz = f"{jetzt:%H:%M} → {helligkeit:.0f} %"
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
        raum: str | None = None,
    ) -> float | None:
        """Die Umgebungshelligkeit, an die sich das Licht anpassen soll.

        In dieser Reihenfolge: das im Ablauf genannte Gerät (für von Hand
        geschriebene config.yaml), sonst der Melder, der gerade ausgelöst
        hat, sonst der erste Auslöser, der überhaupt Lux meldet, sonst
        ein Fühler im Raum der Lampe. Ohne jeden Wert: None - der
        Aufrufer schaltet dann ohne Vorgabe ein.

        Der Raum kam zuletzt dazu und ist der Grund, warum die Wahl
        überhaupt allgemein taugt: Ein Ablauf «um 18:00 das Wohnzimmer
        an» hat keinen Melder, der auslöst - vorher war «an die
        Helligkeit angepasst» dort schlicht wirkungslos.
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
        return licht.raum_lux(self.hub.registry.all(), raum)

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

    # ── Restzeit («geht in 12 Min aus») ───────────────────────────────
    #
    # Nur wenn der Ablauf es sagt (Automation.countdown). Geschrieben
    # wird ein einziges Feld im Zustand (core/abschaltung.FELD) - die
    # App zählt selbst herunter, der Hub meldet sich nur beim Setzen und
    # beim Löschen.

    async def _countdown_setzen(
        self, entity_id: str, at: float, besitzer: asyncio.Task | None
    ) -> None:
        self._abschaltungen[entity_id] = (at, besitzer)
        try:
            await self.hub.registry.update_state(entity_id, {abschaltung.FELD: at})
        except Exception:
            # Ein Gerät, das es nicht mehr gibt, ist kein Grund, den
            # Ablauf anzuhalten - die Restzeit ist eine Zugabe.
            self._abschaltungen.pop(entity_id, None)

    async def _countdown_loeschen(self, entity_id: str) -> None:
        """Die Restzeit wegnehmen - ausdrücklich als None.

        Weggelassen bliebe sie kleben: Der Zustand wird gemerged (siehe
        core/registry.update_state), und an einem längst ausgeschalteten
        Licht stünde weiter «geht in 3 Min aus».
        """
        self._abschaltungen.pop(entity_id, None)
        entity = self.hub.registry.get(entity_id)
        if entity is None or entity.state.get(abschaltung.FELD) is None:
            return
        try:
            await self.hub.registry.update_state(entity_id, {abschaltung.FELD: None})
        except Exception:
            log.debug("Restzeit von %s nicht löschbar", entity_id, exc_info=True)

    def _countdown_planen(
        self, automation: Automation, actions: list[dict[str, Any]], position: int
    ) -> None:
        """Vor einer Wartezeit: Wer danach ausgeht, bekommt seine Restzeit.

        Der Eigentümer ist die Aufgabe, die gerade wartet. Bricht der
        Lauf ab (Neustart, Halt), räumt ihr Rückruf die Anzeige weg -
        sonst behauptete sie eine Abschaltung, die nie kommt.
        """
        if not automation.countdown:
            return
        action = actions[position] if position < len(actions) else {}
        if str(action.get("type") or "command") != "delay":
            return
        try:
            sekunden = float(action.get("seconds") or 0)
        except (TypeError, ValueError):
            return
        ziele = abschaltung.ziele_nach(actions, position)
        if sekunden <= 0 or not ziele:
            return
        at = time.time() + sekunden
        besitzer = asyncio.current_task()
        for entity_id in ziele:
            self._start_task(self._countdown_setzen(entity_id, at, besitzer))
        if besitzer is not None:
            besitzer.add_done_callback(
                lambda _done, ids=tuple(ziele), wer=besitzer: self._countdown_aufraeumen(
                    ids, wer
                )
            )

    def _countdown_aufraeumen(
        self, entity_ids: tuple[str, ...], besitzer: asyncio.Task | None
    ) -> None:
        """Nach dem Lauf: eigene Anzeigen wegräumen, fremde stehen lassen.

        Fremde heisst: Ein zweiter Durchgang hat die Lampe inzwischen
        neu übernommen (Nachlauf, «von vorn beginnen») - dessen Restzeit
        gehört nicht diesem Lauf und bleibt.
        """
        for entity_id in entity_ids:
            eintrag = self._abschaltungen.get(entity_id)
            if eintrag is None or eintrag[1] is not besitzer:
                continue
            self._start_task(self._countdown_loeschen(entity_id))

    def _start_task(self, coro: Any) -> None:
        """Eine Nebenaufgabe starten, ohne sie aus den Augen zu verlieren."""
        try:
            task = asyncio.create_task(coro)
        except RuntimeError:
            # Kein laufender Loop (Test, Abbau) - dann eben nicht.
            coro.close()
            return
        self._run_tasks.add(task)
        task.add_done_callback(self._run_tasks.discard)

    def _nachlauf_stoppen(self, entity_id: str) -> None:
        """Den laufenden Nachlauf dieser Lampe abbestellen (falls einer läuft).

        Die «geht in 4 Min aus»-Anzeige räumt der Rückruf der Aufgabe
        selbst weg (_countdown_aufraeumen) - ein Abbruch zählt für ihn
        wie ein Ende.
        """
        laufend = self._nachlauf.pop(entity_id, None)
        if laufend is not None and not laufend[0].done():
            laufend[0].cancel()

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
        self._nachlauf_stoppen(entity_id)
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
        # Der Nachlauf ist der zweite Weg zu «geht in 4 Min aus» - beim
        # Bewegungslicht sogar der übliche. Verlängert ihn neue Bewegung,
        # überschreibt der neue Zeitpunkt den alten von selbst.
        if automation.countdown:
            self._start_task(self._countdown_setzen(entity_id, faellig, task))
            task.add_done_callback(
                lambda _done, key=entity_id, wer=task: self._countdown_aufraeumen(
                    (key,), wer
                )
            )
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

    async def _verzweigung(
        self,
        automation: Automation,
        action: dict[str, Any],
        ausloeser: str | None,
        tiefe: int,
    ) -> str | None:
        """«wenn … dann … sonst» mitten in der Aktionsliste (Punkt 251).

        Bisher konnte nur der ganze Ablauf verzweigen (conditions +
        otherwise). «Licht an - und NUR wenn es dunkel ist, auch die
        Aussenlampe» brauchte deshalb zwei Abläufe mit demselben
        Auslöser, die man beim Ändern beide anfassen muss.

        Die Bedingungen sind dieselben wie überall (``_check_condition``
        samt Gruppen) - eine zweite Bedingungssprache nur für diesen
        Schritt wäre eine zweite Stelle, an der Regeln auseinanderlaufen.
        """
        if tiefe >= NEST_DEPTH:
            # Kein Fehler, sondern eine Notiz im Verlauf: Der restliche
            # Lauf soll weitergehen - siehe die Haltung in _run.
            log.warning(
                "Automation '%s': «wenn» zu tief verschachtelt (%d) - übersprungen",
                automation.alias,
                tiefe,
            )
            return f"zu tief verschachtelt (mehr als {NEST_DEPTH} Ebenen) - übersprungen"
        conds = [c for c in action.get("conditions") or [] if isinstance(c, dict)]
        if not conds:
            # Leer heisst «gilt» - wie bei der leeren Bedingungsliste und
            # der leeren Gruppe: Ein vergessener Block soll auffallen,
            # nicht lähmen.
            held = True
        elif str(action.get("match", "all")) == "any":
            held = any(self._check_condition(c) for c in conds)
        else:
            held = all(self._check_condition(c) for c in conds)
        zweig = action.get("then") if held else action.get("else")
        gelaufen = await self._unterschritte(
            automation, zweig, ausloeser, tiefe + 1
        )
        wohin = "Bedingung traf zu" if held else "sonst-Zweig"
        return f"{wohin}: {gelaufen}"

    async def _wiederholung(
        self,
        automation: Automation,
        action: dict[str, Any],
        ausloeser: str | None,
        tiefe: int,
    ) -> str | None:
        """Einen Aktionsblock mehrfach ausführen (Punkt 251).

        Zwei Formen: ``count`` dreht eine feste Zahl von Runden («dreimal
        blinken»), ``while`` prüft VOR jedem Durchgang, ob die
        Bedingungen noch gelten («solange die Türe offen ist, alle
        dreissig Sekunden mahnen»). Beide enden spätestens an
        REPEAT_LIMIT - warum die Grenze hart ist, steht dort.
        """
        if tiefe >= NEST_DEPTH:
            log.warning(
                "Automation '%s': «wiederholen» zu tief verschachtelt (%d) - übersprungen",
                automation.alias,
                tiefe,
            )
            return f"zu tief verschachtelt (mehr als {NEST_DEPTH} Ebenen) - übersprungen"
        schritte = [a for a in action.get("actions") or [] if isinstance(a, dict)]
        solange = action.get("while")
        if solange is not None:
            conds = [c for c in solange or [] if isinstance(c, dict)]
            grenze = parse_repeat_count(action.get("max") or REPEAT_LIMIT)
            durchgaenge = 0
            for _ in range(grenze):
                # Vor jedem Durchgang, nicht danach: Gilt die Bedingung
                # schon zu Beginn nicht, läuft gar nichts - wie bei
                # einer while-Schleife, deren Namen der Schritt trägt.
                if conds and not all(self._check_condition(c) for c in conds):
                    break
                await self._unterschritte(automation, schritte, ausloeser, tiefe + 1)
                durchgaenge += 1
            if durchgaenge >= grenze:
                return f"nach {grenze} Durchgängen an der Obergrenze gestoppt"
            return f"{durchgaenge} Durchgang/Durchgänge"
        anzahl = parse_repeat_count(action.get("count"))
        for _ in range(anzahl):
            await self._unterschritte(automation, schritte, ausloeser, tiefe + 1)
        return f"{anzahl} Durchgang/Durchgänge"

    async def _unterschritte(
        self,
        automation: Automation,
        schritte: Any,
        ausloeser: str | None,
        tiefe: int,
    ) -> str:
        """Die Schritte eines Zweigs oder einer Runde - mit derselben
        Haltung wie der Hauptlauf: Ein hängender Schritt hält die
        übrigen nicht an, er steht als Zahl in der Notiz und im Log."""
        gelaufen = 0
        gestolpert = 0
        for schritt in schritte or []:
            if not isinstance(schritt, dict):
                continue
            try:
                await self._execute_action(automation, schritt, ausloeser, tiefe)
                gelaufen += 1
            except Exception as err:
                gestolpert += 1
                log.warning(
                    "Automation '%s': Unterschritt hing (%s) - weiter",
                    automation.alias,
                    err,
                )
        satz = f"{gelaufen} Schritt(e)"
        if gestolpert:
            satz += f", {gestolpert} hingen"
        return satz

    def _mit_platzhaltern(self, text: str) -> str:
        """``{entity_id}``, ``{entity_id.attribut}`` und ``{time}`` im
        Text füllen (Punkt 251) - die Auflösung selbst ist rein
        (core/platzhalter.py), hier steht nur das Nachschlagen im
        Gerätebestand. Unbekanntes bleibt stehen, damit ein Tippfehler
        als Tippfehler ankommt statt als ausgefallene Nachricht."""
        if "{" not in text:
            return text

        def nachschlagen(entity_id: str, attribut: str) -> Any:
            entity = self.hub.registry.get(entity_id)
            if entity is None:
                return None
            return entity.state.get(attribut)

        return platzhalter.fuellen(
            text, nachschlagen, jetzt=datetime.now().strftime("%H:%M")
        )

    def _mit_termin(self, text: str) -> str:
        """``{termin}`` im Text durch den laufenden Kalendertermin ersetzen.

        Damit sagt eine Klingel-Durchsage «Das ist wohl {termin}» an
        jedem Besuchstag den richtigen Namen - nicht fest verdrahtet für
        einen (core/terminkontext.py). Ohne Platzhalter kostet der
        Aufruf nichts.
        """
        if "{termin}" not in text:
            return text
        events = next(
            (
                entity.state.get("events")
                for entity in self.hub.registry.all()
                if isinstance(entity.state.get("events"), list)
            ),
            None,
        )
        return terminkontext.platzhalter_fuellen(text, events, datetime.now().astimezone())

    async def _notify(
        self,
        automation: Automation,
        action: dict[str, Any],
        ausloeser: str | None = None,
    ) -> None:
        """Eine Push-Nachricht aus einem Ablauf - sofort oder ein paar
        Sekunden später.

        Die Verzögerung läuft **neben** dem Ablauf und nicht in ihm: Was
        nach der Nachricht steht (Licht an, Szene), soll nicht auf sie
        warten - es hängt ja nichts davon ab. Wer den ganzen Ablauf
        anhalten will, nimmt den Schritt «Warten».

        Wozu überhaupt gewartet wird, steht bei `notify_verzoegerung`:
        Der Türkontakt meldet, während die Person noch hinter der Türe
        ist, und das Bild zeigt einen leeren Raum.
        """
        wartet = notify_verzoegerung(action)
        if wartet <= 0:
            await self._notify_senden(automation, action, ausloeser)
            return
        aufgabe = asyncio.create_task(
            self._notify_spaeter(wartet, automation, action, ausloeser)
        )
        # Die Referenz halten: Die Ereignisschleife hält eine Aufgabe nur
        # schwach fest, und der Sammler dürfte sie mittendrin abräumen -
        # das wäre eine Nachricht, die nie ankommt, und niemand sähe
        # warum (dieselbe Falle wie in core/personenbild.py).
        self._spaetere_meldungen.add(aufgabe)
        aufgabe.add_done_callback(self._spaetere_meldungen.discard)

    async def _notify_spaeter(
        self,
        sekunden: float,
        automation: Automation,
        action: dict[str, Any],
        ausloeser: str | None,
    ) -> None:
        try:
            await asyncio.sleep(sekunden)
            await self._notify_senden(automation, action, ausloeser)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Eine Nachricht, die neben dem Ablauf läuft, hat niemanden
            # mehr, der ihren Fehler auffängt - ohne dieses Protokoll
            # bliebe sie einfach aus.
            log.exception("Verzögerte Nachricht aus '%s' fehlgeschlagen", automation.alias)

    async def _notify_senden(
        self,
        automation: Automation,
        action: dict[str, Any],
        ausloeser: str | None = None,
    ) -> None:
        """Text und Kamera dürfen sich auf den Auslöser beziehen: «Jemand
        weint im Zimmer {raum}» und «die Kamera, die ausgelöst hat» gelten
        damit für alle Kinderzimmer auf einmal. Vorher brauchte jede
        Kamera einen eigenen Ablauf mit eigenem Text - fünf Zimmer, fünf
        fast gleiche Abläufe, und beim Ändern findet man den fünften nie.

        Das Bild entsteht **hier** und nicht beim Auslösen: Wartet die
        Nachricht fünf Sekunden, wartet das Bild mit - genau darum geht
        es.
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
        ziel = str(action.get("open") or "").strip()
        knoepfe = pushziel.knoepfe_pruefen(action.get("buttons"))
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
            # Erst {raum}/{gerät} (kamera.fill), dann {termin}, zuletzt
            # {entity_id}/{time} (Punkt 251) - jeder Schritt lässt
            # stehen, was ihm nicht gehört, deshalb dürfen sie sich
            # nacheinander denselben Text teilen.
            title=self._mit_platzhaltern(
                self._mit_termin(
                    kamera.fill(action.get("title") or automation.alias, quelle)
                )
            ),
            body=self._mit_platzhaltern(
                self._mit_termin(kamera.fill(action.get("body") or "", quelle))
            ),
            data={
                "automation_id": automation.id,
                **({"camera": camera} if camera else {}),
                # Wohin der Tipp führt, und was er dort anbietet. Beides
                # steht im Ablauf selbst: Ein Ablauf weiss, worum es geht -
                # der Hub kann es ihm nicht ansehen (core/pushziel.py).
                **({"ziel": ziel} if ziel else {}),
                **({"knoepfe": knoepfe} if knoepfe else {}),
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
