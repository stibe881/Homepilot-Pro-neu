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
| `GET /api/entities/{id}/history?hours=24` | Zustandsverlauf aus Supabase |
| `GET /api/automations` | Geladene Automationen |
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
systemd: [`deploy/README.md`](deploy/README.md).

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
| `homematic` | CCU via XML-RPC mit Push-Events, gegen den CCU-Simulator pydevccu geprüft |

**🟡 Implementiert nach Protokolldokumentation, noch nicht an echter Hardware**

Diese laufen erst, wenn du sie mit deinen Geräten ausprobierst – rechne mit
Nachbesserungen bei Zugangsdaten und Feldnamen.

| Integration | Notizen |
|---|---|
| `hue` | Philips Hue Bridge, lokale CLIP-v2-API + SSE-Eventstream |
| `unifi` | Anwesenheit über verbundene Clients, UniFi OS und Standalone |
| `twinkly` | Lokale REST-API mit Challenge-Response-Anmeldung |
| `vzug` | Lokale Home-API, nur lesend (Status, Programm, Restlaufzeit) |

**⬜ Noch offen**

| Integration | Notizen |
|---|---|
| `unifi_protect` | Lokale API + WebSocket |
| `roborock` | Lokal + Cloud |
| `spotify`, `google_calendar` | Cloud-APIs (OAuth, Tokens gehören in die DB) |
| `google_cast`, `androidtv` | mDNS/CASTV2, Remote-Protokoll |
| `hue_sync_box`, `ring` | Semi-offizielle APIs |
| `matter` | Grösster Brocken – eigener Controller-Dienst |

Anleitung inkl. Bibliotheks-Vorlagen für alle offenen Punkte:
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

- **Trigger:** `state` (optional `from`/`to`/`attribute`), `interval` (alle n
  Sekunden), `time` (täglich um HH:MM)
- **Bedingungen:** `state` (`equals`/`above`/`below`), `time` (`after`/`before`)
- **Aktionen:** `command`, `delay`

Jeder ausgeführte Lauf wird in `automation_runs` protokolliert.

## Nächste Schritte

- Weitere Integrationen nach der Anleitung ergänzen – Reihenfolge nach
  Nutzen: `unifi_protect`, `homematic`, `sonoff`, dann die Cloud-Dienste
- Räume/Gruppen in der App (Tabelle `rooms` liegt bereit)
- Verlaufs-Charts in der App auf Basis von `/api/entities/{id}/history`
- Automationen aus der Datenbank statt aus der YAML, damit sie in der App
  bearbeitet werden können
- Push-Benachrichtigungen (Expo Push) für Warnungen und Ring-Ereignisse
