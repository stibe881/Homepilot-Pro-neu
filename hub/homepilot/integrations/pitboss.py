"""Pit-Boss-Pelletgrill (und Louisiana Grills) über ``pytboss``.

Konfiguration – ein Eintrag, darin je Grill ein Weg:

  - integration: pitboss
    scan_interval: 30
    grills:
      - name: Räucherschrank
        model: PBV4PS2        # steht auf dem Typenschild, siehe unten
        host: 10.10.1.60      # lokal, ohne Umweg über die Hersteller-Cloud
      - name: Smoker
        model: PB1150PS2
        grill_id: "abc123..."  # aus der Pit-Boss-App, geht über die Cloud
        allow_remote_start: false

Für einen einzigen Grill genügt die kurze Form ohne ``grills:`` – dann
stehen ``name``, ``model`` und der Weg direkt im Eintrag.

**Warum alle Grills in einen Eintrag gehören:** Der Hub führt Integrationen
unter ihrem Namen. Zwei ``- integration: pitboss``-Einträge sähen richtig
aus, der zweite verdrängte aber den ersten – und dann landete der Befehl
für den Räucherschrank beim Smoker.

**Warum lokal, wenn es geht:** Der Grill spricht dieselbe RPC-Schnittstelle
auch direkt im Netz. Dann bleibt der Hersteller aussen vor, und der Grill
funktioniert weiter, wenn deren Dienst mal steht. Nicht jedes Gerät
antwortet aber lokal – ältere Steuerplatinen haben gar keinen HTTP-Server,
und bei den übrigen muss er eingeschaltet sein. Klappt es nicht, ist
``grill_id`` der Weg; die Kennung steht in der App.

**Warum Bluetooth hier nicht vorkommt:** Der Hub läuft im Rechenzentrum
des Hauses, nicht auf der Terrasse. Für Bluetooth müsste er in Reichweite
stehen.

**Warum Anzünden standardmässig fehlt:** ``turn_on`` entfacht ein Feuer in
einem Gerät, neben dem gerade niemand stehen muss. Die Platine nimmt den
Befehl in jedem Zustand an – auch mit offenem Deckel, auch ohne Pellets,
auch wenn das Gerät unter dem Vordach steht. Diese Entscheidung gehört
nicht in eine Automation, die jemand vor drei Monaten gebaut hat. Deshalb
gibt es das Kommando nur mit ``allow_remote_start: true`` in der
Konfiguration, und auch dann nur für Bewohner.

Ausschalten geht immer – das ist die sichere Richtung.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError, HomePilotError
from ..core.integration import Integration

# Wie oft nachgefragt wird, steht in core/integration.py bei allen anderen
# (SCAN_INTERVALS). Der Grund für die 30 Sekunden gehört aber hierher:
# Beim lokalen Weg meldet der Grill nichts von sich aus, es gibt nur
# Abfragen – 30 Sekunden sind beim Grillen genau genug und belasten die
# kleine Platine nicht.


def slug(name: str) -> str:
    """Aus «Grill Terrasse» wird «grill_terrasse» (rein, testbar)."""
    kept = [c.lower() if c.isalnum() else "_" for c in name.strip()]
    return "".join(kept).strip("_").replace("__", "_") or "grill"


def probe_temperatures(state: dict[str, Any]) -> dict[int, int]:
    """Die belegten Fleischfühler aus dem Zustand (rein, testbar).

    Ein nicht eingesteckter Fühler meldet ``None``. Ihn trotzdem als
    Entität zu führen, hiesse: eine Kachel, die dauerhaft «–» zeigt.
    """
    found: dict[int, int] = {}
    for number in (1, 2, 3, 4):
        value = state.get(f"p{number}Temp")
        if isinstance(value, int) and not isinstance(value, bool):
            found[number] = value
    return found


#: So lange gilt ein Grill, der mitten im Lauf verstummt, als Störung -
#: danach als ausgeschaltet.
AUSFALL_KARENZ_S = 10 * 60.0


def ausfall_zustand(
    lief: bool, unerreichbar_seit: float, jetzt: float, grund: str
) -> tuple[dict[str, Any], bool]:
    """Was die Kachel zeigt, wenn der Grill nicht antwortet (rein, testbar).

    Aus dem Haus (Punkt 571): «Wenn ein Smoker ausgeschaltet ist, soll
    es anzeigen, dass er ausgeschaltet ist, und nicht ‹nicht
    erreichbar›.» Ein Pit Boss ohne Strom antwortet nicht - und zwischen
    zwei Grillabenden ist das der Normalfall, kein Ausfall. Dann heisst
    er «Aus», ist erreichbar (er steht ja da) und ohne Störung; auch aus
    der Liste der Ausfälle fällt er damit heraus.

    Die Ausnahme ist der Grill, der **mitten im Lauf** verstummt: Der
    Strom fiel, das WLAN riss ab, oder jemand zog den Stecker mit Fleisch
    darauf - das ist die Störung, die man wissen will, samt Grund an der
    Kachel. Sie gilt für eine Karenz; wer den Grill nach dem Essen vom
    Strom nimmt, hat nach zehn Minuten wieder einen ausgeschalteten
    Grill und keinen Ausfall.

    Zurück kommt der Zustands-Nachtrag und ob die Kachel erreichbar ist.
    """
    if lief and jetzt - unerreichbar_seit < AUSFALL_KARENZ_S:
        return {"problem": grund}, False
    return (
        {
            "state": "off",
            "problem": None,
            # Kalt heisst kalt: Die Temperaturen von vorhin wären eine
            # Behauptung über ein Gerät, das nichts mehr sagt.
            "temperature": None,
            "probes": {},
            **{f"probe_{nummer}": None for nummer in (1, 2, 3, 4)},
        },
        True,
    )


def zusammenlegen(alt: dict[str, Any], neu: dict[str, Any]) -> dict[str, Any]:
    """Eine Teilmeldung auf den letzten vollen Zustand legen (rein, testbar).

    Aus dem Haus (Punkt 567): «Wenn ich die Zieltemperatur umstelle»,
    stand im Blatt 0 °C, «Hält 0°», und alle vier Fühler waren leer.
    Nach einem Befehl liest der Hub den Zustand sofort nach, und die
    Cloud schickt zwischendurch Meldungen - beides kann ein Bruchstück
    sein: nur der neue Sollwert, die Temperaturen als None. `grill_state`
    machte daraus einen vollständigen Zustand mit lauter Lücken, und die
    Lücken überschrieben im Hub die guten Werte von vorhin.

    Deshalb: Was die Meldung nicht kennt oder als None schickt, bleibt,
    wie es war. Nur die regelmässige Abfrage ersetzt den Zustand ganz -
    sie ist vollständig, und nur bei ihr darf ein ausgesteckter Fühler
    (None) auch verschwinden.
    """
    return {**alt, **{key: value for key, value in neu.items() if value is not None}}


def faults(state: dict[str, Any]) -> list[str]:
    """Was gerade nicht stimmt, in lesbaren Worten (rein, testbar).

    Bewusst als Liste und nicht als einzelnes Kennzeichen: Beim Grillen
    hängt zu viel dran, als dass «Störung» genügen würde – ob die Pellets
    aus sind oder das Gebläse steht, führt zu ganz verschiedenen Schritten.
    """
    problems = []
    if state.get("noPellets"):
        problems.append("Pellets leer")
    if state.get("highTempErr"):
        problems.append("Übertemperatur")
    if state.get("fanErr"):
        problems.append("Gebläse")
    if state.get("hotErr"):
        problems.append("Zündung")
    if state.get("motorErr"):
        problems.append("Förderschnecke")
    if state.get("erL"):
        problems.append("Anzünden fehlgeschlagen")
    for number in (1, 2, 3):
        if state.get(f"err{number}"):
            problems.append(f"Fühler {number}")
    return problems


def grill_state(state: dict[str, Any], model: str | None = None) -> dict[str, Any]:
    """Rohzustand des Grills in die Form des Hubs bringen (rein, testbar).

    ``model`` ist die Typenbezeichnung aus der config.yaml (PB1150PS2,
    PBV4PS2). Sie reist seit Punkt 559 mit, weil die App daran die
    Bauart erkennt und das passende Bild zeichnet - der liegende Grill
    oder der stehende Räucherschrank (app: lib/grillbild.ts).
    """
    running = bool(state.get("moduleIsOn"))
    problems = faults(state)
    return {
        **({"model": model} if model else {}),
        "state": "running" if running else "off",
        "temperature": state.get("grillTemp"),
        "target": state.get("grillSetTemp"),
        "unit": "°F" if state.get("isFahrenheit") else "°C",
        # Was die Platine gerade tut – daran sieht man beim Anheizen, dass
        # sich etwas rührt, lange bevor die Temperatur steigt.
        "igniter": bool(state.get("hotState")),
        "fan": bool(state.get("fanState")),
        "auger": bool(state.get("motorState")),
        "light": bool(state.get("lightState")),
        "probes": probe_temperatures(state),
        # Dieselben Werte zusätzlich flach (probe_1 …): Nur so taugen sie
        # als messbares Attribut in Abläufen - «Sonde 1 über 63 °C» kann
        # nicht in ein verschachteltes Wörterbuch hineinschauen.
        **{
            f"probe_{number}": temp
            for number, temp in probe_temperatures(state).items()
        },
        "faults": problems,
        "problem": problems[0] if problems else None,
    }


def fehlergrund(err: BaseException, weg: str) -> str:
    """Warum der Grill nicht antwortet - als Satz (rein, testbar).

    Die Ausnahme allein taugt nicht: `TimeoutError()` hat gar keinen
    Text, und `ClientConnectorError` trägt eine halbe Zeile Python. Auf
    der Kachel steht der Satz unter «nicht erreichbar», und dort soll er
    sagen, wo man nachsehen muss - nicht, welche Klasse geflogen ist.
    """
    art = type(err).__name__
    text = str(err).strip()
    if isinstance(err, TimeoutError) or "timeout" in f"{art} {text}".lower():
        return f"Keine Antwort {weg} (Zeitüberschreitung) - steht der Grill unter Strom?"
    if isinstance(err, (ConnectionError, OSError)) or "connect" in art.lower():
        return f"Keine Verbindung {weg}: {text or art}"
    return f"Fehler {weg}: {text or art}"


def grill_entries(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Aus dem Eintrag die Liste der Grills machen (rein, testbar).

    Ein Haushalt kann zwei haben - Räucherschrank und Smoker stehen
    nebeneinander auf der Terrasse. Zwei getrennte ``- integration:
    pitboss``-Einträge sähen richtig aus, wären es aber nicht: Der Hub
    führt Integrationen unter ihrem Namen, der zweite Eintrag verdrängt
    den ersten, und dann landeten die Befehle für den einen Grill beim
    anderen. Deshalb kennt *ein* Eintrag beliebig viele Geräte.

    Die kurze Form (model/host direkt im Eintrag) bleibt gültig - für
    einen Grill soll niemand eine Liste tippen müssen.
    """
    roh = config.get("grills")
    if roh is None:
        eintraege = [config]
    elif isinstance(roh, list) and roh:
        eintraege = [eintrag for eintrag in roh if isinstance(eintrag, dict)]
        if len(eintraege) != len(roh):
            raise ConfigError("pitboss: jeder Eintrag unter 'grills' ist ein Gerät")
    else:
        raise ConfigError("pitboss: 'grills' ist eine Liste mit mindestens einem Gerät")

    fertig: list[dict[str, Any]] = []
    kennungen: set[str] = set()
    for eintrag in eintraege:
        name = str(eintrag.get("name") or "Grill").strip() or "Grill"
        model = str(eintrag.get("model") or "").strip()
        if not model:
            raise ConfigError(
                f"pitboss: '{name}' braucht 'model' (z.B. PBV4PS2) – die "
                "Steuerplatine lässt sich nicht selbst erkennen, und ohne "
                "sie weiss der Hub nicht, welche Befehle das Gerät versteht."
            )
        host = str(eintrag.get("host") or "").strip()
        grill_id = str(eintrag.get("grill_id") or "").strip()
        if bool(host) == bool(grill_id):
            raise ConfigError(
                f"pitboss: '{name}' braucht entweder 'host' (lokal) oder "
                "'grill_id' (Cloud) – genau eines von beiden."
            )
        kennung = slug(name)
        if kennung in kennungen:
            # Zwei Kacheln mit derselben Kennung wären eine Kachel.
            raise ConfigError(
                f"pitboss: der Name '{name}' kommt zweimal vor – jeder Grill "
                "braucht einen eigenen."
            )
        kennungen.add(kennung)
        fertig.append(
            {
                "id": kennung,
                "name": name,
                "model": model,
                "host": host,
                "grill_id": grill_id,
                "password": str(eintrag.get("password") or ""),
                # Der Schalter darf je Gerät stehen; fehlt er dort, gilt,
                # was der Eintrag insgesamt sagt.
                "allow_remote_start": bool(
                    eintrag.get(
                        "allow_remote_start", config.get("allow_remote_start", False)
                    )
                ),
            }
        )
    return fertig


def hat_licht(spec: Any) -> bool:
    """Hat dieser Grill eine Beleuchtung? (rein, testbar)

    `spec` kommt von pytboss und ist erst nach `start()` da. Fehlt sie,
    lautet die Antwort «nein»: Ein Lichtschalter, der ins Leere greift,
    ist schlimmer als keiner - er steht in der App und in jeder Auswahl
    für Abläufe, und beides liesse sich nicht mehr zurücknehmen, ohne
    dass jemandem ein Ablauf kaputtgeht.
    """
    return bool(getattr(spec, "has_lights", False))


class _Grill:
    """Ein Gerät samt Verbindung und Kachel.

    Ohne diese Klammer landete bei zwei Grills der Befehl für den einen
    beim anderen: Der Hub kennt beim Schalten nur die Entität.
    """

    def __init__(self, eintrag: dict[str, Any], boss: Any, entity: Entity) -> None:
        self.name: str = eintrag["name"]
        self.model: str = eintrag["model"]
        # Der letzte vollständige Rohzustand - Bruchstücke werden darauf
        # gelegt (zusammenlegen, Punkt 567).
        self.roh: dict[str, Any] = {}
        self.may_start: bool = eintrag["allow_remote_start"]
        # Über die Cloud meldet sich der Grill von selbst, lokal nicht.
        self.pushes: bool = not eintrag["host"]
        # Womit es versucht wird - gehört in die Meldung, wenn es nicht
        # geht (Punkt 552). «Grill antwortet nicht» beantwortet die
        # Frage «warum?» nicht; «über 10.10.1.60» beantwortet sie halb.
        self.weg: str = (
            f"lokal über {eintrag['host']}" if eintrag["host"] else "über die Pit-Boss-Wolke"
        )
        self.boss = boss
        self.entity = entity
        # Ob er beim letzten Versuch erreichbar war - damit nur der
        # *Wechsel* im Log steht und nicht alle dreissig Sekunden
        # dieselbe Zeile.
        self.erreichbar: bool | None = None
        # Seit wann er nicht antwortet, und ob er davor lief - daran
        # entscheidet sich «Aus» oder «Störung» (ausfall_zustand).
        self.unerreichbar_seit: float = 0.0
        self.lief: bool = False


class PitBossIntegration(Integration):
    name = "pitboss"

    async def setup(self) -> None:
        try:
            from pytboss import HttpConnection, PitBoss, WebSocketConnection
        except ImportError as err:  # pragma: no cover - hängt am Abbild
            raise ConfigError(
                "pitboss braucht das Paket 'pytboss' (pip install pytboss)"
            ) from err

        self._interval = self.scan_interval()
        self._grills: dict[str, _Grill] = {}

        for eintrag in grill_entries(self.config):
            connection = (
                HttpConnection(eintrag["host"])
                if eintrag["host"]
                else WebSocketConnection(eintrag["grill_id"])
            )
            try:
                boss = PitBoss(
                    connection, eintrag["model"], password=eintrag["password"]
                )
            except Exception as err:
                raise ConfigError(
                    f"pitboss: Grill '{eintrag['name']}' liess sich nicht "
                    f"anlegen ({err})"
                ) from err

            # start() zuerst, und zwar wegen der Reihenfolge darin: Es löst
            # erst die Bauart des Grills auf (daher `spec`) und baut dann
            # die Verbindung auf. Der Konstruktor kennt beides noch nicht -
            # wer vorher `boss.spec` liest, bekommt einen AttributeError,
            # und die Integration stand in der Diagnose mit «'PitBoss'
            # object has no attribute 'spec'» statt mit einem Grill da.
            try:
                await boss.start()
            except Exception as err:
                if not hasattr(boss, "spec"):
                    # Vor der Verbindung gescheitert, also am Modell: Das
                    # ist ein Fehler in der config.yaml und wird auch als
                    # solcher gemeldet.
                    raise ConfigError(
                        f"pitboss: Modell '{eintrag['model']}' unbekannt "
                        f"({err}). Bekannte Modelle listet "
                        "'python -m homepilot.integrations.pitboss --modelle'."
                    ) from err
                # Ein kalter Grill ist stromlos und damit nicht erreichbar –
                # das ist der Normalfall zwischen zwei Grillabenden und darf
                # den Hub-Start nicht stören. Die Bauart steht trotzdem fest.
                self.log.warning(
                    "Grill '%s' antwortet nicht: %s", eintrag["name"], err
                )

            commands = ["turn_off", "set_temperature"]
            # Ohne diesen Schalter fehlt das Kommando ganz, statt nur
            # versteckt zu sein: Was es nicht gibt, kann auch kein Ablauf
            # auslösen.
            if eintrag["allow_remote_start"]:
                commands.append("turn_on")
            if hat_licht(getattr(boss, "spec", None)):
                commands += ["light_on", "light_off"]

            entity = await self.add_entity(
                eintrag["id"],
                EntityKind.APPLIANCE,
                eintrag["name"],
                # Das Modell von Anfang an: Auch ein kalter, nicht
                # erreichbarer Grill soll sein Bild bekommen.
                state={"state": "unknown", "model": eintrag["model"]},
                commands=commands,
                available=False,
            )
            grill = _Grill(eintrag, boss, entity)
            self._grills[entity.id] = grill

            if grill.pushes:
                await boss.subscribe_state(self._push_handler(grill))
            self.start_task(self._poll_loop(grill))

    def _push_handler(self, grill: _Grill) -> Any:
        """Meldung aus der Cloud – dieselbe Verarbeitung wie beim Abfragen."""

        async def _on_push(payload: Any) -> None:
            if isinstance(payload, dict):
                await self._teilmeldung(grill, payload)

        return _on_push

    async def _poll_loop(self, grill: _Grill) -> None:
        while True:
            try:
                state = await grill.boss.get_state()
            except Exception as err:
                # Zwischen zwei Grillabenden ist das Gerät wochenlang aus.
                # Das ist kein Fehler, nur «nicht da» - deshalb keine
                # Warnung bei jeder Runde.
                #
                # Der *Wechsel* gehört aber ins Log, und der Grund an die
                # Kachel (Punkt 552). Vorher stand beides nirgends: Das
                # Log schwieg auf «debug», und der Ausfall wurde mit
                # einem leeren Wörterbuch gemeldet - unter «Ausfälle»
                # stand damit «noch ausgefallen» und sonst nichts. Wer
                # danebensteht und sieht, dass der Smoker läuft, kann
                # daraus nicht schliessen, woran es liegt.
                grund = fehlergrund(err, grill.weg)
                jetzt = time.time()
                if grill.erreichbar is not False:
                    grill.unerreichbar_seit = jetzt
                    # Ein laufender Grill, der verstummt, ist eine Warnung
                    # wert; ein kalter zwischen zwei Abenden nicht.
                    if grill.lief:
                        self.log.warning("Grill '%s': %s", grill.name, grund)
                    else:
                        self.log.info("Grill '%s' ist aus (%s)", grill.name, grund)
                    grill.erreichbar = False
                else:
                    self.log.debug("Grill '%s': %s", grill.name, grund)
                nachtrag, erreichbar = ausfall_zustand(
                    grill.lief, grill.unerreichbar_seit, jetzt, grund
                )
                await self.hub.registry.update_state(
                    grill.entity.id, nachtrag, available=erreichbar
                )
            else:
                if isinstance(state, dict):
                    if grill.erreichbar is False:
                        self.log.info("Grill '%s' antwortet wieder", grill.name)
                    grill.erreichbar = True
                    grill.lief = bool(state.get("moduleIsOn"))
                    # Die Abfrage ist vollständig - sie ersetzt den Stand.
                    grill.roh = dict(state)
                    await self._publish(grill, state)
            await asyncio.sleep(self._interval)

    async def _teilmeldung(self, grill: _Grill, raw: dict[str, Any]) -> None:
        """Eine Meldung, die ein Bruchstück sein kann - auf den letzten
        vollen Stand gelegt, statt ihn mit Lücken zu überschreiben."""
        grill.roh = zusammenlegen(grill.roh, raw)
        await self._publish(grill, grill.roh)

    async def _publish(self, grill: _Grill, raw: dict[str, Any]) -> None:
        shaped = grill_state(raw, grill.model)
        await self.hub.registry.update_state(grill.entity.id, shaped, available=True)

    async def handle_command(
        self, entity: Entity, command: str, data: dict[str, Any]
    ) -> None:
        grill = self._grills.get(entity.id)
        if grill is None:
            raise ConfigError(f"Zu '{entity.id}' gehört kein Grill mehr")
        try:
            if command == "turn_off":
                await grill.boss.turn_grill_off()
            elif command == "turn_on":
                if not grill.may_start:
                    raise ConfigError(
                        "Fernstart ist nicht freigegeben. In der config.yaml "
                        "beim pitboss-Eintrag 'allow_remote_start: true' setzen."
                    )
                # Das gehört ins Protokoll, auch wenn nichts schiefgeht.
                self.log.warning("Grill '%s' wird aus der Ferne angezündet", grill.name)
                await grill.boss.turn_grill_on()
            elif command == "set_temperature":
                await grill.boss.set_grill_temperature(
                    int(data.get("temperature", 0))
                )
            elif command == "light_on":
                await grill.boss.turn_light_on()
            elif command == "light_off":
                await grill.boss.turn_light_off()
            else:
                raise ConfigError(f"Kommando '{command}' gibt es hier nicht")
        except (ConfigError, HomePilotError):
            raise
        except Exception as err:
            raise HomePilotError(f"Grill antwortet nicht: {err}") from err
        # Nicht auf die nächste Abfrage warten – wer schaltet, will sehen,
        # dass es angekommen ist. Als Teilmeldung: Direkt nach einem
        # Befehl kommt vom Gerät gern ein Bruchstück (Punkt 567).
        try:
            await self._teilmeldung(grill, await grill.boss.get_state())
        except Exception:
            pass

    async def teardown(self) -> None:
        for grill in self._grills.values():
            try:
                await grill.boss.stop()
            except Exception:
                pass


INTEGRATION = PitBossIntegration


# ── Einrichtungs-Helfer ────────────────────────────────────────────────────
# Aufruf im Container:
#   docker exec -it homepilot-hub python -m homepilot.integrations.pitboss --modelle
#   docker exec -it homepilot-hub python -m homepilot.integrations.pitboss \
#       --host 10.10.1.60 --model PBV4PS2
#
# Der Grund für diesen Helfer: Zwei Angaben stehen zwischen «Integration
# gebaut» und «Grill in der App» - das Modell und der Weg (lokal oder
# Cloud). Beide lassen sich nicht erraten, beide stehen in der App oder
# auf dem Typenschild, und ob der Grill lokal überhaupt antwortet, merkt
# man sonst erst beim nächsten Hub-Start an einer Zeile im Protokoll.


def grill_zeilen(
    name: str,
    model: str,
    host: str = "",
    grill_id: str = "",
    allow_remote_start: bool = False,
    einzug: str = "      ",
) -> list[str]:
    """Ein Gerät als YAML-Zeilen (rein, testbar).

    Getrennt vom ganzen Abschnitt, weil der zweite Grill genau diese
    Zeilen braucht - und sonst nichts.
    """
    zeilen = [
        f"{einzug}- name: {name}",
        f"{einzug}  model: {model}",
    ]
    if host:
        zeilen.append(f"{einzug}  host: {host}")
    else:
        # Die Kennung aus der App ist eine lange Ziffernfolge. Ohne
        # Anführungszeichen liest YAML sie als Zahl - und dann fehlen
        # führende Nullen.
        zeilen.append(f'{einzug}  grill_id: "{grill_id}"')
    if allow_remote_start:
        zeilen.append(f"{einzug}  allow_remote_start: true")
    return zeilen


def yaml_block(
    name: str,
    model: str,
    host: str = "",
    grill_id: str = "",
    allow_remote_start: bool = False,
) -> str:
    """Der fertige Abschnitt für die config.yaml (rein, testbar).

    Zum Kopieren statt zum Abtippen: Wer die Werte gerade auf dem
    Bildschirm hat, soll sie nicht aus zwei Zeilen Prosa zusammensuchen.

    Absichtlich immer in der Listenform, auch für einen einzigen Grill:
    Wer später einen zweiten anschliesst, hängt ihn darunter an. Ein
    zweiter ``- integration: pitboss``-Eintrag sähe richtig aus, würde den
    ersten aber verdrängen.
    """
    zeilen = ["  - integration: pitboss"]
    if host:
        zeilen.append("    scan_interval: 30")
    zeilen.append("    grills:")
    zeilen += grill_zeilen(name, model, host, grill_id, allow_remote_start)
    return "\n".join(zeilen)


def zustandszeilen(shaped: dict[str, Any]) -> list[str]:
    """Was der Grill gerade meldet, in lesbaren Zeilen (rein, testbar).

    Dieselben Werte, die später in der App stehen - wer den Helfer laufen
    lässt, sieht damit sofort, ob die Verbindung wirklich taugt oder bloss
    ein leeres Gerüst zurückkommt.
    """
    einheit = shaped.get("unit") or "°C"
    zeilen = [
        f"Zustand:     {'läuft' if shaped.get('state') == 'running' else 'aus'}",
        f"Garraum:     {shaped.get('temperature')} {einheit}"
        f"  (Ziel {shaped.get('target')} {einheit})",
    ]
    sonden = shaped.get("probes") or {}
    if sonden:
        werte = ", ".join(f"{nr}: {temp} {einheit}" for nr, temp in sorted(sonden.items()))
        zeilen.append(f"Fühler:      {werte}")
    else:
        zeilen.append("Fühler:      keiner eingesteckt")
    fehler = shaped.get("faults") or []
    zeilen.append(f"Störungen:   {', '.join(fehler) if fehler else 'keine'}")
    return zeilen


# --- Den Grill im Netz finden ------------------------------------------
#
# Die Adresse steht auf keinem Typenschild, und im Router heisst das Gerät
# je nach Platine «ESP_1A2B3C» oder gar nichts. Die Steuerplatine läuft
# unter Mongoose OS und beantwortet auf Port 80 unter /rpc die Methode
# Sys.GetInfo - damit lässt sich ein Netz absuchen, ohne vorher das Modell
# zu kennen. Bewusst ohne aiohttp: eine Handvoll Zeilen HTTP von Hand
# bleibt prüfbar, und die Antwort auszuwerten ist der Teil, der schiefgeht.

RPC_PFAD = "/rpc"
RPC_PORT = 80
RPC_ABFRAGE = b'{"id":1,"method":"Sys.GetInfo"}'
SUCHE_TIMEOUT = 1.5
SUCHE_GLEICHZEITIG = 64
SUCHE_MAX = 1024


def netzadressen(text: str) -> list[str]:
    """Welche Adressen abzusuchen sind (rein, testbar).

    Erlaubt ist, was man beim Tippen erwartet: «10.10.1.0/24», die
    Kurzform «10.10.1» und eine einzelne Adresse. Netz- und
    Rundrufadresse fallen weg, damit die Suche nicht zweimal ins Leere
    läuft.
    """
    import ipaddress

    roh = text.strip()
    if not roh:
        raise ValueError("Kein Netz angegeben.")
    if "/" not in roh and roh.count(".") == 2:
        # «10.10.1» meint das ganze Netz dahinter.
        roh = f"{roh}.0/24"
    if "/" not in roh:
        return [str(ipaddress.ip_address(roh))]
    netz = ipaddress.ip_network(roh, strict=False)
    if netz.num_addresses > SUCHE_MAX:
        raise ValueError(
            f"{netz} hat {netz.num_addresses} Adressen - das dauert zu lange. "
            f"Höchstens {SUCHE_MAX} (also /22 und kleiner)."
        )
    return [str(adresse) for adresse in netz.hosts()]


def rpc_antwort(roh: bytes) -> dict[str, Any] | None:
    """Aus einer HTTP-Antwort den JSON-Rumpf holen (rein, testbar).

    Alles andere als eine JSON-Antwort auf Sys.GetInfo ist kein Grill -
    Drucker, Kameras und Steckdosen antworten auf Port 80 auch, nur eben
    mit HTML oder einem Fehler.
    """
    trenner = roh.find(b"\r\n\r\n")
    rumpf = roh[trenner + 4 :] if trenner >= 0 else roh
    try:
        daten = json.loads(rumpf.decode("utf-8", "replace"))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(daten, dict):
        return None
    ergebnis = daten.get("result", daten)
    return ergebnis if isinstance(ergebnis, dict) else None


def fundzeile(adresse: str, info: dict[str, Any]) -> str:
    """Ein Fund in einer Zeile (rein, testbar).

    Auch Shelly-Geräte laufen unter Mongoose OS und antworten auf
    dieselbe Frage. Der Firmware-Name unterscheidet sie - deshalb steht
    er dabei und wird nicht weggefiltert.
    """
    teile = [adresse.ljust(15)]
    for feld, beschriftung in (("app", ""), ("fw_version", "fw "), ("mac", "")):
        wert = info.get(feld)
        if wert:
            teile.append(f"{beschriftung}{wert}")
    return "  ".join(teile)


async def _frage_rpc(adresse: str, port: int = RPC_PORT) -> dict[str, Any] | None:
    """Eine Adresse fragen. Antwortet dort kein RPC-Gerät: None."""
    writer = None
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(adresse, port), SUCHE_TIMEOUT
        )
        anfrage = (
            f"POST {RPC_PFAD} HTTP/1.1\r\n"
            f"Host: {adresse}\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(RPC_ABFRAGE)}\r\n"
            "Connection: close\r\n\r\n"
        ).encode()
        writer.write(anfrage + RPC_ABFRAGE)
        await writer.drain()
        roh = await asyncio.wait_for(reader.read(8192), SUCHE_TIMEOUT)
    except (TimeoutError, OSError):
        return None
    finally:
        if writer is not None:
            writer.close()
    return rpc_antwort(roh)


async def _suche(text: str) -> int:
    adressen = netzadressen(text)
    print(f"→ {len(adressen)} Adressen absuchen …")
    tor = asyncio.Semaphore(SUCHE_GLEICHZEITIG)

    async def einzeln(adresse: str) -> tuple[str, dict[str, Any] | None]:
        async with tor:
            return adresse, await _frage_rpc(adresse)

    funde = [
        (adresse, info)
        for adresse, info in await asyncio.gather(*(einzeln(a) for a in adressen))
        if info is not None
    ]
    if not funde:
        print(
            "Nichts gefunden. Entweder ist der lokale Dienst am Grill aus "
            "(ältere Platinen haben gar keinen), oder er hängt in einem "
            "anderen Netz\nals der Hub. Dann bleibt --grill-id aus der "
            "Pit-Boss-App."
        )
        return 1
    print(f"✓ {len(funde)} Gerät(e) mit RPC-Schnittstelle:")
    for adresse, info in funde:
        print(f"  {fundzeile(adresse, info)}")
    print(
        "\nDavon ist der Grill das Gerät, dessen Firmware nicht nach etwas "
        "anderem klingt (Shelly & Co. antworten hier ebenfalls).\n"
        "Nächster Schritt: --model … --host <Adresse> - das prüft es "
        "endgültig."
    )
    return 0


async def _probiere(
    model: str, host: str, grill_id: str, password: str
) -> tuple[bool, dict[str, Any]]:
    """Einmal verbinden und den Zustand holen. (True, Zustand) oder (False, {})."""
    from pytboss import HttpConnection, PitBoss, WebSocketConnection

    connection = HttpConnection(host) if host else WebSocketConnection(grill_id)
    boss = PitBoss(connection, model, password=password)
    try:
        await boss.start()
        roh = await boss.get_state()
    except Exception as err:
        print(f"✗ Keine Antwort: {err}")
        if host:
            print(
                "  Ältere Steuerplatinen haben gar keinen HTTP-Dienst, und bei "
                "den übrigen muss er eingeschaltet sein. Dann bleibt der Weg\n"
                "  über die Cloud: --grill-id aus der Pit-Boss-App."
            )
        return False, {}
    finally:
        try:
            await boss.stop()
        except Exception:
            pass
    if not isinstance(roh, dict) or not roh:
        print("✗ Verbunden, aber der Grill meldet keinen Zustand.")
        return False, {}
    return True, grill_state(roh)


def _modelle(suche: str = "") -> list[str]:
    """Die Modelle, die pytboss kennt - gefiltert."""
    from pytboss.grills import get_grills

    namen = sorted({grill.name for grill in get_grills()})
    if not suche:
        return namen
    klein = suche.strip().lower()
    return [name for name in namen if klein in name.lower()]


async def _setup_main(args: Any) -> int:
    if args.suchen:
        # Die Suche spricht rohes HTTP und kommt ohne pytboss aus.
        try:
            return await _suche(args.suchen)
        except ValueError as err:
            print(f"✗ {err}")
            return 1

    try:
        import pytboss  # noqa: F401
    except ModuleNotFoundError:
        # Der Grill ist ein Zusatz, kein Grundbestandteil - wer den Hub
        # ohne ihn aufsetzt, hat die Bibliothek nicht. Ein Traceback wäre
        # hier die unfreundlichste Art, das zu sagen.
        print(
            "pytboss fehlt. Im Hub-Verzeichnis:\n"
            '  pip install -e ".[pitboss]"\n'
            "Im Container ist sie bereits dabei."
        )
        return 1

    if args.modelle is not None:
        namen = _modelle(args.modelle)
        if not namen:
            print(f"Kein Modell enthält «{args.modelle}».")
            return 1
        print(f"{len(namen)} Modelle:")
        for name in namen:
            print(f"  {name}")
        print("\nDie Kennung steht auf dem Typenschild und in der Pit-Boss-App.")
        return 0

    host, grill_id = (args.host or "").strip(), (args.grill_id or "").strip()
    model = (args.model or "").strip()
    if not model or bool(host) == bool(grill_id):
        print(
            "Gebraucht werden --model und genau eines von --host (lokal) oder "
            "--grill-id (Cloud).\n"
            "Welche Modelle es gibt: --modelle (oder --modelle PBV für die "
            "Suche).\nDie Adresse im eigenen Netz findet --suchen 10.10.1.0/24."
        )
        return 1

    wohin = f"lokal auf {host}" if host else "über die Cloud"
    print(f"→ {model} {wohin} …")
    ok, shaped = await _probiere(model, host, grill_id, args.password or "")
    if not ok:
        return 1
    print("✓ Verbunden.")
    for zeile in zustandszeilen(shaped):
        print(f"  {zeile}")
    print("\nDas gehört in die config.yaml unter integrations:\n")
    print(yaml_block(args.name, model, host, grill_id, args.allow_remote_start))
    print(
        "\nSteht dort schon ein pitboss-Eintrag (zweiter Grill), dann nur "
        "diese Zeilen\nunter dessen 'grills:' anhängen:\n"
    )
    for zeile in grill_zeilen(
        args.name, model, host, grill_id, args.allow_remote_start
    ):
        print(zeile)
    print(
        "\nDanach Hub neu starten. Fernstart (turn_on) bleibt ohne "
        "allow_remote_start bewusst weg - er entfacht ein Feuer, neben dem "
        "niemand stehen muss."
    )
    return 0


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(
        description="Pit-Boss-Grill einrichten: Modell finden, Verbindung prüfen"
    )
    parser.add_argument("--model", help="z.B. PBV4PS2 – siehe --modelle")
    parser.add_argument("--host", help="Adresse im eigenen Netz (bevorzugt)")
    parser.add_argument("--grill-id", dest="grill_id", help="Kennung aus der App")
    parser.add_argument("--password", default="", help="Grill-Passwort, falls gesetzt")
    parser.add_argument("--name", default="Grill", help="Name in der App")
    parser.add_argument(
        "--allow-remote-start",
        action="store_true",
        help="Fernstart in den Vorschlag aufnehmen",
    )
    parser.add_argument(
        "--suchen",
        metavar="NETZ",
        help="Netz nach Grills absuchen, z.B. 10.10.1.0/24 oder 10.10.1",
    )
    parser.add_argument(
        "--modelle",
        nargs="?",
        const="",
        help="Modelle auflisten (mit Suchbegriff einschränken)",
    )
    sys.exit(asyncio.run(_setup_main(parser.parse_args())))
