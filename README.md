# HomePilot Pro

Ein komplett eigenes Home-Automation-System: Hub (Python) + App (Expo /
React Native für iPhone, iPad und Web) + Supabase als Datenbank.

```
├── hub/        # Python-Backend: Integrationen, Automationen, REST + WebSocket-API
├── app/        # Expo-App (TypeScript): Dashboard, Steuerung, Live-Updates
└── supabase/   # Datenbankschema und Einrichtung
```

## Architektur

```
┌──────────────────────── hub (Python, asyncio) ─────────────────────────┐
│                                                                        │
│  Integrationen         Kern                          API               │
│  ┌──────────┐                                                          │
│  │ hue      │──┐  ┌───────────────┐  ┌──────────┐  ┌───────────────┐   │
│  │ demo     │──┼─▶│ EntityRegistry│─▶│ EventBus │─▶│ WebSocket /ws │──▶ App
│  │ meteo-   │──┘  │ (Zustand)     │  └────┬─────┘  │ REST /api/... │   │
│  │ alarm    │◀─┐  └───────────────┘       │        └───────────────┘   │
│  └──────────┘  │                    ┌─────▼──────┐                     │
│                │                    │ Automation │                     │
│    Kommandos   └────────────────────│ Engine     │                     │
│    (turn_on…)                       └─────┬──────┘                     │
│                                     ┌─────▼──────┐                     │
│                                     │   Store    │──▶ Supabase         │
│                                     └────────────┘   (Zustand,         │
└──────────────────────────────────────────────────────  Verlauf, Logs)  ┘
```

**Kernidee:** Jede Integration übersetzt ihr Gerät in ein einheitliches
`Entity`-Modell (Licht, Schalter, Sensor, Alarm, …). Alles Weitere – API,
App, Automationen, Datenbank – kennt nur noch Entitäten und Events, nie das
Gerät selbst. Eine neue Integration anzubinden heisst deshalb nur: eine
Klasse mit `setup()` und `handle_command()` schreiben.

## Schnellstart

### 1. Supabase

Projekt anlegen und Schema einspielen: [`supabase/README.md`](supabase/README.md).
Der Hub läuft auch ohne – dann ohne Verlauf und ohne gespeicherten Zustand.

### 2. Hub

```bash
cd hub
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

cp config.example.yaml config.yaml     # Integrationen anpassen
export HOMEPILOT_TOKEN="ein-langes-zufaelliges-token"
export SUPABASE_SERVICE_KEY="eyJ..."
python -m homepilot -c config.yaml
```

Der Hub läuft dann auf `http://0.0.0.0:8123`:

| Endpoint | Zweck |
|---|---|
| `GET /api/entities` | Alle Entitäten mit Zustand |
| `GET /api/entities/{id}` | Eine Entität |
| `POST /api/entities/{id}/command` | `{"command": "turn_on", "data": {"brightness": 80}}` |
| `GET /api/entities/{id}/snapshot` | Standbild einer Kamera (JPEG) |
| `GET /api/entities/{id}/stream.m3u8` | Live-Bild als HLS (startet die Umwandlung bei Bedarf) |
| `GET /api/entities/{id}/history?hours=24` | Zustandsverlauf aus Supabase |
| `GET /api/automations` | Geladene Automationen |
| `GET /api/energy/months` | Dieser Monat gegen den letzten – gleicher Zeitraum und ganzer Vormonat |
| `GET /api/appliances/cycles` | Programmläufe der Haushaltgeräte mit Statistik |
| `GET/PUT /api/push/categories` | Welche Arten von Nachrichten dieser Benutzer bekommt |
| `GET /api/automations/{id}/dryrun` | Was der Ablauf jetzt täte – ohne es zu tun |
| `POST /api/config/check` | Konfiguration prüfen, ohne sie zu speichern |
| `GET /api/shortcuts` | Fertige Bausteine für Apple Kurzbefehle |
| `POST /api/system/update` | Stösst die eingerichtete Update-Adresse an |
| `GET /api/push/image/{token}` | Das Bild zu einer Push-Nachricht – **ohne Token**, zufällige Adresse, zehn Minuten gültig |
| `WS /ws` | Snapshot + Live-Events, Kommandos |

Auth: `Authorization: Bearer <token>`, am WebSocket `?token=<token>`.

Tests: `pytest` (im Ordner `hub/`).

### 3. App

```bash
cd app
npm install
npx expo start        # QR-Code mit Expo Go auf iPhone/iPad scannen
npx expo start --web  # oder im Browser
```

`npm install` nach jedem `git pull` nicht überspringen: Kommt eine neue
Abhängigkeit dazu, startet die App sonst mit einem fehlenden Modul.

Beim ersten Start Hub-URL (z.B. `http://192.168.1.10:8123`), Token und
optional den eigenen Namen für die Begrüssung eintragen – alles wird lokal
gespeichert.

Die Oberfläche passt sich der Gerätegrösse an: Auf dem iPad gibt es links
eine Symbolleiste, ein dreispaltiges Kachelraster und rechts eine Spalte mit
Wetterlage und den letzten Ereignissen. Auf dem iPhone wandert die Leiste
nach unten, das Raster wird zweispaltig und die rechte Spalte rutscht unter
die Kacheln.

## Hub dauerhaft betreiben

Zum Ausprobieren reicht der Start von Hand. Für den Alltag gehört der Hub
auf einen Rechner, der durchgehend läuft und im selben Netz steht wie deine
Geräte – Raspberry Pi, Mini-PC oder NAS. Fertige Einrichtung für Docker und
systemd: [`deploy/README.md`](deploy/README.md), für Portainer:
[`deploy/portainer.md`](deploy/portainer.md).

```bash
cp hub/config.example.yaml hub/config.yaml
echo "HOMEPILOT_TOKEN=$(openssl rand -base64 32)" > .env
docker compose up -d
```

## Räume

Die Reiter über den Kacheln kommen aus der `config.yaml` des Hubs:

```yaml
rooms:
  Wohnzimmer:
    - hue.stehlampe
    - homematic.Temperatur_Wohnzimmer
  Küche:
    - mqtt.sonoff_kueche
```

Ohne diesen Abschnitt zeigt die App alle Geräte ohne Reiter.

## Integrationen

**✅ Gegen die echte Gegenstelle getestet**

| Integration | Notizen |
|---|---|
| `demo` | Virtuelle Lichter/Sensoren – zum Entwickeln ohne Hardware |
| `meteoalarm` | Unwetterwarnungen, gegen den echten CAP/Atom-Feed geprüft |
| `mqtt` | Sonoff & Co. via Tasmota, gegen einen echten Broker end-to-end geprüft |
| `homematic` | CCU via XML-RPC mit Push-Events, gegen den CCU-Simulator pydevccu geprüft; klassische (2001) und Homematic-IP-Geräte (2010) gemischt, Schalt-Messsteckdosen mit Leistung in Watt |
| `helpers` | Virtuelle An/Aus-Schalter für Modi (z.B. „Abwesend"), rein im Hub |
| `group` | Gerätegruppen: mehrere Geräte als eine Kachel, rein im Hub |
| `adaptive` | Farbtemperatur folgt dem Sonnenstand (nutzt Hue), Sonnenkurve getestet |
| `presence_sim` | Anwesenheitssimulation: schaltet abends zufällig Lichter, rein im Hub |

**🟡 Implementiert nach Protokolldokumentation, noch nicht an echter Hardware**

Diese laufen erst, wenn du sie mit deinen Geräten ausprobierst – rechne mit
Nachbesserungen bei Zugangsdaten und Feldnamen.

| Integration | Notizen |
|---|---|
| `hue` | Philips Hue Bridge, lokale CLIP-v2-API + SSE-Eventstream |
| `unifi` | Anwesenheit über verbundene Clients, UniFi OS und Standalone |
| `twinkly` | Lokale REST-API mit Challenge-Response-Anmeldung |
| `vzug` | Lokale Home-API, nur lesend (Status, Programm, Restlaufzeit) |
| `unifi_protect` | Kameras: eigener Menüpunkt „Kameras", Live-Bild im Vollbild mit unter einer Sekunde Rückstand (RTSP → Low-Latency-HLS über mediamtx, ffmpeg als Rückfall, ohne Neucodierung), Bewegung und Klingeln live über den Ereignisstrom ([Einrichtung](docs/kameras.md)) |
| `hue_sync` | Hue Play HDMI Sync Box: Sync an/aus, Modus und Eingang |
| `spotify` | Was gerade läuft, Play/Pause/Weiter, Lautstärke und Stumm, und die Wiedergabe per Tipp auf einen anderen Lautsprecher umziehen (Spotify Connect – Google-Home-Lautsprecher tauchen dort automatisch auf) |
| `roborock` | Sauger über das Roborock-Konto: Zustand, Akku, start/pause/dock, Saugstärke und „Sauger finden"; Räume direkt auf der Karte antippen und einzeln oder zu mehreren saugen lassen (`pip install "homepilot[roborock]"`) |
| `google_cast` | Chromecast & Co.: was läuft, Play/Pause/Weiter, Lautstärke und Stumm (`pip install "homepilot[cast]"`) |
| `google_calendar` | Die nächsten Termine als Kachel (Cloud, Refresh-Token) |
| `androidtv` | Fernbedienung, App-Anzeige, Lautstärke; einmalige PIN-Kopplung: `python -m homepilot.integrations.androidtv -c config.yaml` |
| `ring` | Klingeln und Bewegung als Push, Akku und Status per Abfrage, Türöffner beim Ring Intercom (Zwei-Schritt-Bestätigung in der App); einmalige 2FA-Anmeldung: `python -m homepilot.integrations.ring -c config.yaml` |
| `matter` | Lichter, Steckdosen und Sensoren über den python-matter-server (eigener Dienst, Block in docker-compose.yml); Tür-/Fensterkontakte mit Batteriestand ([Einrichtung](docs/tuer-und-fensterkontakte.md)); Protokoll end-to-end gegen einen nachgebauten Dienst getestet. Geräte koppeln: `python -m homepilot.integrations.matter -c config.yaml --pair <Code>` |
| `overkiz` | Somfy TaHoma & Co.: Storen, Rollläden, Raffstoren mit Position und Lamellenwinkel (lokale API übers Gateway); einmalige Anmeldung: `python -m homepilot.integrations.overkiz -c config.yaml` |
| `nuki` | Nuki Smart Lock (4./5. Gen): auf-/abschliessen und aufziehen über die Nuki-Web-API; Token auf web.nuki.io erzeugen |
| `weather` | Wetterlage und 7-Tage-Vorhersage (Open-Meteo, kostenlos, kein Schlüssel) |

Damit sind **alle 16 geplanten Produkte angebunden.** Anleitung zum
Selberschreiben weiterer Integrationen:
[`hub/docs/neue-integration.md`](hub/docs/neue-integration.md)

## Automationen

Deklarativ in `config.yaml` (Trigger → Bedingungen → Aktionen):

```yaml
automations:
  - id: motion_light
    alias: Licht bei Bewegung
    trigger:
      - type: state
        entity_id: demo.motion_hall
        to: "on"
    condition:
      - type: state
        entity_id: demo.light_livingroom
        equals: "off"
    action:
      - type: command
        entity_id: demo.light_livingroom
        command: turn_on
        data: { brightness: 80 }
```

- **Trigger:** `state` (optional `from`/`to`/`attribute`, oder `above`/`below`
  für eine gekreuzte Schwelle – z.B. Leistung fällt unter 5 W), `interval`
  (alle n Sekunden), `time` (täglich um HH:MM), `sun`
  (`event: sunrise|sunset`, `offset` in Minuten)
- **Bedingungen:** `state` (`equals`/`above`/`below`), `time` (`after`/`before`),
  `sun` (`state: up|down`)
- **Aktionen:** `command`, `delay`, `scene`, `notify` (Push aufs Handy)

Fertige Rezepte (Storen zum Sonnenuntergang, Sturmschutz, Hitzeschutz,
Abwesenheitsmodus, adaptives Licht):
[`hub/docs/automationen-rezepte.md`](hub/docs/automationen-rezepte.md).
Szenen per Siri/Widget auslösen: [`docs/siri-und-widgets.md`](docs/siri-und-widgets.md).

Jeder ausgeführte Lauf wird in `automation_runs` protokolliert.

## Nächste Schritte

- Die 🟡-Integrationen an der echten Hardware ausprobieren und Feldnamen
  nachziehen – das ist der wertvollste offene Schritt
