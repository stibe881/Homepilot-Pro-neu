#!/usr/bin/env python3
"""Das Gerüst für eine neue Integration - die acht Stellen auf einen Griff.

Punkt 503 der Werkbank. `docs/neue-integration.md` beschreibt gut, was
eine Integration ist; was sie *jedes Mal* kostet, steht dort nicht:
Modul, Takt-Tabelle, Test, Konfigurationsschnipsel - und danach vier
Stellen in der App, die kein Skript erraten kann. Die ersten vier sind
immer dieselben Handgriffe, und genau dort schleichen sich die Fehler
ein, die niemand sieht: der Name, der nicht zum Dateinamen passt (dann
findet der Hub die Integration nie und meldet bloss «nicht gefunden»),
das fehlende `INTEGRATION`-Attribut, der Takt, der als sechzehnte Zahl
irgendwo im Modul landet statt in `SCAN_INTERVALS`.

    python3 tools/neue_integration.py waschturm --art schalter
    python3 tools/neue_integration.py wetterstation --art sensor --takt 900
    python3 tools/neue_integration.py probe --trocken   # zeigen, nichts schreiben

Was das Skript **nicht** tut, sagt es am Ende selbst: Kachel, Symbol,
Demo-Fall und Dokumentation bleiben Handarbeit, und die Liste am Schluss
nennt die Dateien dafür beim Namen. Ein Gerüst, das so täte, als wäre
danach alles fertig, wäre schlimmer als keines.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import NamedTuple

WURZEL = Path(__file__).resolve().parent.parent
MODULE = WURZEL / "homepilot" / "integrations"
TESTS = WURZEL / "tests"
TAKTE = WURZEL / "homepilot" / "core" / "integration.py"

#: Die Sorten, für die sich ein Gerüst lohnt - mit dem, was zu ihnen gehört.
#:
#: Bewusst nicht alle Entitätsarten: Kamera, Kalender, Alarmanlage und
#: Wetter haben je eigene Pflichten in der App und brauchen mehr als ein
#: Gerüst. Wer eine davon baut, nimmt die nächstliegende hier und
#: schreibt die Art um - das ist eine Zeile.
class Art(NamedTuple):
    """Eine Geräteart und alles, was zu ihrem Gerüst gehört."""

    #: Der Name in `EntityKind` (core/entity.py).
    kind: str
    #: Der Anfangszustand, als Python-Quelltext.
    zustand: str
    #: Was die Integration annimmt. Leer heisst: nur melden, nicht schalten.
    befehle: tuple[str, ...]
    #: Welcher Rumpf für `handle_command` passt - leer bei reinen Meldern.
    rumpf: str
    #: Womit der erzeugte Test schaltet und was danach dastehen muss.
    probe: tuple[str, str]


ARTEN: dict[str, Art] = {}  # gefüllt am Ende der Datei, bei den Vorlagen

#: Was danach von Hand kommt - mit der Datei, in der es steht.
#:
#: Diese Liste ist der eigentliche Wert des Skripts: Sie stand bisher
#: nirgends, und wer sie nicht im Kopf hatte, lieferte eine Integration
#: aus, deren Geräte in der App ohne Symbol und ohne eigene Kachel
#: dastanden - funktionierend und trotzdem halbfertig.
HANDARBEIT: tuple[tuple[str, str], ...] = (
    (
        "Kachel",
        "app/src/components/EntityCard.tsx - braucht die Art eine eigene "
        "Darstellung, oder reicht die vorhandene?",
    ),
    (
        "Symbol",
        "app/src/lib/symbole.ts - je Begriff genau ein Zeichen; ein Test "
        "hält das fest",
    ),
    (
        "Demo-Fall",
        "hub/homepilot/integrations/demo.py - ein Gerät derselben Art, "
        "damit die Browser-Probe es ohne Haus zeigt",
    ),
    (
        "Dokumentation",
        "hub/docs/neue-integration.md - die Vorlagen-Tabelle, wenn eine "
        "fertige Bibliothek dahintersteckt",
    ),
)


def gueltig(name: str) -> str:
    """Taugt der Name als Modulname? (rein, testbar)

    `Integration.name` muss dem Dateinamen entsprechen (siehe
    `core/integration.py`), geladen wird über `importlib.import_module`.
    Ein Bindestrich oder ein Grossbuchstabe fällt darum erst beim Start
    auf, und dann als «Integration nicht gefunden» - eine Meldung, die in
    die Irre führt.
    """
    if not re.fullmatch(r"[a-z][a-z0-9_]*", name):
        raise SystemExit(
            f"'{name}' taugt nicht als Modulname: nur Kleinbuchstaben, "
            "Ziffern und Unterstriche, beginnend mit einem Buchstaben."
        )
    return name


def klassenname(name: str) -> str:
    """`vzug_backofen` wird zu `VzugBackofenIntegration` (rein, testbar)."""
    return "".join(teil.capitalize() for teil in name.split("_")) + "Integration"


def modul_text(name: str, art: str) -> str:
    """Das Modul selbst (rein, testbar)."""
    sorte = ARTEN[art]
    klasse = klassenname(name)
    befehlsliste = ", ".join(f'"{befehl}"' for befehl in sorte.befehle)
    commands = f"\n            commands=[{befehlsliste}]," if sorte.befehle else ""
    # Ohne Kommandos gibt es kein `handle_command` - und damit weder
    # `Entity` noch `Any`. Ruff wirft ungenutzte Importe als Fehler, und
    # ein Gerüst, das schon beim Anlegen rot ist, gewöhnt einem das
    # Hinsehen ab.
    importe = "\nfrom ..core.entity import EntityKind\n"
    if sorte.befehle:
        importe = "from typing import Any\n\nfrom ..core.entity import Entity, EntityKind\n"
    return VORLAGE_MODUL.format(
        name=name,
        klasse=klasse,
        kind=sorte.kind,
        zustand=sorte.zustand,
        commands=commands,
        schalten=sorte.rumpf,
        importe=importe,
    )


def test_text(name: str, art: str) -> str:
    """Der erste Test - er läuft sofort und ohne Gerät (rein, testbar)."""
    sorte = ARTEN[art]
    schalttest = ""
    if sorte.befehle:
        befehl, erwartet = sorte.probe
        schalttest = VORLAGE_SCHALTTEST.format(
            name=name, befehl=befehl, erwartet=erwartet
        )
    return VORLAGE_TEST.format(name=name, schalttest=schalttest)


def takt_eintragen(text: str, name: str, takt: float) -> tuple[str, bool]:
    """Die Zeile in `SCAN_INTERVALS` an ihren alphabetischen Platz (rein, testbar).

    Zurück kommt der neue Text und ob sich etwas geändert hat.
    Alphabetisch, weil die Tabelle so steht: Eine angehängte Zeile findet
    beim nächsten Mal niemand, und dann steht die Zahl ein zweites Mal im
    Modul - genau der Zustand, den die Tabelle beendet hat.
    """
    anfang = text.find("SCAN_INTERVALS: dict[str, float] = {")
    if anfang < 0:
        return text, False
    ende = text.find("}", anfang)
    block = text[anfang:ende]
    if f'"{name}":' in block:
        return text, False
    zahl: object = int(takt) if float(takt).is_integer() else takt
    neu = f'    "{name}": {zahl},\n'
    stelle = ende
    for zeile in block.splitlines(keepends=True):
        if not zeile.startswith('    "'):
            continue
        if zeile.split('"')[1] > name:
            stelle = anfang + block.find(zeile)
            break
    return text[:stelle] + neu + text[stelle:], True


def main() -> int:
    zerleger = argparse.ArgumentParser(description="Gerüst für eine Integration")
    zerleger.add_argument("name", help="Modulname, z.B. waschturm")
    zerleger.add_argument(
        "--art",
        choices=sorted(ARTEN),
        default="schalter",
        help="Welche Sorte Gerät (Vorgabe: schalter)",
    )
    zerleger.add_argument(
        "--takt",
        type=float,
        default=60.0,
        help="Sekunden je Abruf, für SCAN_INTERVALS (Vorgabe: 60)",
    )
    zerleger.add_argument(
        "--trocken", action="store_true", help="nur zeigen, nichts schreiben"
    )
    wahl = zerleger.parse_args()
    name = gueltig(wahl.name)

    modul = MODULE / f"{name}.py"
    test = TESTS / f"test_{name}.py"
    takte = TAKTE.read_text(encoding="utf-8")
    neue_takte, geaendert = takt_eintragen(takte, name, wahl.takt)

    if wahl.trocken:
        print(f"--- {modul.relative_to(WURZEL)} ---")
        print(modul_text(name, wahl.art))
        print(f"--- {test.relative_to(WURZEL)} ---")
        print(test_text(name, wahl.art))
        stand = "+" if geaendert else "unverändert"
        print(f"--- SCAN_INTERVALS: {stand} ---")
        return 0

    # Lieber gar nichts als die halbe Arbeit von gestern überschreiben.
    vorhanden = [pfad for pfad in (modul, test) if pfad.exists()]
    if vorhanden:
        namen = ", ".join(pfad.name for pfad in vorhanden)
        raise SystemExit(f"Gibt es schon: {namen} - hier geht es von Hand weiter.")

    modul.write_text(modul_text(name, wahl.art), encoding="utf-8")
    test.write_text(test_text(name, wahl.art), encoding="utf-8")
    if geaendert:
        TAKTE.write_text(neue_takte, encoding="utf-8")

    print(f"Angelegt: {modul.relative_to(WURZEL)}")
    print(f"Angelegt: {test.relative_to(WURZEL)}")
    if geaendert:
        print(f"Eingetragen: SCAN_INTERVALS['{name}'] = {int(wahl.takt)}")
    print()
    print("In die config.yaml:")
    print(f"  - integration: {name}")
    print("    host: 192.168.1.50")
    print()
    print("Von Hand bleibt - kein Skript kann das erraten:")
    for stelle, warum in HANDARBEIT:
        print(f"  {stelle:<14} {warum}")
    print()
    print("Und dann grün bekommen:")
    print(f"  pytest -q tests/test_{name}.py && ruff check .")
    return 0


# ── Die Vorlagen ──────────────────────────────────────────────────────────
#
# Am Ende der Datei und nicht oben: Sie sind lang, und wer das Skript
# liest, will zuerst wissen, was es tut. Geschweifte Klammern im
# erzeugten Code müssen verdoppelt werden - `str.format` frisst sie sonst.

VORLAGE_MODUL = '''"""{name} - TODO: Was bindet diese Integration an?

Ein Satz darüber, was hier übersetzt wird, und einer darüber, warum es
so aussieht. Die Regeln stehen in `docs/neue-integration.md`; diese drei
werden am häufigsten übersehen:

  - Der Hauptwert gehört unter `state`, alles Weitere daneben.
  - «Nicht erreichbar» ist nicht «aus»: `available=False` erst nach
    mehreren vergeblichen Versuchen in Folge, nie beim ersten Zeitablauf.
  - Den Takt nicht selbst erfinden - `self.scan_interval()` liefert ihn.

Konfiguration in der config.yaml:

  - integration: {name}
    host: 192.168.1.50
"""

from __future__ import annotations

import logging
{importe}from ..core.integration import Integration

log = logging.getLogger(__name__)


class {klasse}(Integration):
    # Muss dem Dateinamen entsprechen - der Hub lädt sie über ihn.
    name = "{name}"

    async def setup(self) -> None:
        """Verbindung aufbauen und Entitäten anlegen.

        Wirft es hier, wird die Integration übersprungen und der Rest des
        Hubs startet normal. Also ruhig hart scheitern, wenn die
        Konfiguration unbrauchbar ist (`raise ConfigError(...)`).
        """
        self._host = str(self.config.get("host") or "")
        await self.add_entity(
            "geraet",
            EntityKind.{kind},
            "TODO: Anzeigename",
            state={zustand},{commands}
        )
        # Push schlägt Polling: Meldet sich die Gegenstelle von selbst
        # (SSE, WebSocket, MQTT), gehört hierhin ein Abo statt dieser
        # Schleife - und Polling nur als Rückfallebene in grossem Takt.
        self.start_polling(self._abrufen)

    async def _abrufen(self) -> None:
        """Einmal nachsehen, was das Gerät meldet.

        TODO: Hier die Gegenstelle fragen. Ein Fehlschlag darf fliegen -
        `start_polling` fängt ihn, protokolliert ihn und taktet weiter.
        Eine eigene Schleife mit eigenem Fehlerfang braucht es nicht; sie
        war der Grund, warum sechs Integrationen nach der ersten kaputten
        Antwort für immer stillstanden.
        """
{schalten}

INTEGRATION = {klasse}
'''

SCHALTEN_AN_AUS = '''
    async def handle_command(
        self, entity: Entity, command: str, data: dict[str, Any]
    ) -> None:
        """Ein Kommando aus App oder Ablauf ausführen.

        TODO: Hier das Gerät wirklich ansteuern. Diese Fassung läuft -
        und lügt dabei: Die Kachel zeigt «an», ohne dass etwas angegangen
        wäre. Solange das so ist, gehört ein Hinweis in den Commit.
        """
        changes: dict[str, Any] = {}
        if command == "turn_on":
            changes["state"] = "on"
        elif command == "turn_off":
            changes["state"] = "off"
        elif command == "toggle":
            changes["state"] = "off" if entity.state.get("state") == "on" else "on"
        if changes:
            # Zustand **nur** hierüber ändern. Das Entity-Objekt direkt
            # anzufassen ist ein stiller Fehler: Dann entsteht kein
            # `state_changed`, und weder App noch Abläufe noch die
            # Datenbank erfahren davon.
            await self.hub.registry.update_state(entity.id, changes)
'''

VORLAGE_TEST = '''"""Die Integration «{name}» - TODO: was sie beweisen soll.

Jeder Test beschreibt seinen Fall im Namen
(`test_motion_light_stays_on_while_there_is_movement`, nicht
`test_mode_2`). Die hier sind das Gerüst: Sie halten fest, dass die
Integration überhaupt lädt und ihre Entitäten anlegt. Alles Weitere
kommt dazu, sobald sie etwas tut - und richtig fertig ist sie erst,
wenn ein Kommando nachweislich beim Gerät ankommt (siehe die
Gegenstellen in `docs/neue-integration.md`).
"""

import asyncio

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub


def _hub() -> Hub:
    return Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{{"integration": "{name}", "host": "127.0.0.1"}}],
        )
    )


def test_{name}_legt_seine_entitaeten_an():
    """Ohne diesen Test fällt ein Tippfehler im Namen erst im Haus auf:
    Der Hub überspringt eine Integration, die er nicht laden kann, und
    startet ansonsten völlig normal."""

    async def check():
        hub = _hub()
        await hub.start()
        try:
            geraet = hub.registry.get("{name}.geraet")
            assert geraet is not None
            assert geraet.integration == "{name}"
        finally:
            await hub.stop()

    asyncio.run(check())
{schalttest}'''

VORLAGE_SCHALTTEST = '''

def test_{name}_setzt_den_zustand_nach_dem_befehl():
    """Noch prüft das nur die Übersetzung im Hub. TODO: Sobald das Gerät
    wirklich angesteuert wird, gehört hier eine Gegenstelle hin."""

    async def check():
        hub = _hub()
        await hub.start()
        try:
            await hub.integrations.dispatch_command("{name}.geraet", "{befehl}", {{}})
            geraet = hub.registry.get("{name}.geraet")
            assert geraet is not None and geraet.state["state"] == "{erwartet}"
        finally:
            await hub.stop()

    asyncio.run(check())
'''

SCHALTEN_STORE = '''
    async def handle_command(
        self, entity: Entity, command: str, data: dict[str, Any]
    ) -> None:
        """Ein Kommando aus App oder Ablauf ausführen.

        TODO: Hier die Store wirklich fahren. Diese Fassung meldet die
        Stellung sofort - ein echtes Gateway braucht dafür Sekunden, und
        genau diese Lücke ist der Fall, den der Gremlin nachstellt
        (`integrations/gremlin.py`, `cover_gestrig`).
        """
        changes: dict[str, Any] = {}
        if command == "open":
            changes = {"state": "open", "position": 100}
        elif command == "close":
            changes = {"state": "closed", "position": 0}
        elif command == "set_position":
            ziel = max(0, min(100, int(data.get("position", 0))))
            changes = {"state": "open" if ziel > 0 else "closed", "position": ziel}
        if changes:
            # Zustand **nur** hierüber ändern - siehe den Kommentar in
            # der An/Aus-Fassung.
            await self.hub.registry.update_state(entity.id, changes)
'''

# Erst hier, weil die Rümpfe darüberstehen müssen: Die Tabelle der Arten
# bindet alles zusammen, was eine Sorte ausmacht.
ARTEN.update(
    {
        "licht": Art(
            kind="LIGHT",
            zustand='{"state": "off", "brightness": 100}',
            befehle=("turn_on", "turn_off", "toggle"),
            rumpf=SCHALTEN_AN_AUS,
            probe=("turn_on", "on"),
        ),
        "melder": Art(
            kind="BINARY_SENSOR",
            zustand='{"state": "off"}',
            befehle=(),
            rumpf="",
            probe=("", ""),
        ),
        "schalter": Art(
            kind="SWITCH",
            zustand='{"state": "off"}',
            befehle=("turn_on", "turn_off", "toggle"),
            rumpf=SCHALTEN_AN_AUS,
            probe=("turn_on", "on"),
        ),
        "sensor": Art(
            kind="SENSOR",
            zustand='{"state": 0.0, "unit": "°C"}',
            befehle=(),
            rumpf="",
            probe=("", ""),
        ),
        "store": Art(
            kind="COVER",
            zustand='{"state": "open", "position": 100}',
            befehle=("open", "close", "stop", "set_position"),
            rumpf=SCHALTEN_STORE,
            probe=("close", "closed"),
        ),
    }
)


if __name__ == "__main__":
    sys.exit(main())
