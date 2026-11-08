"""Konsolenzeit: der Wächter, der die Uhr hält und die Konsole schlafen legt.

Die Regeln stehen in ``core/konsolenzeit.py`` (rein, getestet). Hier ist,
was nicht rein sein kann: die Uhr, die Konsolen, die Durchsagen, der
Speicher.

Der Kern der Sache in drei Sätzen - weil sie bestimmen, was dieses Modul
kann und was nicht:

1. **Der Hub weiss nicht, wer am Controller sitzt.** Die PlayStation
   meldet «an» und den Titel, nicht den Spieler. Darum meldet sich das
   Kind an («Ich spiele jetzt»), und die Zeit läuft ab dem Tipp, solange
   die Konsole an ist.
2. **Gezählt wird gemeinsam**, über alle Konsolen des Kindes: Ein Kind,
   zwei Konsolen, ein Konto.
3. **Die PlayStation legt der Hub schlafen** (Ruhemodus). Bei der Switch
   kann er das nicht selbst - dort setzt er Nintendos Kindersicherung,
   und die beendet das Spiel (``integrations/nintendo.py``). Wo eine
   Konsole sich nicht ausschalten lässt, steht das in der Meldung an die
   Eltern; es zu verschweigen hiesse, eine Sperre vorzutäuschen.

Eine Lücke zwischen zwei Takten, die länger als zwei Minuten ist, zählt
nicht als gespielt (Update, Neustart): Wir wissen dann nicht, ob gespielt
wurde, und lieber zwei Minuten zu wenig als zwei zu viel.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Any

from . import konsolenzeit as kz
from . import schulferien
from .errors import HomePilotError
from .users import Role

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)

STORE_PLAENE = "konsolenzeit_plaene"
STORE_TAGE = "konsolenzeit_tage"
STORE_SITZUNGEN = "konsolenzeit_sitzungen"
STORE_EINST = "konsolenzeit_einstellungen"

#: Push-Kategorie (core/push.py) und die Sammelstelle in der App.
KATEGORIE = "konsolenzeit"

#: Wie oft der Wächter nachsieht. 15 Sekunden: genau genug, dass eine
#: Vorwarnung «noch eine Minute» nicht erst bei «null» kommt.
TAKT = 15.0
#: Wie lange eine Konsole aus sein darf, bevor die Sitzung als beendet
#: gilt. Kurz genug, dass «Fertig» ohne Tipp stimmt; lang genug, dass ein
#: Kind, das erst «Ich spiele jetzt» tippt und dann die Konsole weckt,
#: nicht schon abgemeldet ist.
AUS_GNADE = 90.0
#: Wie lange eine Konsole ohne Anmeldung laufen darf, bevor der Hub fragt.
UNBEKANNT_GNADE = 120.0
BEHALTEN_TAGE = 120
#: Wie oft die Höchstzeit der Switch frühestens neu gestellt wird (Sekunden).
LIMIT_MIN_ABSTAND = 30.0
#: «Sitzung» der Erwachsenen: Die Konsole läuft, niemand wird gezählt.
ELTERN = "_eltern"

#: Welche Integrationen Konsolen sind.
KONSOLEN_INTEGRATIONEN = ("playstation", "nintendo")
#: Was der Hub tut, wenn eine Konsole ohne Anmeldung läuft. Vorgabe ist
#: «nie»: Die Erwachsenen spielen an denselben Konsolen, und «Konsole an»
#: heisst darum nicht «ein Kind spielt». Gezählt wird nur, wer sich anmeldet.
UNBEKANNT_WAHL = ("nie", "fragen", "sperren")


def _norm(name: str) -> str:
    return str(name or "").strip().casefold()


class Konsolenwache:
    def __init__(self, hub: Hub) -> None:
        self.hub = hub
        self._task: asyncio.Task[None] | None = None
        #: kind (normiert) → {kind, konsole, seit, zuletzt, spiel, gebucht}
        self._sitzungen: dict[str, dict[str, Any]] = {}
        #: Konsole → seit wann sie ohne Anmeldung läuft.
        self._unbekannt: dict[str, float] = {}
        self._gefragt: set[str] = set()
        self._tage: dict[tuple[str, str], dict[str, Any]] = {}
        #: Konsole → zuletzt eingestellte Höchstzeit (Switch, Minuten oder -1).
        self._limit_gesendet: dict[str, int] = {}
        #: Konsole → Tag, an dem die Zeit um war: Die Sperre hält bis Mitternacht
        #: oder bis sich jemand wieder anmeldet.
        self._ende_sperre: dict[str, str] = {}
        #: Konsole → wann die Höchstzeit zuletzt gestellt wurde (Nintendo mit Mass fragen).
        self._limit_zeit: dict[str, float] = {}

    # ── Speicher ───────────────────────────────────────────────────────

    def restore(self) -> None:
        """Beim Hub-Start: Tageszähler und laufende Sitzungen zurückholen."""
        grenze = (date.today() - timedelta(days=BEHALTEN_TAGE)).isoformat()
        for zeile in self.hub.data.get(STORE_TAGE):
            if isinstance(zeile, dict) and zeile.get("tag", "") >= grenze and zeile.get("kind"):
                self._tage[(_norm(zeile["kind"]), zeile["tag"])] = zeile
        for zeile in self.hub.data.get(STORE_SITZUNGEN):
            if isinstance(zeile, dict) and zeile.get("kind") and zeile.get("konsole"):
                schluessel = (
                    f"{ELTERN}:{zeile['konsole']}" if zeile["kind"] == ELTERN else _norm(zeile["kind"])
                )
                self._sitzungen[schluessel] = dict(zeile)

    def _tage_sichern(self) -> None:
        self.hub.data.set(STORE_TAGE, list(self._tage.values()))

    def _sitzungen_sichern(self) -> None:
        self.hub.data.set(STORE_SITZUNGEN, list(self._sitzungen.values()))

    def _einstellungen(self) -> dict[str, Any]:
        zeilen = self.hub.data.get(STORE_EINST)
        roh = zeilen[0] if zeilen and isinstance(zeilen[0], dict) else {}
        unbekannt = roh.get("unbekannt")
        gesperrt = roh.get("gesperrt")
        return {
            "unbekannt": unbekannt if unbekannt in UNBEKANNT_WAHL else "nie",
            "gesperrt": [str(n) for n in gesperrt] if isinstance(gesperrt, list) else [],
            "nintendo_sperren": bool(roh.get("nintendo_sperren")),
        }

    def einstellungen_setzen(
        self, unbekannt: str | None = None, nintendo_sperren: bool | None = None
    ) -> dict[str, Any]:
        roh = self._einstellungen()
        if unbekannt is not None:
            if unbekannt not in UNBEKANNT_WAHL:
                raise HomePilotError("«nie», «fragen» oder «sperren» - etwas anderes gibt es nicht.")
            roh["unbekannt"] = unbekannt
        if nintendo_sperren is not None:
            roh["nintendo_sperren"] = bool(nintendo_sperren)
        self.hub.data.set(STORE_EINST, [roh])
        self._geaendert()
        return roh

    def plaene(self) -> dict[str, dict[str, Any]]:
        """Alle eingerichteten Pläne, nach Name (normiert)."""
        raus: dict[str, dict[str, Any]] = {}
        for zeile in self.hub.data.get(STORE_PLAENE):
            if isinstance(zeile, dict) and zeile.get("kind"):
                raus[_norm(zeile["kind"])] = {**kz.plan_lesen(zeile), "kind": zeile["kind"]}
        return raus

    def plan(self, kind: str) -> dict[str, Any]:
        gefunden = self.plaene().get(_norm(kind))
        return gefunden or {**kz.plan_lesen({}), "kind": kind}

    def plan_setzen(self, kind: str, roh: Any) -> dict[str, Any]:
        name = str(kind or "").strip()
        if not name:
            raise HomePilotError("Für wen? Ohne Namen gibt es keinen Plan.")
        neu = {**kz.plan_lesen(roh), "kind": name}
        zeilen = [
            z for z in self.hub.data.get(STORE_PLAENE)
            if isinstance(z, dict) and _norm(z.get("kind", "")) != _norm(name)
        ]
        zeilen.append(neu)
        self.hub.data.set(STORE_PLAENE, zeilen)
        self._geaendert()
        return neu

    def _geaendert(self) -> None:
        """Den offenen Apps Bescheid sagen - sie holen die Lage selbst."""
        try:
            asyncio.get_running_loop().create_task(
                self.hub.bus.publish(
                    "family_changed", {"collection": "konsolenzeit"}
                )
            )
        except RuntimeError:
            pass  # kein Ereignisschleife (Test, Start) - dann gibt es keine App

    # ── Zählerstand ────────────────────────────────────────────────────

    def _zeile(self, kind: str, tag: date, anlegen: bool = True) -> dict[str, Any]:
        """Der Zähler eines Tages. Zum Ansehen (``anlegen=False``) entsteht
        keine Zeile: Die App fragt oft, und jede Anfrage soll nicht einen
        leeren Tag in die Datendatei schreiben."""
        schluessel = (_norm(kind), kz.tag_schluessel(tag))
        zeile = self._tage.get(schluessel)
        if zeile is None:
            zeile = {
                "kind": kind, "tag": schluessel[1], "gesamt": 0.0, "konsolen": {},
                "bonus": 0, "frei": False, "verlauf": [],
            }
            if anlegen:
                self._tage[schluessel] = zeile
        return zeile

    def _monat_s(self, kind: str, tag: date) -> float:
        wurzel = _norm(kind)
        return kz.monat_summe(
            {t: z for (k, t), z in self._tage.items() if k == wurzel}, tag
        )

    def _ferien(self, tag: date) -> bool:
        return schulferien.ferien_am(self.hub.data.get(schulferien.STORE_KEY), tag) is not None

    def _rest(
        self, kind: str, plan: dict[str, Any], wann: float,
        heute_s: float | None = None, monat_s: float | None = None,
    ) -> dict[str, Any]:
        stunde = datetime.fromtimestamp(wann)
        tag = stunde.date()
        zeile = self._zeile(kind, tag, anlegen=False)
        return kz.rest_sekunden(
            plan,
            tag,
            stunde.hour * 60 + stunde.minute + stunde.second / 60.0,
            zeile["gesamt"] if heute_s is None else heute_s,
            self._monat_s(kind, tag) if monat_s is None else monat_s,
            bonus_minuten=zeile.get("bonus", 0),
            frei=bool(zeile.get("frei")),
            gesperrt=_norm(kind) in {_norm(n) for n in self._einstellungen()["gesperrt"]},
            ferien=self._ferien(tag),
        )

    # ── Konsolen ───────────────────────────────────────────────────────

    def konsolen(self) -> list[dict[str, Any]]:
        """Alle Konsolen, die der Hub kennt - für die Auswahl im Plan."""
        raus = []
        for entity in self.hub.registry.all():
            if entity.integration in KONSOLEN_INTEGRATIONEN:
                raus.append({
                    "id": entity.id,
                    "name": entity.label,
                    "integration": entity.integration,
                    "an": str(entity.state.get("state") or "") == "on",
                    "spiel": entity.state.get("app") or None,
                    "erreichbar": entity.available,
                    "raum": entity.room,
                })
        return raus

    def _laeuft(self, konsole_id: str) -> bool:
        entity = self.hub.registry.get(konsole_id)
        return entity is not None and str(entity.state.get("state") or "") == "on"

    async def _abschalten(self, konsole_id: str, jetzt: float | None = None) -> str | None:
        """Die Konsole schlafen legen - ehrlich, ob und wie es geklappt hat.

        ``"aus"``: ausgeschaltet (PlayStation, Ruhemodus). ``"gesperrt"``:
        Die Höchstzeit steht auf dem, was schon gespielt ist, und die
        Konsole beendet das Spiel selbst (Switch, Nintendos Kindersicherung)
        - ausschalten kann der Hub sie nicht. ``None``: ging nicht.
        """
        entity = self.hub.registry.get(konsole_id)
        if entity is None:
            return None
        try:
            if "turn_off" in entity.commands:
                await self.hub.integrations.dispatch_command(konsole_id, "turn_off", {})
                return "aus"
            if "set_limit" in entity.commands:
                minuten = kz.nintendo_limit(entity.state.get("playing_min") or 0, 0)
                await self.hub.integrations.dispatch_command(
                    konsole_id, "set_limit", {"minutes": minuten}
                )
                self._limit_gesendet[konsole_id] = minuten
                self._ende_sperre[konsole_id] = kz.tag_schluessel(
                    datetime.fromtimestamp(jetzt or time.time()).date()
                )
                return "gesperrt"
        except Exception as err:
            log.warning("Konsolenzeit: %s liess sich nicht beenden: %s", konsole_id, err)
        return None

    # ── Sitzungen ──────────────────────────────────────────────────────

    def spielen(self, kind: str, konsole_id: str, jetzt: float | None = None) -> dict[str, Any]:
        """«Ich spiele jetzt» - die Zeit läuft ab hier."""
        jetzt = jetzt or time.time()
        plan = self.plan(kind)
        if not plan["aktiv"]:
            raise HomePilotError(f"Für {kind} ist keine Konsolenzeit eingerichtet.")
        if konsole_id not in plan["konsolen"]:
            raise HomePilotError(f"{kind} darf an dieser Konsole nicht spielen.")
        entity = self.hub.registry.get(konsole_id)
        if entity is None:
            raise HomePilotError("Diese Konsole kennt der Hub nicht.")
        rest = self._rest(kind, plan, jetzt)
        if rest["rest_s"] is not None and rest["rest_s"] <= 0:
            raise HomePilotError(kz.ende_text(kind, rest["grund"]))
        # Eine Konsole hat einen Spieler: Wer sich dort anmeldet, löst den
        # vorigen ab (Geschwister, die sich abwechseln).
        for andere, sitzung in list(self._sitzungen.items()):
            if sitzung["konsole"] == konsole_id and andere != _norm(kind):
                del self._sitzungen[andere]
        self._sitzungen[_norm(kind)] = {
            "kind": kind, "konsole": konsole_id, "seit": jetzt, "zuletzt": jetzt,
            "spiel": entity.state.get("app") or None, "gebucht": 0.0,
        }
        self._unbekannt.pop(konsole_id, None)
        self._ende_sperre.pop(konsole_id, None)
        self._sitzungen_sichern()
        self._geaendert()
        return self._sitzungen[_norm(kind)]

    def eltern_spielen(self, konsole_id: str, jetzt: float | None = None) -> None:
        """Die Erwachsenen spielen: Die Konsole läuft, niemand wird gezählt."""
        jetzt = jetzt or time.time()
        if self.hub.registry.get(konsole_id) is None:
            raise HomePilotError("Diese Konsole kennt der Hub nicht.")
        for andere, sitzung in list(self._sitzungen.items()):
            if sitzung["konsole"] == konsole_id:
                del self._sitzungen[andere]
        self._sitzungen[ELTERN + ":" + konsole_id] = {
            "kind": ELTERN, "konsole": konsole_id, "seit": jetzt, "zuletzt": jetzt,
            "gebucht": 0.0,
        }
        self._unbekannt.pop(konsole_id, None)
        self._ende_sperre.pop(konsole_id, None)
        self._sitzungen_sichern()
        self._geaendert()

    def stoppen(self, kind: str, jetzt: float | None = None) -> bool:
        """«Fertig»: die Zeit hält an. Die Konsole bleibt, wie sie ist."""
        sitzung = self._sitzungen.pop(_norm(kind), None)
        if sitzung is None:
            return False
        self._verlauf_vermerken(sitzung, jetzt or time.time())
        self._sitzungen_sichern()
        self._tage_sichern()
        self._geaendert()
        return True

    def _verlauf_vermerken(self, sitzung: dict[str, Any], jetzt: float) -> None:
        if sitzung["kind"] == ELTERN or sitzung.get("gebucht", 0) < 30:
            return
        zeile = self._zeile(sitzung["kind"], datetime.fromtimestamp(jetzt).date())
        zeile["verlauf"] = (zeile["verlauf"] + [{
            "konsole": sitzung["konsole"], "spiel": sitzung.get("spiel"),
            "von": sitzung["seit"], "bis": jetzt, "sekunden": round(sitzung["gebucht"]),
        }])[-20:]

    # ── Entscheidungen der Eltern ──────────────────────────────────────

    def geben(self, kind: str, minuten: float, jetzt: float | None = None) -> dict[str, Any]:
        if not (0 < minuten <= 240):
            raise HomePilotError("Zwischen einer Minute und vier Stunden.")
        zeile = self._zeile(kind, datetime.fromtimestamp(jetzt or time.time()).date())
        zeile["bonus"] = int(zeile.get("bonus", 0)) + round(minuten)
        self._tage_sichern()
        self._geaendert()
        return zeile

    def frei_setzen(self, kind: str, an: bool, jetzt: float | None = None) -> None:
        zeile = self._zeile(kind, datetime.fromtimestamp(jetzt or time.time()).date())
        zeile["frei"] = bool(an)
        self._tage_sichern()
        self._geaendert()

    def sperre_setzen(self, kind: str, an: bool) -> None:
        roh = self._einstellungen()
        namen = [n for n in roh["gesperrt"] if _norm(n) != _norm(kind)]
        if an:
            namen.append(kind)
        roh["gesperrt"] = namen
        self.hub.data.set(STORE_EINST, [roh])
        self._geaendert()

    # ── Lage für die App ───────────────────────────────────────────────

    def lage(self, kind: str, jetzt: float | None = None) -> dict[str, Any]:
        jetzt = jetzt or time.time()
        plan = self.plan(kind)
        stunde = datetime.fromtimestamp(jetzt)
        tag = stunde.date()
        zeile = self._zeile(kind, tag, anlegen=False)
        rest = self._rest(kind, plan, jetzt)
        monat_s = self._monat_s(kind, tag)
        sitzung = self._sitzungen.get(_norm(kind))
        vergangene = sorted(
            (z for (k, t), z in self._tage.items() if k == _norm(kind) and t < kz.tag_schluessel(tag)),
            key=lambda z: z["tag"], reverse=True,
        )[:7]
        return {
            "kind": kind,
            "plan": plan,
            "heute": {
                "gesamt_s": round(zeile["gesamt"]),
                "konsolen": {k: round(v) for k, v in zeile["konsolen"].items()},
                "bonus": zeile.get("bonus", 0),
                "frei": bool(zeile.get("frei")),
                "verlauf": zeile["verlauf"],
                "regel": rest["regel"],
            },
            "rest_s": None if rest["rest_s"] is None else round(rest["rest_s"]),
            "grund": rest["grund"],
            "monat": {
                "gespielt_s": round(monat_s),
                "limit_min": plan["monat"],
                "tempo": kz.monatstempo(monat_s, plan["monat"], tag),
            },
            "gesperrt": _norm(kind) in {_norm(n) for n in self._einstellungen()["gesperrt"]},
            "sitzung": None if sitzung is None else {
                "konsole": sitzung["konsole"], "seit": sitzung["seit"],
                "spiel": sitzung.get("spiel"),
            },
            "tage": [
                {"tag": z["tag"], "gesamt_s": round(z["gesamt"]), "konsolen": {
                    k: round(v) for k, v in z["konsolen"].items()}, "verlauf": z["verlauf"]}
                for z in vergangene
            ],
            "ferien": self._ferien(tag),
        }

    def uebersicht(self, jetzt: float | None = None) -> dict[str, Any]:
        return {
            "kinder": [self.lage(plan["kind"], jetzt) for plan in self.plaene().values()],
            "konsolen": self.konsolen(),
            "einstellungen": self._einstellungen(),
            "eltern": [
                {"konsole": s["konsole"], "seit": s["seit"]}
                for s in self._sitzungen.values() if s["kind"] == ELTERN
            ],
        }

    # ── Takt ───────────────────────────────────────────────────────────

    def start(self) -> None:
        self.restore()
        self._task = asyncio.create_task(self._lauf())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        self._sitzungen_sichern()
        self._tage_sichern()

    async def _lauf(self) -> None:
        # Kurz warten, bis die Integrationen ihre Konsolen gemeldet haben:
        # Eine Sitzung, deren Konsole noch «unbekannt» ist, gälte sonst als
        # beendet.
        await asyncio.sleep(10)
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Konsolenzeit: Durchgang fehlgeschlagen")
            await asyncio.sleep(TAKT)

    async def tick(self, jetzt: float | None = None) -> None:
        """Ein Durchgang: Zeit buchen, warnen, abschalten, nachfragen."""
        jetzt = jetzt or time.time()
        geaendert = False
        for schluessel, sitzung in list(self._sitzungen.items()):
            if await self._sitzung_takten(schluessel, sitzung, jetzt):
                geaendert = True
        await self._unbekannte_pruefen(jetzt)
        await self._grenzen_stellen(jetzt)
        if geaendert:
            self._geaendert()

    async def _sitzung_takten(self, schluessel: str, sitzung: dict[str, Any], jetzt: float) -> bool:
        """Eine Sitzung weiterzählen. True, wenn sich für die App etwas änderte."""
        seit_letztem = jetzt - sitzung["zuletzt"]
        sitzung["zuletzt"] = jetzt
        if not self._laeuft(sitzung["konsole"]):
            aus_seit = sitzung.setdefault("aus_seit", jetzt)
            if jetzt - aus_seit > AUS_GNADE:
                self._sitzungen.pop(schluessel, None)
                self._verlauf_vermerken(sitzung, jetzt)
                self._sitzungen_sichern()
                self._tage_sichern()
                return True
            return False
        sitzung.pop("aus_seit", None)
        if sitzung["kind"] == ELTERN:
            return False

        kind = sitzung["kind"]
        plan = self.plan(kind)
        # Die Zeit kommt vom Tipp des Kindes, nicht von der Konsole: Die
        # Erwachsenen spielen an denselben Geräten, und was die Konsole
        # selbst zählt (Nintendos Minuten) gehörte sonst dem Kind mit. Die
        # Konsole sagt dem Hub nur, wann es **vorbei** ist (aus), nie,
        # dass jemand spielt.
        entity = self.hub.registry.get(sitzung["konsole"])
        gebucht = kz.luecke_zaehlt(seit_letztem)
        zeile = self._zeile(kind, datetime.fromtimestamp(jetzt).date())
        vorher = self._rest(kind, plan, jetzt - gebucht)
        zeile["gesamt"] += gebucht
        konsolen = zeile["konsolen"]
        konsolen[sitzung["konsole"]] = konsolen.get(sitzung["konsole"], 0.0) + gebucht
        sitzung["gebucht"] = sitzung.get("gebucht", 0.0) + gebucht
        if entity is not None and entity.state.get("app"):
            sitzung["spiel"] = entity.state.get("app")
        nachher = self._rest(kind, plan, jetzt)

        stufe = kz.warnstufe(vorher["rest_s"], nachher["rest_s"], plan["warnungen"])
        if stufe is not None:
            await self._vorwarnen(kind, plan, sitzung["konsole"], stufe)
        if nachher["rest_s"] is not None and nachher["rest_s"] <= 0:
            await self._zeit_um(kind, plan, sitzung, nachher["grund"], jetzt)
        return True

    # ── Meldungen ──────────────────────────────────────────────────────

    async def _vorwarnen(self, kind: str, plan: dict[str, Any], konsole_id: str, minuten: int) -> None:
        if plan["durchsage"]:
            await self._ansage(konsole_id, kz.warn_text(kind, minuten))

    async def _zeit_um(
        self, kind: str, plan: dict[str, Any], sitzung: dict[str, Any], grund: str, jetzt: float
    ) -> None:
        konsole_id = sitzung["konsole"]
        self._sitzungen.pop(_norm(kind), None)
        self._verlauf_vermerken(sitzung, jetzt)
        self._sitzungen_sichern()
        self._tage_sichern()
        if plan["durchsage"]:
            await self._ansage(konsole_id, kz.ende_text(kind, grund))
        aus = await self._abschalten(konsole_id, jetzt) if plan["abschalten"] else None
        if plan["eltern_melden"]:
            zeile = self._zeile(kind, datetime.fromtimestamp(jetzt).date())
            namen = {k["id"]: k["name"] for k in self.konsolen()}
            teile = ", ".join(
                f"{namen.get(k, k)} {kz.dauer_text(v)}" for k, v in zeile["konsolen"].items() if v >= 30
            )
            titel = (
                f"{kind}: Monatszeit aufgebraucht" if grund == kz.GRUND_MONAT
                else f"{kind}: Konsolenzeit aufgebraucht"
            )
            text = f"{kz.dauer_text(zeile['gesamt'])} gespielt" + (f" ({teile})" if teile else "") + "."
            if plan["abschalten"]:
                text += {
                    "aus": " Die Konsole ruht.",
                    "gesperrt": " Nintendo beendet das Spiel.",
                }.get(aus or "", " Die Konsole liess sich nicht ausschalten.")
            await self._eltern_melden(titel, text)

    def _limit_ziel(self, entity: Any, jetzt: float) -> int | None:
        """Welche Höchstzeit der Hub an dieser Konsole will - None: keine (rein lesend).

        Nur Konsolen mit Befehl ``set_limit`` (die Switch). Drei Fälle:

        - Die Erwachsenen spielen: keine Grenze (-1).
        - Ein Kind ist angemeldet: Spielzeit, die Nintendo schon zählt,
          plus das, was dem Kind bleibt. Damit beendet die Konsole das Spiel
          auf die Minute selbst, auch wenn der Hub gerade nicht hinsieht.
        - Niemand ist angemeldet: Nur wenn die Eltern «Switch gesperrt
          halten» gewählt haben, steht die Grenze auf dem Gespielten - sonst
          lässt der Hub die Konsole in Ruhe (und stellt zurück, was die
          Eltern dort selbst eingestellt hatten).
        """
        gespielt = entity.state.get("playing_min") or 0
        for sitzung in self._sitzungen.values():
            if sitzung["konsole"] != entity.id:
                continue
            if sitzung["kind"] == ELTERN:
                return -1
            plan = self.plan(sitzung["kind"])
            return kz.nintendo_limit(gespielt, self._rest(sitzung["kind"], plan, jetzt)["rest_s"])
        # Die Zeit war um: Die Sperre hält, bis jemand sich anmeldet oder
        # der Tag wechselt - sonst höbe der nächste Takt sie sofort wieder auf.
        if self._ende_sperre.get(entity.id) == kz.tag_schluessel(datetime.fromtimestamp(jetzt).date()):
            return kz.nintendo_limit(gespielt, 0)
        self._ende_sperre.pop(entity.id, None)
        if self._einstellungen()["nintendo_sperren"] and any(
            p["aktiv"] and entity.id in p["konsolen"] for p in self.plaene().values()
        ):
            return kz.nintendo_limit(gespielt, 0)
        return None

    async def _grenzen_stellen(self, jetzt: float) -> None:
        """Die Höchstzeit an den Konsolen nachführen, die sich so steuern lassen."""
        for entity in self.hub.registry.all():
            if "set_limit" not in entity.commands:
                continue
            ziel = self._limit_ziel(entity, jetzt)
            zuletzt = self._limit_gesendet.get(entity.id)
            if ziel is None:
                if zuletzt is None:
                    continue
                aufruf: dict[str, Any] = {}  # ohne Minuten: zurückstellen
                self._limit_gesendet.pop(entity.id, None)
            elif ziel == zuletzt or (zuletzt is None and entity.state.get("limit_min") == ziel):
                self._limit_gesendet[entity.id] = ziel
                continue
            elif (
                zuletzt is not None
                and ziel > 0
                and zuletzt > 0
                and jetzt - self._limit_zeit.get(entity.id, 0.0) < LIMIT_MIN_ABSTAND
            ):
                # Die Zeit des Kindes läuft nach der Uhr, Nintendos Grenze
                # ändert sich dann jede Minute: Nicht jede Minute die Cloud
                # fragen, sondern alle halbe Minute höchstens.
                continue
            else:
                aufruf = {"minutes": ziel}
            try:
                await asyncio.wait_for(
                    self.hub.integrations.dispatch_command(entity.id, "set_limit", aufruf), 20
                )
                if ziel is not None:
                    self._limit_gesendet[entity.id] = ziel
                    self._limit_zeit[entity.id] = jetzt
            except Exception as err:
                log.warning("Konsolenzeit: Höchstzeit für %s nicht gestellt: %s", entity.id, err)

    async def _unbekannte_pruefen(self, jetzt: float) -> None:
        """Läuft eine Konsole eines Kindes, ohne dass sich jemand anmeldete?"""
        if self._einstellungen()["unbekannt"] == "nie":
            self._unbekannt.clear()
            self._gefragt.clear()
            return
        plaene = [p for p in self.plaene().values() if p["aktiv"]]
        belegt = {s["konsole"] for s in self._sitzungen.values()}
        einst = self._einstellungen()
        for konsole in {k for p in plaene for k in p["konsolen"]}:
            if konsole in belegt or not self._laeuft(konsole):
                self._unbekannt.pop(konsole, None)
                self._gefragt.discard(konsole)
                continue
            seit = self._unbekannt.setdefault(konsole, jetzt)
            if jetzt - seit < UNBEKANNT_GNADE or konsole in self._gefragt:
                continue
            self._gefragt.add(konsole)
            namen = {k["id"]: k["name"] for k in self.konsolen()}
            name = namen.get(konsole, konsole)
            if einst["unbekannt"] == "sperren":
                aus = await self._abschalten(konsole, jetzt)
                await self._eltern_melden(
                    f"{name} läuft – niemand angemeldet",
                    {"aus": "Der Hub hat sie ausgeschaltet.", "gesperrt": "Nintendo beendet das Spiel."}.get(
                        aus or "", "Sie liess sich nicht ausschalten."
                    ),
                )
            else:
                await self._eltern_melden(
                    f"{name} läuft – wer spielt?",
                    "Niemand ist angemeldet. In der App unter Familie das Kind wählen.",
                )

    async def _ansage(self, konsole_id: str, text: str) -> None:
        """Durchsage auf den Boxen im Raum der Konsole - sonst keine."""
        entity = self.hub.registry.get(konsole_id)
        raeume = set(entity.rooms or ([entity.room] if entity.room else [])) if entity else set()
        boxen = [
            e.id for e in self.hub.registry.all()
            if "play_url" in e.commands and raeume & set(e.rooms or ([e.room] if e.room else []))
        ]
        if not boxen:
            log.info("Konsolenzeit: keine Box im Raum von %s - keine Durchsage", konsole_id)
            return
        try:
            from . import say

            await say.speak(self.hub, text, speakers=boxen)
        except Exception as err:
            log.info("Konsolenzeit ohne Durchsage: %s", err)

    async def _eltern_melden(self, titel: str, text: str) -> None:
        try:
            tokens: list[str] = []
            for rolle in (Role.OWNER, Role.RESIDENT):
                for token in self.hub.push.recipients(self.hub.users.users, rolle, KATEGORIE):
                    if token not in tokens:
                        tokens.append(token)
            await self.hub.push.send(
                tokens, title=titel, body=text,
                data={"type": KATEGORIE, "ziel": "familie:members"}, category=KATEGORIE,
            )
        except Exception:
            log.exception("Konsolenzeit-Push nicht zustellbar")
