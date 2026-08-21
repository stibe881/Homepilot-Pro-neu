# Wie ein Gerät in der App erscheint

Das Gegenstück zu [`neue-integration.md`](neue-integration.md). Dort steht,
wie ein Gerät in den Hub kommt; hier, wie es in der App eine Kachel
bekommt, die man bedienen kann.

Der Regelfall ist: **gar nichts tun.** Wer eine Entität mit einer
bekannten `kind` anlegt, bekommt die Kachel geschenkt. Dieser Text ist
für die Fälle, in denen das nicht reicht.

## Was von allein geht

Die App kennt diese Arten und zeichnet sie ohne Zutun:

| `kind` | Kachel zeigt | Bedienung |
| --- | --- | --- |
| `light` | An/Aus, Helligkeit, Farbe | Tippen, Schieber |
| `switch` | An/Aus, Watt falls vorhanden | Tippen |
| `cover` | Position als Bild | Hoch, runter, Position |
| `lock` | Zu/Auf | Zwei Knöpfe |
| `binary_sensor` | Zustand, je nach `device_class` | – |
| `sensor` | Wert und Einheit, Kurve auf Tipp | – |
| `media_player` | Was läuft, Lautstärke | Play/Pause, Boxenwahl |
| `vacuum` | Zustand, Räume | Saugen, Station |
| `camera` | Standbild, Livebild auf Tipp | – |
| `appliance` | Läuft/fertig, Restzeit | – |
| `alarm` | Scharf/unscharf | Modi |
| `button` | Letzter Druck | – |

**Bevor du eine neue Art erfindest:** Prüf, ob eine bestehende passt. Ein
Ventilator ist ein `switch`, ein Heizkörperthermostat ein `climate`, ein
Sternenprojektor ein `light`. Jede neue Art bedeutet eine neue Kachel,
eine neue Zeile in der Geräteauswahl der Abläufe und ein neues Symbol.

## Die drei Stellen, die eine Art kennen müssen

Wenn du wirklich eine neue brauchst:

**1. `hub/homepilot/core/entity.py`** – die Art selbst:

```python
class EntityKind:
    ...
    HUMIDIFIER = "humidifier"
```

**2. `app/src/lib/geraeteart.ts`** – wie sie heisst und welches Symbol
sie trägt. Beides in der Sprache der Wohnung, nicht in der des Hubs:

```typescript
case 'humidifier':
  return 'Luftbefeuchter';   // nicht «humidifier»
```

Diese Datei ist rein und getestet (`geraeteart.test.ts`) – ergänz den
Test gleich mit. Sie versorgt zwei Orte auf einmal: die Geräteauswahl in
den Abläufen und die Beschriftung überall sonst.

**3. `app/src/components/EntityCard.tsx`** – die Kachel. Such nach
`case 'vacuum':`; daneben kommt deine.

Die Datei ist mit über zweitausend Zeilen zu gross (Punkt 59 der
Werkbank-Liste). Bis sie zerlegt ist: Halte dich an das Muster der
Nachbarn, und leg die entscheidbare Logik – was zeigt die Kachel bei
welchem Zustand – als reine Funktion daneben.

## Was ein Gerät bedienbar macht

Nicht die Art, sondern die **Befehlsliste**. Die App zeigt einen Knopf,
wenn der Befehl in `entity.commands` steht:

```python
await self.add_entity(
    "luftbefeuchter",
    EntityKind.HUMIDIFIER,
    "Luftbefeuchter Schlafzimmer",
    state={"state": "off", "humidity": 45},
    commands=["turn_on", "turn_off", "toggle"],
)
```

Steht `set_brightness` nicht drin, gibt es keinen Schieber – auch wenn
die Kachel einen zeichnen könnte. Das ist Absicht: Ein Knopf, der nichts
tut, ist schlimmer als keiner.

## `device_class`: wofür ein Melder steht

Bei `binary_sensor` entscheidet sie über Anzeige *und* Warnungen:

| `device_class` | Kachel | Warnt bei |
| --- | --- | --- |
| `contact` | Offen/Geschlossen | offenem Fenster beim Weggehen |
| `motion` | Bewegung | – |
| `presence` | Anwesend | – |
| `smoke` | Rauch | sofort, unabhängig von der Alarmanlage |
| `moisture` | Wasser | sofort |

Ohne sie ist der Melder für den Hub bloss ein Ja/Nein, und der Wächter
kann weder vor einem offenen Fenster noch vor Wasser warnen. Bei den
eindeutigen Datenpunkten errät der Hub sie; angeben sticht raten.

## Zusätzliche Werte an einer Kachel

Alles, was im `state` steht, kann die Kachel zeigen. Ein paar Namen sind
gesetzt und werden überall gleich behandelt:

| Feld | Bedeutung | Wo es auftaucht |
| --- | --- | --- |
| `brightness` | 0–100 | Schieber |
| `power` | Watt | Kachel, Energie-Bildschirm |
| `illumination` | Lux | Bedingung «nur wenn dunkel» |
| `battery` / `low_battery` | Ladestand | Geräte-Gesundheit |
| `unit` | Einheit eines Messwerts | Kachel, Geräteart |
| `device_class` | wofür der Melder steht | siehe oben |
| `last_seen` | wann zuletzt erreichbar | «nicht erreichbar»-Hinweis |

Eigene Felder sind erlaubt und werden ignoriert, bis eine Kachel sie
liest.

## Ereignisse statt Zustände

Ein Wandtaster meldet bei jedem Druck denselben Wert. Damit der zweite
Druck nicht als «nichts geändert» durchfällt, braucht er einen
Zeitstempel daneben:

```python
{"state": "short", "last_press": time.time()}
```

Die bekannten Paare stehen in `core/automation.py` unter
`EVENT_MARKERS`: `state`/`last_press`, `ring`/`last_ring`,
`motion`/`last_motion`. Wer ein neues Ereignisfeld einführt, trägt es
dort ein – sonst löst es genau einmal aus.

## Prüfen, ohne das Haus anzufassen

Der Weg mit Demo-Hub, Web-Fassung und Browser steht in der
[CLAUDE.md](../../CLAUDE.md). Damit siehst du die neue Kachel in einer
Minute, ohne ein echtes Gerät zu haben – und kannst nachmessen, ob sie
auf dem iPad passt.
