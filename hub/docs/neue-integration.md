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
ausgegraut, statt „aus" zu behaupten.

**Push schlägt Polling.** Liefert das Gerät Events (SSE, WebSocket, MQTT),
diese nutzen und Polling nur als Fallback in grossem Intervall – siehe
`integrations/hue.py`.

**Fehler beim Setup sind nicht fatal.** Wirft `setup()`, wird die Integration
übersprungen und der Rest des Hubs startet normal. Also ruhig hart scheitern,
wenn die Konfiguration unbrauchbar ist (`raise ConfigError(...)`).

## Vorlagen für deine Geräte

Die Protokolle sind bereits gelöst – diese Bibliotheken zeigen, wie:

| Gerät | Ansatz | Vorlage |
|---|---|---|
| UniFi | Lokale Controller-API | `aiounifi` |
| UniFi Protect | Lokale API + WebSocket | `uiprotect` |
| Homematic | XML-RPC zur CCU | `pyhomematic` |
| Sonoff | Am einfachsten Tasmota + MQTT | `aiomqtt` |
| Roborock | Lokal + Cloud | `python-roborock` |
| Twinkly | Lokale REST-API | `xled` |
| Android TV | Remote-Protokoll | `androidtvremote2` |
| Google Cast | mDNS + CASTV2 | `pychromecast` |
| Spotify | Cloud, OAuth | `spotipy` |
| Google Calendar | Cloud, OAuth | `google-api-python-client` |
| Ring | Inoffizielle Cloud-API, 2FA | `ring_doorbell` |
| V-Zug | Semi-offizielle lokale API | `vzug-api` |
| Hue Play HDMI Sync | Lokale API der Sync Box | Hue Sync Box API |
| Matter | Eigener Controller-Dienst | `python-matter-server` |

Bei Cloud-Integrationen mit OAuth (Spotify, Google) gehören Tokens in die
Datenbank, nicht in die `config.yaml` – dafür ist beim Ausbau eine Tabelle
`integration_secrets` vorgesehen.
