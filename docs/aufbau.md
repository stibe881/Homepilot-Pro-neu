# Wie das Ganze zusammenhängt

Sechzehn Seiten erklären je ein Thema. Diese eine erklärt, wo die Themen
zueinander stehen – die Frage, die man zuerst hat und die bisher nirgends
beantwortet war.

## Das Bild

```
      im Haus                          │        ausserhalb
                                       │
  ┌──────────────┐                     │
  │  Geräte      │  Homematic (CCU)    │
  │              │  Hue-Bridge         │
  │              │  Matter · MQTT      │
  │              │  Tuya · Nuki        │
  └──────┬───────┘                     │
         │ lokal, ohne Internet        │
         ▼                             │
  ┌──────────────────────────┐         │   ┌────────────────┐
  │        hub/              │◄────────┼──►│  Hersteller-   │
  │  ┌────────────────────┐  │         │   │  Clouds        │
  │  │ integrations/      │  │         │   │  Ring, Spotify,│
  │  │  je Gerät eine     │  │         │   │  Roborock …    │
  │  └─────────┬──────────┘  │         │   └────────────────┘
  │            ▼             │         │
  │  ┌────────────────────┐  │         │   ┌────────────────┐
  │  │ core/registry      │  │         │   │  Supabase      │
  │  │  der Zustand aller │  │◄────────┼──►│  (freiwillig)  │
  │  │  Geräte            │  │         │   │  Anmeldung,    │
  │  └─────────┬──────────┘  │         │   │  Sicherung     │
  │            │             │         │   └────────────────┘
  │  ┌─────────▼──────────┐  │         │
  │  │ core/automation    │  │         │   ┌────────────────┐
  │  │  Auslöser →        │  │─────────┼──►│  Expo Push     │
  │  │  Bedingung →       │  │         │   │  Nachrichten   │
  │  │  Aktion            │  │         │   └────────────────┘
  │  └─────────┬──────────┘  │         │
  │            ▼             │         │
  │  ┌────────────────────┐  │         │
  │  │ api/server.py      │  │         │
  │  │  HTTP + WebSocket  │  │         │
  │  └─────────┬──────────┘  │         │
  │            │             │         │
  │  ┌─────────▼──────────┐  │         │
  │  │ homepilot-data.json│  │         │
  │  │  Benutzer, Abläufe,│  │         │
  │  │  Szenen, Listen    │  │         │
  │  └────────────────────┘  │         │
  └────────────┬─────────────┘         │
               │ HTTP + WebSocket      │
     ┌─────────┼─────────┐             │
     ▼         ▼         ▼             │
  ┌──────┐ ┌──────┐ ┌─────────┐        │
  │iPhone│ │ iPad │ │ Browser │        │  alle aus app/
  └──────┘ └──────┘ └─────────┘        │  derselbe Code
```

## Die Regel dahinter

**Der Hub ist die Wahrheit.** Er hält den Zustand jedes Geräts, führt die
Abläufe aus und entscheidet, wer was darf. Die App zeigt an und schickt
Befehle – sie rechnet nichts selbst aus, was der Hub wissen müsste.

Das ist der Grund, warum die App auf einem Telefon ohne Netz noch den
letzten bekannten Stand zeigt, aber nichts schaltet: Sie hat keine
eigene Wahrheit.

**Alles Wichtige läuft lokal.** Licht, Storen, Schlösser, Abläufe – dafür
braucht es kein Internet. Was aussen hängt (Ring, Spotify, Roborock,
Wetter, Push), ist ausdrücklich Zubehör: Fällt es aus, fällt nur das aus.

## Was durch die Leitung geht

| Weg | Wofür | Wie oft |
| --- | --- | --- |
| **WebSocket** | Zustandsänderungen der Geräte, Befehle | dauernd, ereignisgetrieben |
| **HTTP** | Alles Übrige: Listen, Abläufe, Szenen, System | auf Anfrage |
| **Push** | Nachrichten, wenn die App zu ist | selten |

Die Familienlisten (Einkauf, Aufgaben) laufen heute noch über HTTP im
Minutentakt – siehe Punkt 18 der Werkbank-Liste.

## Was ohne Supabase fehlt

Der Hub läuft absichtlich auch ohne Datenbank. Was dann anders ist:

| | mit Supabase | ohne |
| --- | --- | --- |
| Anmeldung mit E-Mail und Passwort | ja | nur über Token/QR-Code |
| Einladung neuer Benutzer per Mail | ja | nein |
| Off-Site-Sicherung | ja | nur lokal in `backups/` |
| Alles Übrige | | **unverändert** |

Geräte, Abläufe, Szenen, Familienlisten und Energie liegen immer in der
`homepilot-data.json` auf dem Hub – nie in der Datenbank. Ein Supabase-
Ausfall kostet keine Funktion im Haus.

## Wo was liegt

Eine Tabelle dazu steht in der [CLAUDE.md](../CLAUDE.md) im
Wurzelverzeichnis, zusammen mit den Konventionen und den Prüfschritten.

## Weiterlesen

- [Erste Stunde](erste-stunde.md) – vom leeren Rechner zum ersten Licht
- [Entscheidungen](entscheidungen.md) – warum es so aussieht und nicht anders
- [Neue Integration](../hub/docs/neue-integration.md) – ein Gerät anbinden
- [Neue Kachel](../hub/docs/neue-kachel.md) – wie es in der App erscheint
- [Betrieb](../deploy/README.md) – dauerhaft laufen lassen
