"""Ereignisprotokoll je Gerät: wann schaltete es, und wer war es.

Der Verlauf auf der Startseite zeigt alles durcheinander und lebt nur in
der App - nach dem nächsten Öffnen ist er leer. Für die Frage «warum ging
dieses Licht um drei Uhr an?» braucht es das Gedächtnis auf dem Hub: je
Gerät, mit Quelle (Benutzer, Ablauf, Szene, Simulation - oder das Gerät
selbst, wenn jemand am Schalter gedrückt hat).

Gehalten wird es im Speicher und gesichert in einer eigenen Datei neben
der Datendatei. Hier stand einmal, das Protokoll sei bewusst flüchtig -
ein Schreibvorgang je Ereignis wäre Dauerlast. Das stimmt, beantwortet
aber die falsche Frage: Nicht jedes Ereignis muss auf die Platte,
sondern der Stand alle paar Minuten. Und ohne das war der Verlauf nach
jedem Update leer - also genau dann, wenn man ihn braucht, weil sich
etwas geändert hat.

Eine eigene Datei und nicht `hub.data`: Zweitausend Einträge sind ein
paar hundert Kilobyte, und die Datendatei wird bei jeder Kleinigkeit neu
geschrieben. Ein Protokoll gehört nicht in denselben Zug.
"""

from __future__ import annotations

import json
import logging
import time
from collections import deque
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# So viele Ereignisse insgesamt. Ein Ringpuffer: Das älteste fällt raus.
LIMIT = 2000

# So selten wird gesichert. Fünf Minuten heisst: Im schlimmsten Fall
# fehlen nach einem harten Absturz fünf Minuten Protokoll - und die
# Platte sieht statt Dauerlast einen Schreibvorgang je Kaffeepause.
SICHERUNGS_TAKT = 300.0

# Nur Gerätearten, bei denen ein Zustandswechsel eine Handlung ist.
# Sensoren (Temperatur, Helligkeit) ändern sich im Minutentakt und würden
# den Puffer fluten, ohne die Warum-Frage je zu beantworten - für sie
# gibt es die Messwert-Kurve.
KINDS = frozenset(
    {
        "light",
        "switch",
        "cover",
        "lock",
        "climate",
        "vacuum",
        "appliance",
        "media_player",
        "binary_sensor",
        "alarm",
    }
)


# Ab wie vielen Prozentpunkten eine Store-Fahrt ins Protokoll gehört,
# auch wenn sie «offen» bleibt. Ohne Schwelle stünde jede Zwischenstellung
# einer fahrenden Store darin - die Overkiz-Abfrage sieht während einer
# Fahrt ein halbes Dutzend davon. Fünfundzwanzig Punkte sind ein
# Handgriff, keine Zwischenstellung.
POSITIONS_SCHWELLE = 25


def worth_recording(kind: str, old: dict[str, Any], new: dict[str, Any]) -> bool:
    """Gehört dieser Wechsel ins Protokoll? (rein, testbar)

    Echte Zustandswechsel («on» → «off»), keine Attribut-Zappelei wie
    eine neue Helligkeit beim ohnehin brennenden Licht.

    Eine Ausnahme gibt es: eine Store, die offen bleibt und trotzdem
    fährt. «Halb runter» ist ein Handgriff wie jeder andere, nur meldet
    das Gerät ihn nicht als Zustandswechsel - und ohne diese Ausnahme
    stünde er nirgends.
    """
    if kind not in KINDS:
        return False
    if str(old.get("state")) != str(new.get("state")):
        return True
    if kind == "lock":
        # Der Riegel sagt nichts darüber, ob die Türe offen *steht*. Wer
        # sie aufmacht, ohne am Schloss zu drehen, änderte bisher nichts,
        # was das Protokoll gesehen hätte - und «seit wann offen?» war
        # damit nicht zu beantworten.
        return str(old.get("door") or "") != str(new.get("door") or "")
    if kind != "cover":
        return False
    return _positions_sprung(old.get("position"), new.get("position"))


def _positions_sprung(alt: Any, neu: Any) -> bool:
    """Ist die Store weit genug gefahren? (rein, testbar)"""
    try:
        vorher, nachher = float(alt), float(neu)
    except (TypeError, ValueError):
        return False
    return abs(nachher - vorher) >= POSITIONS_SCHWELLE


def detail_text(kind: str, state: dict[str, Any]) -> str | None:
    """Was den Eintrag erklärt, in wenigen Worten (rein, testbar).

    «Geöffnet» allein sagt bei einer Store nicht, wie weit; «Spielt»
    nicht, was. Der Zustand steht in der Liste ohnehin - hier kommt das
    dazu, was ihn im Rückblick unterscheidbar macht.
    """
    if kind == "cover" and state.get("position") is not None:
        try:
            return f"auf {int(round(float(state['position'])))} %"
        except (TypeError, ValueError):
            return None
    if kind == "media_player":
        titel = str(state.get("track") or "").strip()
        return titel or None
    if kind == "climate":
        ziel = state.get("target_temperature", state.get("target"))
        if ziel is not None:
            try:
                return f"Ziel {float(ziel):.1f} °C"
            except (TypeError, ValueError):
                return None
    if kind == "light" and state.get("state") == "on":
        hell = state.get("brightness")
        if hell is not None:
            try:
                return f"{int(round(float(hell)))} %"
            except (TypeError, ValueError):
                return None
    return None


def ist_offen(kind: str, eintrag: dict[str, Any]) -> bool:
    """Sagt dieser Protokolleintrag «offen»? (rein, testbar)

    Ein Schloss hat zwei Auskünfte: den Riegel (``state``) und den
    Türsensor (``door``). Gemeint ist hier der Sensor - abgeschlossen und
    offen ist bei einer Haustüre mit Falle kein Widerspruch.
    """
    if kind == "lock":
        return str(eintrag.get("door") or "") == "open"
    return str(eintrag.get("state") or "") == "on"


class EventLog:
    def __init__(self, path: Path | str | None = None) -> None:
        self._events: deque[dict[str, Any]] = deque(maxlen=LIMIT)
        # Wann dieses Protokoll zu zählen begann. Ohne diesen Zeitpunkt
        # lässt sich «nichts aufgezeichnet» nicht von «nichts passiert»
        # unterscheiden: Beides sieht in der App gleich aus, meint aber
        # Gegenteiliges - einmal fehlt das Gedächtnis, einmal die Handlung.
        self.started = time.time()
        self._path = Path(path) if path else None
        self._letzte_sicherung = 0.0
        self._schmutzig = False
        if self._path is not None:
            self.load()

    # ── Auf die Platte und zurück ──────────────────────────────────────

    def load(self) -> None:
        """Das Protokoll des letzten Laufs holen.

        Ein kaputter oder halb geschriebener Stand ist kein Grund, den
        Hub nicht zu starten - dann beginnt das Protokoll eben leer, wie
        früher immer.
        """
        if self._path is None or not self._path.is_file():
            return
        try:
            roh = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as err:
            log.warning("Verlauf nicht lesbar (%s) - er beginnt neu", err)
            return
        ereignisse = roh.get("events") if isinstance(roh, dict) else None
        if not isinstance(ereignisse, list):
            return
        self._events.extend(
            eintrag for eintrag in ereignisse if isinstance(eintrag, dict)
        )
        # Der Anfang ist jetzt der des *ersten* Laufs, nicht dieses hier -
        # sonst behauptete die App, alles Ältere sei nie passiert.
        beginn = roh.get("started") if isinstance(roh, dict) else None
        if isinstance(beginn, (int, float)) and beginn > 0:
            self.started = float(beginn)
        log.info("Verlauf mit %d Einträgen geladen", len(self._events))

    def save(self, force: bool = False) -> None:
        """Den Stand sichern - gedrosselt, ausser beim Herunterfahren."""
        if self._path is None or not self._schmutzig:
            return
        jetzt = time.time()
        if not force and jetzt - self._letzte_sicherung < SICHERUNGS_TAKT:
            return
        self._letzte_sicherung = jetzt
        self._schmutzig = False
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            # Erst daneben, dann umbenennen: Ein Stromausfall mitten im
            # Schreiben soll nicht die Datei zerstören, die er sichern soll.
            neben = self._path.with_suffix(".tmp")
            neben.write_text(
                json.dumps(
                    {"started": self.started, "events": list(self._events)},
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            neben.replace(self._path)
        except OSError as err:
            log.warning("Verlauf nicht schreibbar: %s", err)

    def record(self, _event_type: str, data: dict[str, Any]) -> None:
        """Bus-Listener für state_changed - still bei allem Unpassenden."""
        entity = data.get("entity") or {}
        kind = str(entity.get("kind") or "")
        old = data.get("old_state") or {}
        new = data.get("new_state") or {}
        if not worth_recording(kind, old, new):
            return
        source = data.get("source") or {}
        self._schmutzig = True
        eintrag: dict[str, Any] = {
            "entity_id": str(data.get("entity_id") or ""),
            "state": new.get("state"),
            "at": time.time(),
            "source": {
                "kind": source.get("kind"),
                "label": source.get("label"),
            },
        }
        detail = detail_text(kind, new)
        if detail:
            eintrag["detail"] = detail
        # Getrennt vom Zustand, weil es etwas anderes ist: Ein Schloss
        # kann abgeschlossen sein, während die Türe offen steht.
        if kind == "lock" and new.get("door") is not None:
            eintrag["door"] = str(new.get("door"))
        self._events.append(eintrag)

    def all(self) -> list[dict[str, Any]]:
        """Alle gemerkten Ereignisse, älteste zuerst.

        Für die Musterkennung (core/suggest.py). Der Ring hält rund 2000
        Ereignisse - was hier steht, ist die jüngere Vergangenheit, nicht
        das Archiv.
        """
        return list(self._events)

    def for_entity(self, entity_id: str, limit: int = 50) -> list[dict[str, Any]]:
        """Die letzten Ereignisse eines Geräts, jüngste zuerst."""
        found = [
            event for event in self._events if event["entity_id"] == entity_id
        ]
        return list(reversed(found))[:limit]

    def offen_seit(self, entity_id: str, kind: str) -> float | None:
        """Seit wann steht dieser Kontakt ununterbrochen offen?

        None heisst «weiss ich nicht» - dann steht im Protokoll nichts
        über dieses Gerät, und der Wächter bleibt bei seiner eigenen
        Zählung. Geraten wird hier nicht: Eine Zeit, die der Hub sich
        ausdenkt, steht am Ende als «seit drei Stunden» im Telefon.

        Gelesen wird von der jüngsten Meldung rückwärts, solange sie
        «offen» sagt. Die älteste davon ist der Moment des Öffnens - und
        eine Meldung «zu» dazwischen beendet die Suche, denn dann war die
        Türe in der Zwischenzeit zu.
        """
        seit: float | None = None
        for eintrag in self.for_entity(entity_id, limit=200):
            if not ist_offen(kind, eintrag):
                break
            wert = eintrag.get("at")
            if isinstance(wert, (int, float)):
                seit = float(wert)
        return seit

    def letzter_wechsel(
        self, entity_id: str, kind: str, state: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Der Eintrag, mit dem der *jetzige* Zustand begann - oder None.

        Damit «seit wann?» einen Neustart übersteht. Der Zeitpunkt am
        Gerät (``Entity.last_change``) entsteht, wenn der Hub den Wechsel
        selbst miterlebt; nach einem Update war er leer, und im Blatt
        «Fenster offen» stand neben der Terrassentüre nichts. Ausgerechnet
        dann, denn eine Türe, die schon vor dem Update offen stand, steht
        lange offen.

        Gelesen wird von der jüngsten Meldung rückwärts, solange sie
        denselben Zustand nennt; die älteste davon ist der Moment des
        Wechsels. Sagt schon die jüngste etwas anderes, kommt None
        zurück: Dann hat sich der Zustand geändert, während der Hub nicht
        lief, und wann das war, weiss hier niemand. Geraten wird nicht -
        eine ausgedachte Zeit steht am Ende als «seit drei Stunden» im
        Telefon.

        Beim Schloss zählen beide Auskünfte: Der Riegel kann sich gedreht
        haben, ohne dass die Türe zuging, und umgekehrt.
        """
        zustand = str(state.get("state") or "")
        tuer = str(state.get("door") or "") if kind == "lock" else ""
        treffer: dict[str, Any] | None = None
        for eintrag in self.for_entity(entity_id, limit=LIMIT):
            if str(eintrag.get("state") or "") != zustand:
                break
            if kind == "lock" and str(eintrag.get("door") or "") != tuer:
                break
            treffer = eintrag
        return treffer

    def rueckblick(
        self, stunden: int = 24, limit: int = 300, sichtbar: Any = None
    ) -> list[dict[str, Any]]:
        """Was im Haus los war - jüngste zuerst.

        Der Verlauf je Gerät beantwortet «warum ging *das* an?». Diese
        Frage ist eine andere: «Was war heute los?» Sie liess sich nur
        beantworten, indem man jede Kachel einzeln aufmachte - und wer
        das täte, hätte die Antwort nach zwanzig Kacheln vergessen.

        ``sichtbar`` ist ein Filter: Wer ein Gerät nicht sehen darf, soll
        es auch im Rückblick nicht finden.
        """
        grenze = time.time() - max(1, stunden) * 3600
        raus: list[dict[str, Any]] = []
        for eintrag in reversed(self._events):
            wann = eintrag.get("at")
            if not isinstance(wann, (int, float)) or wann < grenze:
                break
            if sichtbar is not None and not sichtbar(str(eintrag.get("entity_id") or "")):
                continue
            raus.append(eintrag)
            if len(raus) >= limit:
                break
        return raus

    def span(self) -> dict[str, Any]:
        """Wie weit das Protokoll zurückreicht - und warum nicht weiter.

        Eine Kurve ohne diese Angabe ist nicht zu lesen: Zwei Einträge
        heissen entweder «hier passiert wenig» oder «der Hub lief erst
        zehn Minuten», und die App kann das von sich aus nicht wissen.

        `full` sagt, ob der Ring bereits übergelaufen ist. Dann ist der
        Anfang nicht mehr der Start des Hubs, sondern die Kante des
        Puffers - und älteres ist endgültig weg.
        """
        oldest = self._events[0]["at"] if self._events else None
        return {
            "started": self.started,
            "oldest": oldest,
            "count": len(self._events),
            "limit": LIMIT,
            "full": len(self._events) >= LIMIT,
        }
