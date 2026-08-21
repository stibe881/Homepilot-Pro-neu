# Eine neue Integration schreiben

Eine Integration übersetzt ein Gerät oder einen Dienst in Entitäten. Sie
kennt das Protokoll ihres Geräts – der Rest des Systems kennt nur noch
Entitäten. Mehr braucht es nicht:

```python
# homepilot/integrations/meine_integration.py
from ..core.entity import Entity, EntityKind
from ..core.integration import Integration


class MeineIntegration(Integration):
    name = "meine_integration"          # muss dem Dateinamen entsprechen

    async def setup(self) -> None:
        """Verbindung aufbauen und Entitäten anlegen."""
        host = self.config["host"]      # aus config.yaml
        await self.add_entity(
            "wohnzimmer",               # ergibt "meine_integration.wohnzimmer"
            EntityKind.LIGHT,
            "Mein Licht",
            state={"state": "off"},
            commands=["turn_on", "turn_off", "toggle"],
        )
        self.start_task(self._poll_loop())   # wird beim Stoppen aufgeräumt

    async def handle_command(self, entity: Entity, command: str, data: dict) -> None:
        """Kommando von App oder Automation ausführen."""
        if command == "turn_on":
            ...  # Gerät ansteuern
            await self.hub.registry.update_state(entity.id, {"state": "on"})

    async def teardown(self) -> None:
        await super().teardown()        # stoppt alle start_task()-Tasks
        await self._session.close()


INTEGRATION = MeineIntegration          # Pflicht: so wird sie gefunden
```

Aktivieren in `config.yaml`:

```yaml
integrations:
  - integration: meine_integration
    host: 192.168.1.50
```

## Regeln, die den Rest des Systems zusammenhalten

**Der Hauptwert liegt unter `state`.** Bei Lichtern/Schaltern `"on"`/`"off"`,
bei Sensoren der Messwert. Alles Weitere (brightness, unit, …) daneben.
Automationen und App verlassen sich darauf.

**Zustand nur über `registry.update_state()` ändern.** Nur so entsteht ein
`state_changed`-Event – und nur so erfahren App, Automationen und Datenbank
davon. Das Entity-Objekt direkt zu verändern, ist ein stiller Fehler.

**Nur Kommandos anbieten, die es auch gibt.** Was nicht in `commands` steht,
lehnt der Hub ab, bevor deine Integration es sieht.

**Nicht erreichbar ≠ aus.** Bei Verbindungsproblemen
`update_state(entity_id, {}, available=False)` – die App zeigt das Gerät dann
ausgegraut, statt „aus" zu behaupten. `available` beantwortet genau eine
Frage: *Antwortet das Gerät?* Was es sonst noch heissen könnte und warum
nicht, steht bei `available` in `core/entity.py` – lies das einmal, bevor
du es setzt. Kurz: nicht bei „ausgeschaltet", nicht bei „kennt diesen
Befehl nicht", und nicht beim ersten Zeitablauf, sondern erst nach
mehreren vergeblichen Versuchen in Folge.

`last_seen` setzt die Registry selbst, bei jeder Meldung – auch bei einer
unveränderten. Du musst nichts dafür tun.

**Push schlägt Polling.** Liefert das Gerät Events (SSE, WebSocket, MQTT),
diese nutzen und Polling nur als Fallback in grossem Intervall – siehe
`integrations/hue.py`.

**Den Takt nicht selbst erfinden.** `self.scan_interval()` liefert ihn:
was in der config.yaml steht, sonst die Vorgabe aus der Tabelle
`SCAN_INTERVALS` in `core/integration.py`. Dort steht auch, welche
Grössenordnung wofür gilt – trag deine Integration ein, statt eine
sechzehnte Zahl irgendwo hinzuschreiben.

**Fehler beim Setup sind nicht fatal.** Wirft `setup()`, wird die Integration
übersprungen und der Rest des Hubs startet normal. Also ruhig hart scheitern,
wenn die Konfiguration unbrauchbar ist (`raise ConfigError(...)`).

## Vorlagen für deine Geräte

Die Protokolle sind bereits gelöst – diese Bibliotheken zeigen, wie:

| Gerät | Ansatz | Vorlage |
|---|---|---|
| UniFi Protect | Lokale API + WebSocket | `uiprotect` |
| Roborock | Lokal + Cloud | `python-roborock` |
| Android TV | Remote-Protokoll | `androidtvremote2` |
| Google Cast | mDNS + CASTV2 | `pychromecast` |
| Spotify | Cloud, OAuth | `spotipy` |
| Google Calendar | Cloud, OAuth | `google-api-python-client` |
| Ring | Inoffizielle Cloud-API, 2FA | `ring_doorbell` |
| Hue Play HDMI Sync | Lokale API der Sync Box | Hue Sync Box API |
| Matter | Eigener Controller-Dienst | `python-matter-server` |

Bereits gebaut und als Muster brauchbar: `mqtt.py` (Push über einen
Broker), `homematic.py` (XML-RPC mit eigenem Callback-Server), `hue.py`
(REST + SSE-Eventstream), `unifi.py` (Login mit Sitzungserneuerung),
`meteoalarm.py` (reines Polling).

Bei Cloud-Integrationen mit OAuth (Spotify, Google) gehören Tokens in die
Datenbank, nicht in die `config.yaml` – dafür ist beim Ausbau eine Tabelle
`integration_secrets` vorgesehen.

## Ohne die echte Hardware testen

Für einige Protokolle gibt es Gegenstellen, die sich lokal starten lassen –
damit wird aus „sieht plausibel aus" ein echter Beweis:

| Protokoll | Gegenstelle | Test |
|---|---|---|
| MQTT | `mosquitto` (Broker) | `tests/test_mqtt_live.py` |
| Homematic | `pydevccu` (CCU-Simulator mit Originalgeräten) | `tests/test_homematic_live.py` |

Beide Tests starten ihre Gegenstelle als eigenen Prozess und überspringen
sich selbst, wenn sie nicht installiert ist. Das Muster lohnt sich für jede
neue Integration: Erst wenn ein Kommando nachweislich beim Gerät ankommt
und eine Änderung von aussen im Hub landet, ist die Integration fertig.

Wo es keine Gegenstelle gibt, hilft die Trennung von Protokoll und
Übersetzung: Funktionen wie `parse_payload` oder `value_to_state` sind
reine Funktionen ohne Netzwerk und lassen sich direkt testen.
