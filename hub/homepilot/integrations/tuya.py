"""Tuya – Lampen, Steckdosen und Projektoren, lokal im eigenen Netz.

Konfiguration:
  - integration: tuya
    devices:
      - name: Sternenprojektor
        id: bf1234567890abcdefgh
        key: "0123456789abcdef"      # lokaler Schlüssel, siehe docs/tuya.md
        # ip: 192.168.1.77           # optional; sonst wird gesucht
        # version: 3.4               # optional, Standard 3.3
        # kind: light                # light (Standard) | switch
        # Zusätzliche Schalter am selben Gerät, z.B. die Laserpunkte:
        # switches:
        #   - name: Sterne
        #     dp: 101

Voraussetzung:  pip install "homepilot[tuya]"  bzw.  pip install tinytuya

Warum lokal und nicht über die Tuya-Cloud: Ein Gerät im eigenen
Wohnzimmer soll nicht davon abhängen, ob ein Rechenzentrum in Shenzhen
erreichbar ist. Der lokale Weg antwortet in Millisekunden, funktioniert
ohne Internet und meldet Änderungen von selbst - auch die, die jemand am
Gerät oder in der Hersteller-App macht.

Der Preis dafür ist der lokale Schlüssel: Tuya verschlüsselt auch im
eigenen Netz, und den Schlüssel gibt es nur über ein (kostenloses)
Entwicklerkonto beim Hersteller. Einmalig, danach nie wieder -
docs/tuya.md führt Schritt für Schritt hindurch, und

    python -m homepilot.integrations.tuya --cloud

holt die Schlüssel aller Geräte auf einmal und schreibt den fertigen
Konfigurationsblock hin.

Was ein Gerät kann, steht bei Tuya nicht in einem Namen, sondern in
nummerierten Datenpunkten («DPS»). Die Nummern sind je nach Gerät anders.
Die verbreitete Belegung für Lampen ist voreingestellt (siehe DEFAULT_DPS);
was ein bestimmtes Gerät wirklich meldet, zeigt

    python -m homepilot.integrations.tuya -c config.yaml --dps Sternenprojektor

Meldet der Hub «Schlüssel oder Protokollfassung passen nicht» (Tuyas
Fehler 914), sagt Tuya nicht, welches von beiden es ist. Statt zu raten:

    python -m homepilot.integrations.tuya -c config.yaml --probe Sternenprojektor

Das probiert jede Fassung einmal durch. Antwortet eine, steht sie da;
antwortet keine, liegt es am Schlüssel.
"""

from __future__ import annotations

import asyncio
import json
import queue
import threading
import time
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

# Die reine Logik wohnt in tuya_logic.py; die Namen bleiben von hier
# importierbar - die Tests beziehen sie seit je aus tuya.
from .tuya_logic import (  # noqa: F401
    BRIGHTNESS_RANGE,
    DEFAULT_DPS,
    HEARTBEAT_SECONDS,
    LEGACY_BRIGHTNESS_RANGE,
    LEGACY_DPS,
    MIRED_COLD,
    MIRED_WARM,
    REFRESH_SECONDS,
    brightness_range,
    check_address,
    check_key,
    cloud_report,
    cloud_raw_hint,
    decode_color,
    dps_map,
    encode_color,
    error_hint,
    error_text,
    from_mired,
    from_percent,
    hex_to_hsv,
    hsv_to_hex,
    is_error,
    light_commands,
    light_state,
    to_mired,
    to_percent,
)


# Die verbreitete Belegung neuerer Tuya-Lampen. Ältere Geräte benutzen
# 1-6 statt 20-25; beides lässt sich in der Konfiguration überschreiben.
class TuyaIntegration(Integration):
    name = "tuya"

    async def setup(self) -> None:
        try:
            import tinytuya  # noqa: F401 – nur Verfügbarkeit prüfen
        except ImportError as err:
            raise ConfigError(
                "tinytuya fehlt – installieren mit: pip install tinytuya"
            ) from err

        devices = self.config.get("devices") or []
        if not devices:
            raise ConfigError("tuya: 'devices' ist leer – kein Gerät zu bedienen")

        self._loop = asyncio.get_running_loop()
        # Je Gerät ein Arbeiter mit einem eigenen Draht zum Gerät. Zwei
        # Fäden auf demselben Socket vertragen sich bei tinytuya nicht;
        # deshalb schickt niemand direkt, sondern legt in die Schlange.
        self._queues: dict[str, queue.Queue] = {}
        self._workers: dict[str, threading.Thread] = {}
        self._stop = threading.Event()
        self._geraete: dict[str, dict[str, Any]] = {}
        # Entitäts-ID -> (Gerät, Datenpunkt) für die Zusatzschalter.
        self._extra: dict[str, tuple[str, int]] = {}

        for block in devices:
            await self._add_device(block)

        for schluessel in list(self._geraete):
            arbeiter = threading.Thread(
                target=self._worker,
                args=(schluessel,),
                name=f"tuya-{schluessel}",
                daemon=True,
            )
            self._workers[schluessel] = arbeiter
            arbeiter.start()

    async def _add_device(self, block: dict[str, Any]) -> None:
        geraete_id = str(block.get("id") or "").strip()
        if not geraete_id:
            raise ConfigError(
                "tuya: jedes Gerät braucht eine 'id' – die holt "
                "'python -m homepilot.integrations.tuya --cloud'"
            )
        # Erst prüfen, dann anlegen: Ein Schlüssel falscher Länge wird von
        # tinytuya abgewiesen, noch bevor es das Gerät anspricht - mit
        # derselben Fehlernummer wie eine falsche Protokollfassung. Wer
        # das nicht weiss, sucht danach an der falschen Stelle.
        key = check_key(block.get("key"))
        name = str(block.get("name") or geraete_id)
        check_address(block.get("ip"))
        kind = EntityKind.SWITCH if block.get("kind") == "switch" else EntityKind.LIGHT
        nummern = dps_map(block)
        bereich = brightness_range(block)

        entity = await self.add_entity(
            geraete_id,
            kind,
            name,
            state={"state": "off"},
            commands=light_commands(nummern, kind),
            available=False,
        )
        self._geraete[geraete_id] = {
            "config": block,
            "entity_id": entity.id,
            "dps": nummern,
            "range": bereich,
            "legacy": bool(block.get("legacy")),
        }
        self._queues[geraete_id] = queue.Queue()

        # Zusatzschalter: Ein Sternenprojektor hat neben dem Licht noch die
        # Laserpunkte und die Wellen - eigene Datenpunkte ohne festen
        # Namen. Als eigene Schalter sind sie in App, Szenen und Abläufen
        # sofort brauchbar, ohne dass es dafür eine besondere Kachel
        # bräuchte.
        for zusatz in block.get("switches") or []:
            dp = zusatz.get("dp")
            if dp is None:
                raise ConfigError("tuya: jeder Zusatzschalter braucht ein 'dp'")
            unter = await self.add_entity(
                f"{geraete_id}_{int(dp)}",
                EntityKind.SWITCH,
                str(zusatz.get("name") or f"{name} {dp}"),
                state={"state": "off"},
                commands=["turn_on", "turn_off", "toggle"],
                available=False,
            )
            self._extra[unter.id] = (geraete_id, int(dp))

    async def teardown(self) -> None:
        self._stop.set()
        for schlange in getattr(self, "_queues", {}).values():
            # Aufwecken, damit der Arbeiter nicht bis zum Zeitablauf wartet.
            schlange.put(None)
        for arbeiter in getattr(self, "_workers", {}).values():
            arbeiter.join(timeout=5)
        await super().teardown()

    # ── Gerät → Hub ────────────────────────────────────────────────────────

    def _connect(self, schluessel: str) -> Any:
        """Verbindung aufbauen (läuft im Arbeitsfaden)."""
        import tinytuya

        block = self._geraete[schluessel]["config"]
        device = tinytuya.Device(
            schluessel,
            address=check_address(block.get("ip")),
            local_key=str(block.get("key")),
            persist=True,
        )
        device.set_version(float(block.get("version", 3.3)))
        device.set_socketPersistent(True)
        device.set_socketTimeout(5)
        return device

    def _worker(self, schluessel: str) -> None:
        """Ein Faden je Gerät: schickt, lauscht, hält die Leitung warm.

        Der lauschende Teil ist der eigentliche Gewinn: Tuya meldet jede
        Änderung von selbst - auch die, die jemand am Gerät oder in der
        Hersteller-App macht. Ohne ihn wüsste der Hub erst bei der
        nächsten Abfrage davon.
        """
        schlange = self._queues[schluessel]
        device: Any = None
        letzter_schlag = 0.0
        letzte_abfrage = 0.0
        fehler_gemeldet = False

        while not self._stop.is_set():
            try:
                if device is None:
                    device = self._connect(schluessel)
                    antwort = device.status()
                    # tinytuya wirft nicht, es antwortet: Ein falscher
                    # Schlüssel kommt als Wörterbuch mit 'Error' zurück,
                    # und zwar sofort. Genau deshalb muss das hier eine
                    # Ausnahme werden - sonst gilt der Draht als
                    # aufgebaut, jede Runde kostet keine Zeit, und die
                    # Schleife brennt einen Prozessorkern nieder, während
                    # der Hub nebenan nicht mehr zum Starten kommt.
                    if is_error(antwort):
                        raise ConnectionError(error_text(antwort))
                    self._melden(schluessel, antwort, verfuegbar=True)
                    if fehler_gemeldet:
                        self.log.info("Tuya-Gerät %s wieder erreichbar", schluessel)
                    fehler_gemeldet = False
                    letzter_schlag = letzte_abfrage = time.time()

                gesendet = False
                while True:
                    try:
                        auftrag = schlange.get_nowait()
                    except queue.Empty:
                        break
                    if auftrag is None:
                        break
                    nutzlast, future = auftrag
                    try:
                        antwort = device.set_multiple_values(nutzlast)
                        self._melden(schluessel, antwort, verfuegbar=True)
                        self._erledigt(future, None)
                    except Exception as err:  # Leitung neu aufbauen
                        self._erledigt(future, err)
                        raise
                    gesendet = True

                if self._stop.is_set():
                    break

                jetzt = time.time()
                if gesendet:
                    letzter_schlag = jetzt
                elif jetzt - letzter_schlag >= HEARTBEAT_SECONDS:
                    device.heartbeat(True)
                    letzter_schlag = jetzt

                if jetzt - letzte_abfrage >= REFRESH_SECONDS:
                    antwort = device.status()
                    if is_error(antwort):
                        raise ConnectionError(error_text(antwort))
                    self._melden(schluessel, antwort, verfuegbar=True)
                    letzte_abfrage = jetzt

                antwort = device.receive()
                if is_error(antwort):
                    raise ConnectionError(error_text(antwort))
                if antwort:
                    self._melden(schluessel, antwort, verfuegbar=True)
                else:
                    # Untergrenze für eine Runde. receive() wartet im
                    # Normalfall bis zum Zeitablauf, aber darauf ist kein
                    # Verlass - und eine Schleife ohne Boden ist kein
                    # Wartezustand, sondern eine Last.
                    self._stop.wait(0.2)
            except Exception as err:
                if not fehler_gemeldet:
                    self.log.warning(
                        "Tuya-Gerät %s nicht erreichbar: %s – wird weiter versucht",
                        schluessel,
                        err,
                    )
                    fehler_gemeldet = True
                self._melden(schluessel, None, verfuegbar=False)
                if device is not None:
                    try:
                        device.close()
                    except Exception:
                        pass
                    device = None
                self._stop.wait(10)

        if device is not None:
            try:
                device.close()
            except Exception:
                pass

    def _erledigt(self, future: Any, fehler: Exception | None) -> None:
        """Das Ergebnis eines Kommandos zurück in die Ereignisschleife."""

        def setzen() -> None:
            if future.done():
                return
            if fehler is None:
                future.set_result(None)
            else:
                future.set_exception(fehler)

        self._loop.call_soon_threadsafe(setzen)

    def _melden(self, schluessel: str, antwort: Any, *, verfuegbar: bool) -> None:
        """Aus dem Arbeitsfaden zurück in die Ereignisschleife."""
        dps = {}
        if isinstance(antwort, dict):
            if antwort.get("Error"):
                verfuegbar = False
            dps = antwort.get("dps") or {}
        asyncio.run_coroutine_threadsafe(
            self._uebernehmen(schluessel, dps, verfuegbar), self._loop
        )

    async def _uebernehmen(
        self, schluessel: str, dps: dict[str, Any], verfuegbar: bool
    ) -> None:
        geraet = self._geraete.get(schluessel)
        if geraet is None:
            return
        zustand = light_state(dps, geraet["dps"], geraet["range"]) if dps else {}
        await self.hub.registry.update_state(
            geraet["entity_id"], zustand, available=verfuegbar
        )
        for entity_id, (gehoert_zu, dp) in self._extra.items():
            if gehoert_zu != schluessel:
                continue
            teil: dict[str, Any] = {}
            if str(dp) in dps:
                teil["state"] = "on" if dps[str(dp)] else "off"
            await self.hub.registry.update_state(entity_id, teil, available=verfuegbar)

    # ── Hub → Gerät ────────────────────────────────────────────────────────

    async def handle_command(
        self, entity: Entity, command: str, data: dict[str, Any]
    ) -> None:
        if entity.id in self._extra:
            schluessel, dp = self._extra[entity.id]
            an = command == "turn_on" or (
                command == "toggle" and entity.state.get("state") != "on"
            )
            await self._senden(schluessel, {dp: an})
            return

        schluessel = entity.id.split(".", 1)[1]
        geraet = self._geraete.get(schluessel)
        if geraet is None:
            raise ConfigError(f"Gerät '{entity.id}' gehört nicht zu dieser Integration")
        nummern = geraet["dps"]
        nutzlast: dict[int, Any] = {}

        if command in ("turn_on", "turn_off", "toggle"):
            an = command == "turn_on" or (
                command == "toggle" and entity.state.get("state") != "on"
            )
            nutzlast[nummern["switch"]] = an
        elif command == "set_brightness":
            prozent = data.get("brightness", 100)
            # Auf 0 gestellt heisst «aus» - nicht «an, aber unsichtbar».
            if float(prozent or 0) <= 0:
                nutzlast[nummern["switch"]] = False
            else:
                nutzlast[nummern["switch"]] = True
                nutzlast[nummern["brightness"]] = from_percent(prozent, geraet["range"])
                if "mode" in nummern:
                    nutzlast[nummern["mode"]] = "white"
        elif command == "set_color_temp":
            nutzlast[nummern["switch"]] = True
            nutzlast[nummern["color_temp"]] = from_mired(
                data.get("color_temp", data.get("mirek", MIRED_WARM))
            )
            if "mode" in nummern:
                nutzlast[nummern["mode"]] = "white"
        elif command == "set_color":
            farbe = data.get("color") or data.get("hex")
            if not farbe:
                raise ConfigError("set_color braucht eine Farbe der Form #RRGGBB")
            nutzlast[nummern["switch"]] = True
            nutzlast[nummern["color"]] = encode_color(
                str(farbe), legacy=geraet["legacy"]
            )
            if "mode" in nummern:
                nutzlast[nummern["mode"]] = "colour"
        else:
            raise ConfigError(f"Kommando '{command}' gibt es hier nicht")

        await self._senden(schluessel, nutzlast)

    async def _senden(self, schluessel: str, nutzlast: dict[int, Any]) -> None:
        """Auftrag in die Schlange des Arbeiters und auf die Antwort warten."""
        future: asyncio.Future = self._loop.create_future()
        self._queues[schluessel].put(({str(dp): wert for dp, wert in nutzlast.items()}, future))
        try:
            await asyncio.wait_for(future, timeout=15)
        except TimeoutError as err:
            raise ConnectionError(
                f"Tuya-Gerät {schluessel} antwortet nicht"
            ) from err
        except Exception as err:
            raise ConnectionError(f"Tuya-Gerät {schluessel}: {err}") from err


INTEGRATION = TuyaIntegration


# ── Einrichtungs-Helfer ────────────────────────────────────────────────────
# Drei Fragen stehen zwischen einem Tuya-Gerät und dieser Integration, und
# für jede gibt es hier einen Aufruf:
#
#   --scan                       Welche Geräte sind im Netz, und welche
#                                Protokollfassung sprechen sie?
#   --cloud                      Wie lauten die lokalen Schlüssel?
#   -c config.yaml --dps <Name>  Welche Nummer macht was?


def _scan(seconds: int) -> int:
    import tinytuya

    print(f"Suche {seconds} s lang nach Tuya-Geräten im Netz …\n")
    gefunden = tinytuya.deviceScan(False, seconds, color=False, poll=False)
    if not gefunden:
        print(
            "Nichts gefunden. Die Suche läuft über einen Rundruf im eigenen\n"
            "Netz – sie funktioniert nur, wenn der Hub im selben Netz steht\n"
            "wie die Geräte (bei Docker: network_mode: host)."
        )
        return 1
    for ip, info in sorted(gefunden.items()):
        print(f"  {ip:<16} id={info.get('gwId')}  Protokoll {info.get('version')}")
    print(
        "\nDie Kennungen stehen jetzt da, die Schlüssel noch nicht – die\n"
        "holt: python -m homepilot.integrations.tuya --cloud"
    )
    return 0


def roh_antwort(wolke: Any) -> str:
    """Die Wolke direkt fragen und die Antwort deuten.

    Der Endpunkt ist derselbe, den tinytuya benutzt – nur ohne dessen
    Aufbereitung, die den Fehlergrund gerade dann verliert, wenn man ihn
    braucht.
    """
    pfad = "/v1.0/iot-01/associated-users/devices"
    try:
        antwort = wolke.cloudrequest(pfad)
    except AttributeError:
        return (
            "Diese tinytuya-Fassung kann den Endpunkt nicht direkt "
            "abfragen – ohne Rohantwort bleibt nur die Liste oben."
        )
    except Exception as fehler:  # noqa: BLE001 - reine Diagnose
        return f"Der Aufruf {pfad} ist gescheitert: {fehler}"
    return cloud_raw_hint(antwort)


def _cloud() -> int:
    import getpass

    import tinytuya

    print(
        "Zugangsdaten des Tuya-Entwicklerprojekts (siehe docs/tuya.md).\n"
        "Sie werden nur für diesen Aufruf gebraucht und nirgends gespeichert.\n"
    )
    region = input("Region (eu / us / cn / in) [eu]: ").strip() or "eu"
    api_key = input("Access ID / Client ID: ").strip()
    api_secret = getpass.getpass("Access Secret / Client Secret: ").strip()
    if not api_key or not api_secret:
        print("✗ Ohne Zugangsdaten geht es nicht.")
        return 1

    wolke = tinytuya.Cloud(apiRegion=region, apiKey=api_key, apiSecret=api_secret)
    geraete = wolke.getdevices()
    if not isinstance(geraete, list):
        print(f"✗ Tuya antwortet: {geraete}")
        return 1

    print()
    print(cloud_report(geraete))
    if not geraete:
        # tinytuya schluckt bei einer leeren Liste, warum sie leer ist:
        # «kein Konto verknüpft» und «IoT Core nicht freigeschaltet»
        # sehen von aussen gleich aus, brauchen aber verschiedene
        # Handgriffe. Die Rohantwort unterscheidet die beiden.
        print()
        print(roh_antwort(wolke))
    return 0 if geraete else 1


def _geraete_aus_config(config_path: str, gesucht: str) -> list[dict[str, Any]]:
    """Die passenden Geräte aus der config.yaml – oder eine leere Liste."""
    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "tuya"]
    if not blocks:
        print("✗ In der config.yaml steht kein 'tuya'-Block.")
        return []
    treffer = [
        geraet
        for block in blocks
        for geraet in (block.get("devices") or [])
        if gesucht.lower() in str(geraet.get("name", "")).lower()
        or gesucht == str(geraet.get("id"))
    ]
    if not treffer:
        namen = [
            str(geraet.get("name"))
            for block in blocks
            for geraet in (block.get("devices") or [])
        ]
        print(f"✗ '{gesucht}' ist keines von: {', '.join(namen) or '(keine)'}")
    return treffer


# Die Fassungen, die Tuya-Geräte im Umlauf sprechen. 3.3 ist die
# häufigste, 3.4 und 3.5 handeln zusätzlich einen Sitzungsschlüssel aus.
PROTOKOLL_FASSUNGEN = [3.1, 3.2, 3.3, 3.4, 3.5]


async def _probe_main(config_path: str, gesucht: str) -> int:
    """Alle Protokollfassungen durchprobieren.

    Fehler 914 heisst «Schlüssel oder Fassung passen nicht» - und welches
    von beiden, sagt Tuya nicht. Statt zu raten wird hier jede Fassung
    einmal angefragt: Antwortet eine mit Daten, ist es die; antwortet
    keine, liegt es am Schlüssel.

    Was der Rundruf im Netz meldet, ist übrigens nicht immer die Fassung,
    mit der das Gerät dann wirklich spricht - genau deshalb gibt es das
    hier.
    """
    import tinytuya

    treffer = _geraete_aus_config(config_path, gesucht)
    if not treffer:
        return 1

    for geraet in treffer:
        print(f"\n{geraet.get('name')} ({geraet['id']}):")
        adresse = check_address(geraet.get("ip"))
        erfolg = None
        for fassung in PROTOKOLL_FASSUNGEN:
            device = tinytuya.Device(
                str(geraet["id"]), address=adresse, local_key=str(geraet["key"])
            )
            device.set_version(fassung)
            device.set_socketTimeout(5)
            antwort = await asyncio.to_thread(device.status)
            try:
                device.close()
            except Exception:
                pass
            if is_error(antwort):
                print(f"  {fassung}  ✗ {error_text(antwort)[:80]}")
                continue
            dps = (antwort or {}).get("dps") or {}
            print(f"  {fassung}  ✓ antwortet mit {len(dps)} Datenpunkten")
            erfolg = fassung
            break

        if erfolg is not None:
            print(
                f"\n  → In die config.yaml: version: {erfolg}\n"
                "    Danach den Hub neu starten."
            )
        else:
            print(
                "\n  → Keine Fassung kam durch. Dann stimmt der Schlüssel nicht\n"
                "    mehr: python -m homepilot.integrations.tuya --cloud\n"
                "    Er ändert sich, sobald das Gerät in der Hersteller-App neu\n"
                "    angelernt wurde. Auch möglich: Eine andere Steuerung (z.B.\n"
                "    LocalTuya in Home Assistant) hält die eine lokale\n"
                "    Verbindung besetzt, die das Gerät zulässt."
            )
    return 0


async def _dps_main(config_path: str, gesucht: str) -> int:
    import tinytuya

    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "tuya"]
    if not blocks:
        print("✗ In der config.yaml steht kein 'tuya'-Block.")
        return 1

    treffer = [
        geraet
        for block in blocks
        for geraet in (block.get("devices") or [])
        if gesucht.lower() in str(geraet.get("name", "")).lower()
        or gesucht == str(geraet.get("id"))
    ]
    if not treffer:
        namen = [
            str(geraet.get("name"))
            for block in blocks
            for geraet in (block.get("devices") or [])
        ]
        print(f"✗ '{gesucht}' ist keines von: {', '.join(namen) or '(keine)'}")
        return 1

    for geraet in treffer:
        device = tinytuya.Device(
            str(geraet["id"]),
            address=geraet.get("ip") or None,
            local_key=str(geraet["key"]),
        )
        device.set_version(float(geraet.get("version", 3.3)))
        antwort = await asyncio.to_thread(device.status)
        print(f"\n{geraet.get('name')} ({geraet['id']}):")
        if not isinstance(antwort, dict) or antwort.get("Error"):
            print(f"  ✗ {antwort}")
            hinweis = error_hint(antwort)
            if hinweis:
                print(f"    {hinweis}")
            continue
        dps = antwort.get("dps") or {}
        if not dps:
            print("  (keine Datenpunkte gemeldet)")
            continue
        nummern = dps_map(geraet)
        bekannt = {str(nummer): name for name, nummer in nummern.items()}
        for nummer, wert in sorted(dps.items(), key=lambda paar: int(paar[0])):
            deutung = bekannt.get(nummer, "")
            print(f"  {nummer:>4}  {json.dumps(wert)}{'   ← ' + deutung if deutung else ''}")
        print(
            "\n  Was hier ohne Pfeil steht, kennt der Hub noch nicht. Ein\n"
            "  Ein/Aus-Punkt (true/false) lässt sich als Zusatzschalter\n"
            "  eintragen:\n"
            "      switches:\n"
            "        - name: Sterne\n"
            "          dp: 101"
        )
    return 0


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Tuya-Einrichtung für HomePilot")
    parser.add_argument("-c", "--config", help="Pfad zur config.yaml des Hubs")
    parser.add_argument(
        "--scan",
        nargs="?",
        const=10,
        type=int,
        metavar="SEKUNDEN",
        help="Geräte im Netz suchen",
    )
    parser.add_argument(
        "--cloud",
        action="store_true",
        help="Lokale Schlüssel aus dem Tuya-Entwicklerprojekt holen",
    )
    parser.add_argument(
        "--dps", metavar="NAME", help="Datenpunkte eines eingerichteten Geräts zeigen"
    )
    parser.add_argument(
        "--probe",
        metavar="NAME",
        help="Alle Protokollfassungen durchprobieren (bei Fehler 914)",
    )
    args = parser.parse_args()

    if args.scan is not None:
        sys.exit(_scan(args.scan))
    if args.cloud:
        sys.exit(_cloud())
    if args.dps:
        if not args.config:
            parser.error("--dps braucht auch -c config.yaml")
        sys.exit(asyncio.run(_dps_main(args.config, args.dps)))
    if args.probe:
        if not args.config:
            parser.error("--probe braucht auch -c config.yaml")
        sys.exit(asyncio.run(_probe_main(args.config, args.probe)))
    parser.error("Nichts zu tun – --scan, --cloud, --dps oder --probe wählen")
