"""Lautstärke nach Tageszeit.

Vier Abläufe («Lautstärke Morgen», «Tag», «Abend», «Nacht»), die alle
dasselbe tun und sich nur in einer Zahl unterscheiden – das ist die
Sorte Arbeit, die der Hub selbst erledigen kann. Hier steht sie einmal
als Plan: eine Liste von Zeiten und Werten, dazu die Boxen, für die sie
gilt.

Der Plan gilt für den *Ruhezustand* einer Box. Das ist der springende
Punkt: Was eine Box leise oder laut macht, während jemand zuhört,
entscheidet der Mensch mit dem Regler – nicht die Uhr. Der Plan sagt
nur, wie laut die Box sein soll, wenn sie das nächste Mal etwas von
sich gibt.

Daraus folgen die drei Regeln:

*Beim Stufenwechsel wird gestellt* – aber nur bei Boxen, auf denen
nichts läuft. In eine laufende Wiedergabe hineinzustellen, ist ein
Eingriff, kein Grundwert.

*Wenn die Musik endet, gilt der Sollwert der jetzigen Zeit.* Nicht der
Wert, der beim letzten Stufenwechsel anstand: Läuft das Radio von
sieben bis elf, gilt beim Ausschalten der Tag-Wert und nicht der
Morgen-Wert, den die Box vor vier Stunden verpasst hat. Deshalb rechnet
der Hub in dem Moment neu, statt sich einen Wunsch zu merken.

*Und nach einem Neustart ebenso.* Eine stille Box auf einem
Lautstärkewert, den niemand mehr kennt, ist genau der Zustand, den der
Plan abschaffen soll.

Um Mitternacht wird nicht gerechnet, sondern umgeschlagen: Steht die
letzte Stufe auf 23:45, gilt sie bis zur ersten des nächsten Tages.
Ein Plan ohne diesen Umschlag hätte zwischen Mitternacht und der ersten
Stufe ein Loch - und genau dort liegt die Nacht.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, Any

from .errors import HomePilotError
from .source import as_source

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)

#: Wo der Plan in der Datendatei steht.
KEY = "volume_plan"

#: So viele Stufen darf ein Plan haben. Mehr als zwölf Wechsel am Tag
#: ist keine Tageszeit mehr, sondern eine Kurve - und die stellt man
#: nicht in einer Liste ein.
MAX_STUFEN = 12

#: Und so viele Pläne. Einer je Bereich (Wohnung, Büro, Kinderzimmer)
#: reicht weit; hundert wären ein Versehen.
MAX_PLAENE = 8


def minuten(hhmm: Any) -> int | None:
    """«07:00» → 420 (rein, testbar). Unsinn ergibt None."""
    text = str(hhmm or "").strip()
    if ":" not in text:
        return None
    stunde, _, minute = text.partition(":")
    try:
        h, m = int(stunde), int(minute)
    except ValueError:
        return None
    if not (0 <= h < 24 and 0 <= m < 60):
        return None
    return h * 60 + m


def stufe_jetzt(stufen: Any, jetzt_min: int) -> dict[str, Any] | None:
    """Welche Stufe gerade gilt (rein, testbar).

    Vor der ersten Stufe des Tages gilt die letzte des Vortages - das
    ist der Umschlag um Mitternacht, und ohne ihn wäre die Nacht ein
    Loch im Plan.
    """
    gueltig = [s for s in (stufen or []) if isinstance(s, dict) and minuten(s.get("at")) is not None]
    if not gueltig:
        return None
    sortiert = sorted(gueltig, key=lambda s: minuten(s["at"]) or 0)
    davor = [s for s in sortiert if (minuten(s["at"]) or 0) <= jetzt_min]
    return davor[-1] if davor else sortiert[-1]


def kandidat(entity: Any) -> bool:
    """Kann ein Plan dieses Gerät überhaupt stellen? (rein, testbar)

    Die eine Stelle, an der das entschieden wird - und die die App
    spiegelt (app/src/lib/lautplan.ts: planBoxen). Hier lagen die zwei
    Listen einmal auseinander: Der Hub stellte Lautsprechergruppen mit,
    die App bot sie nicht zur Wahl an. Wer eine Gruppe aus dem Plan
    nehmen wollte, fand sie nirgends.

    Fernseher und Gruppen sind deshalb keine Ausnahme mehr, sondern
    bloss eine Eigenschaft - was mit ihnen geschieht, entscheidet
    ``gilt_fuer``.
    """
    from .entity import EntityKind

    return (
        getattr(entity, "kind", None) == EntityKind.MEDIA_PLAYER
        and "set_volume" in getattr(entity, "commands", ())
        and bool(getattr(entity, "available", False))
    )


def gilt_fuer(plan: Any, entity_id: str, bildschirm: bool = False) -> bool:
    """Deckt dieser Plan dieses Gerät ab? (rein, testbar)

    Wer genannt ist, ist dabei - auch ein Fernseher. Die App bietet ihn
    in der Auswahl an, und was dort steht, muss auch gelten: Eine
    Auswahl, die etwas anzeigt, das der Hub dann doch nicht anfasst,
    ist schlimmer als gar keine.

    Eine leere Liste heisst dagegen «alle Lautsprecher» - und ein
    Fernseher ist keiner. Seine Lautstärke gehört zum Bild und nicht zur
    Tageszeit; wer sie trotzdem nach der Uhr stellen will, nennt ihn.
    """
    if not isinstance(plan, dict) or not plan.get("on", True):
        return False
    gewaehlt = plan.get("entities") or []
    if gewaehlt:
        return entity_id in gewaehlt
    return not bildschirm


def sollwert(
    plaene: Any, entity_id: str, jetzt_min: int, bildschirm: bool = False
) -> int | None:
    """Wie laut diese Box jetzt sein soll (rein, testbar).

    Der erste passende Plan gewinnt. Wer eine Box aus dem allgemeinen
    Plan herausnehmen will, stellt ihren eigenen darüber - eine Regel,
    die man nachvollziehen kann, ohne die Reihenfolge zu kennen, gibt
    es hier nicht, und zwei Pläne für dieselbe Box sind ohnehin ein
    Widerspruch, den der Mensch auflösen muss.
    """
    for plan in plaene or []:
        if not gilt_fuer(plan, entity_id, bildschirm):
            continue
        stufe = stufe_jetzt(plan.get("steps"), jetzt_min)
        if stufe is None:
            continue
        try:
            return max(0, min(100, int(stufe["volume"])))
        except (TypeError, ValueError, KeyError):
            return None
    return None


def plan_pruefen(roh: Any, id_vorgabe: str = "plan") -> dict[str, Any]:
    """Einen Plan auf Form bringen. Wirft HomePilotError mit Klartext."""
    if not isinstance(roh, dict):
        raise HomePilotError("Ein Plan ist eine Angabe mit Name und Stufen.")
    stufen: list[dict[str, Any]] = []
    for eintrag in roh.get("steps") or []:
        if not isinstance(eintrag, dict):
            continue
        wann = minuten(eintrag.get("at"))
        if wann is None:
            raise HomePilotError(f"«{eintrag.get('at')}» ist keine Uhrzeit (HH:MM).")
        try:
            wert = int(eintrag.get("volume"))
        except (TypeError, ValueError):
            raise HomePilotError("Eine Lautstärke ist eine Zahl zwischen 0 und 100.") from None
        if not 0 <= wert <= 100:
            raise HomePilotError("Eine Lautstärke ist eine Zahl zwischen 0 und 100.")
        stufen.append({"at": f"{wann // 60:02d}:{wann % 60:02d}", "volume": wert})
    if len(stufen) > MAX_STUFEN:
        raise HomePilotError(
            f"Höchstens {MAX_STUFEN} Stufen - mehr ist keine Tageszeit mehr."
        )
    # Doppelte Zeiten fliegen raus, die spätere Angabe gewinnt: Zwei
    # Werte für 07:00 sind kein Plan, sondern ein Vertipper.
    nach_zeit = {stufe["at"]: stufe for stufe in stufen}
    return {
        "id": str(roh.get("id") or id_vorgabe),
        "name": str(roh.get("name") or "Lautstärke nach Tageszeit").strip()[:60],
        "on": bool(roh.get("on", True)),
        "entities": [str(e) for e in (roh.get("entities") or []) if str(e).strip()],
        "steps": sorted(nach_zeit.values(), key=lambda s: s["at"]),
    }


def plaene_pruefen(roh: Any) -> list[dict[str, Any]]:
    """Die ganze Liste (rein, testbar)."""
    liste = [p for p in (roh or []) if isinstance(p, dict)]
    if len(liste) > MAX_PLAENE:
        raise HomePilotError(f"Höchstens {MAX_PLAENE} Pläne.")
    return [plan_pruefen(p, f"plan{i + 1}") for i, p in enumerate(liste)]


class Lautplan:
    """Der Teil des Hubs, der den Plan zur Uhr hält."""

    def __init__(self, hub: Hub) -> None:
        self.hub = hub
        self._takt: asyncio.Task[None] | None = None
        #: plan_id → Zeit der zuletzt angewandten Stufe. Damit wird beim
        #: Minutentakt nur beim *Wechsel* gestellt und nicht jede Minute
        #: neu - sonst zöge der Plan jeden Handgriff am Regler innerhalb
        #: einer Minute wieder zurück.
        self._zuletzt: dict[str, str] = {}

    # ── Speicher ───────────────────────────────────────────────────────

    def plaene(self) -> list[dict[str, Any]]:
        return [p for p in self.hub.data.get(KEY) if isinstance(p, dict)]

    def setzen(self, roh: Any) -> list[dict[str, Any]]:
        geprueft = plaene_pruefen(roh)
        self.hub.data.set(KEY, geprueft)
        # Der neue Plan gilt sofort und nicht erst zur nächsten Stufe:
        # Wer gerade 20 % eingestellt hat, will es hören können.
        self._zuletzt.clear()
        asyncio.create_task(self.anwenden())
        return geprueft

    # ── Takt ───────────────────────────────────────────────────────────

    def start(self) -> None:
        self.hub.bus.subscribe("state_changed", self._on_state)
        self._takt = asyncio.create_task(self._lauf())

    async def stop(self) -> None:
        if self._takt is not None:
            self._takt.cancel()
            self._takt = None

    async def _lauf(self) -> None:
        # Einmal beim Start: Eine stille Box auf einem Wert, den niemand
        # mehr kennt, ist genau der Zustand, den der Plan abschafft.
        # Kurz warten, bis die Integrationen ihre Geräte gemeldet haben.
        await asyncio.sleep(5)
        while True:
            try:
                await self.anwenden()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Lautstärkeplan: Durchgang fehlgeschlagen")
            await asyncio.sleep(30)

    def jetzt_min(self, jetzt: float | None = None) -> int:
        """Die aktuelle Uhrzeit in Minuten seit Mitternacht."""
        stunde = time.localtime(jetzt) if jetzt is not None else time.localtime()
        return stunde.tm_hour * 60 + stunde.tm_min

    async def anwenden(self, jetzt: float | None = None) -> list[str]:
        """Alle fälligen Stufen stellen. Gibt die gestellten Boxen zurück."""
        plaene = self.plaene()
        if not plaene:
            return []
        jetzt_min = self.jetzt_min(jetzt)
        gestellt: list[str] = []
        for plan in plaene:
            stufe = stufe_jetzt(plan.get("steps"), jetzt_min) if plan.get("on", True) else None
            if stufe is None:
                continue
            marke = str(stufe.get("at"))
            if self._zuletzt.get(str(plan.get("id"))) == marke:
                continue
            self._zuletzt[str(plan.get("id"))] = marke
            for entity in self._boxen(plan):
                # Spielende Boxen bleiben, wie sie sind - beim Ende der
                # Wiedergabe holt _on_state den Sollwert nach.
                if str(entity.state.get("state")) in ("playing", "buffering"):
                    continue
                if await self._stellen(entity.id, stufe.get("volume"), plan):
                    gestellt.append(entity.label)
        if gestellt:
            log.info("Lautstärkeplan: %s gestellt", ", ".join(gestellt))
        return gestellt

    def _boxen(self, plan: dict[str, Any]) -> list[Any]:

        return [
            entity
            for entity in self.hub.registry.all()
            if kandidat(entity)
            and gilt_fuer(plan, entity.id, bool(entity.state.get("has_screen")))
        ]

    async def _stellen(self, entity_id: str, wert: Any, plan: dict[str, Any]) -> bool:
        try:
            with as_source({"kind": "automation", "label": str(plan.get("name") or "Lautstärkeplan")}):
                await self.hub.integrations.dispatch_command(
                    entity_id, "set_volume", {"volume": int(wert)}
                )
        except Exception as err:
            log.debug("Lautstärkeplan: %s liess sich nicht stellen: %s", entity_id, err)
            return False
        return True

    # ── Wenn die Musik endet ───────────────────────────────────────────

    def _on_state(self, _event_type: str, data: dict[str, Any]) -> None:
        alt = data.get("old_state") or {}
        neu = data.get("new_state") or {}
        if not isinstance(alt, dict) or not isinstance(neu, dict):
            return
        # Nur der Übergang zählt. Ein Player, der zehnmal je Minute
        # seinen Fortschritt meldet, ist zehnmal «nicht am Spielen».
        if str(alt.get("state")) not in ("playing", "buffering"):
            return
        if str(neu.get("state")) in ("playing", "buffering"):
            return
        entity_id = str(data.get("entity_id") or "")
        entity = self.hub.registry.get(entity_id)
        # Ein Fernseher zählt nur, wenn ein Plan ihn ausdrücklich nennt -
        # dieselbe Frage wie beim Stufenwechsel, also dieselbe Antwort.
        bildschirm = bool(entity is not None and entity.state.get("has_screen"))
        wert = sollwert(self.plaene(), entity_id, self.jetzt_min(), bildschirm)
        if wert is None:
            return
        plan = next(
            (p for p in self.plaene() if gilt_fuer(p, entity_id, bildschirm)),
            {"name": "Lautstärkeplan"},
        )
        asyncio.create_task(self._stellen(entity_id, wert, plan))
