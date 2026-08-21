# Automations-Rezepte

Fertige Bausteine zum Einfügen in die `config.yaml` (Abschnitt `automations:`)
oder – die einfacheren – über *Abläufe → Neuer Ablauf → Vorlagen* in der App.

Der Standort für alle Sonnen-Trigger steht in der `config.yaml`:

```yaml
location:
  latitude: 47.1445    # Zell LU
  longitude: 8.0675
```

## Storen zum Sonnenuntergang schliessen

```yaml
- id: storen_abends_zu
  alias: Storen zu bei Sonnenuntergang
  trigger:
    - type: sun
      event: sunset
      offset: -30        # 30 Min vorher; positiv = nachher
  action:
    - type: command
      entity_id: overkiz.wohnzimmer_storen
      command: close
```

Für mehrere Storen entweder je Store eine Aktion anhängen oder eine **Szene**
„Storen zu" anlegen und `- type: scene` auslösen.

## Sturmschutz

Fährt Markisen/Storen ein, sobald MeteoAlarm eine Warnung meldet.

```yaml
- id: sturmschutz
  alias: Sturmschutz
  trigger:
    - type: state
      entity_id: meteoalarm.switzerland
      to: alert
  action:
    - type: command
      entity_id: overkiz.markise_terrasse
      command: close
```

## Hitzeschutz

Prüft alle 15 Minuten: Sonne oben **und** über 25 °C → Storen halb schliessen.

```yaml
- id: hitzeschutz
  alias: Hitzeschutz Süd
  trigger:
    - type: interval
      seconds: 900
  condition:
    - type: sun
      state: up
    - type: state
      entity_id: weather.forecast
      attribute: temperature
      above: 25
  action:
    - type: command
      entity_id: overkiz.wohnzimmer_storen
      command: set_position
      data: { position: 30 }     # 30 % offen
```

## Bewegungslicht

Licht an bei Bewegung, nach einer Weile wieder aus. Die Wartezeit ist ein
gewöhnlicher `delay`-Schritt zwischen Ein- und Ausschalten:

```yaml
- id: bewegungslicht_flur
  alias: Licht Flur bei Bewegung
  mode: restart              # siehe unten
  trigger:
    - type: state
      entity_id: homematic.0031A0C9A6F400_3
      to: "on"
  condition:
    # Nur wenn es wirklich dunkel ist – am Messwert des Melders, nicht am
    # Sonnenstand: Der weiss nichts von einem trüben Novembernachmittag.
    - type: state
      entity_id: homematic.0031A0C9A6F400_3
      attribute: illumination
      below: 20
  action:
    - type: command
      entity_id: hue.flur
      command: turn_on
      data: { brightness: 40 }
    - type: delay
      seconds: 300
    - type: command
      entity_id: hue.flur
      command: turn_off
```

### Was passiert bei erneuter Bewegung?

Genau die Frage entscheidet `mode` – und beide Antworten sind richtig, nur
eben in verschiedenen Räumen:

| `mode` | Wirkung | Wofür |
| --- | --- | --- |
| `single` (Vorgabe) | Der laufende Ablauf zählt, die neue Bewegung wird verworfen. Das Licht geht **5 Minuten nach der ersten** Bewegung aus. | Durchgangsräume: Ein Licht, das sich selbst immer weiter verlängert, will man dort nicht. |
| `restart` | Der laufende Ablauf bricht ab und beginnt von vorn. Das Licht geht **5 Minuten nach der letzten** Bewegung aus. | Flur, Keller, Bad – überall, wo man sich aufhält. |

### Ohne Wartezeit

Lässt man `delay` und das Ausschalten weg, bleibt das Licht an, bis es
jemand von Hand oder ein anderer Ablauf ausschaltet:

```yaml
- id: bewegungslicht_ohne_zeit
  alias: Licht Keller bei Bewegung
  trigger:
    - type: state
      entity_id: homematic.0031A0C9A6F400_3
      to: "on"
  action:
    - type: command
      entity_id: hue.keller
      command: turn_on
```

`mode` ist dann wirkungslos: Der Ablauf ist vorbei, ehe der nächste
Auslöser kommt.

### In der App

*Abläufe → Ablauf öffnen → „… dann das tun"*: Sobald ein Schritt „Warten"
oder „Warten bis" dabei ist, erscheint darunter die Wahl **„Wenn er dabei
erneut ausgelöst wird"** – „nichts tun" oder „von vorn beginnen". Ohne
Warte-Schritt bleibt sie ausgeblendet: Die Frage stellt sich dann nicht.
Fertig zusammengesetzt gibt es das auch als Vorlage **„Licht bei
Bewegung, mit Nachlauf"**.

Zwei Dinge, die leicht überraschen:

- Der abgebrochene Durchgang taucht im Verlauf nicht auf. Das ist
  Absicht: Bei einem Flurlicht stünde dort sonst bei jeder Bewegung ein
  abgebrochener Lauf neben dem neuen, und die hundert gemerkten Läufe
  wären binnen eines Abends voll davon.
- Beim Ausschalten von Hand mitten in der Wartezeit schaltet der Ablauf
  danach trotzdem noch einmal aus. Das ist harmlos; wer es sauber will,
  hängt vor das Ausschalten ein `wait_until` oder prüft mit einer
  Bedingung.

## Abwesenheitsmodus

1. Einen Helfer-Schalter anlegen (Integration `helpers`):

   ```yaml
   - integration: helpers
     switches:
       - id: abwesend
         name: Abwesend
         icon: airplane-outline
   ```

2. Anwesenheitssimulation aktivieren (Integration `presence_sim`) – schaltet
   abends zufällig Lichter, solange `helpers.abwesend` an ist:

   ```yaml
   - integration: presence_sim
     switch: helpers.abwesend
     lights: [hue.wohnzimmer, hue.buero, hue.kueche]
     min_interval: 600
     max_interval: 1800
   ```

3. Bewegung an der Kamera → Push, aber nur wenn abwesend:

   ```yaml
   - id: alarm_bewegung
     alias: Bewegung während Abwesenheit
     trigger:
       - type: state
         entity_id: unifi_protect.eingang
         attribute: motion
         to: "on"
     condition:
       - type: state
         entity_id: helpers.abwesend
         equals: "on"
     action:
       - type: notify
         to: all
         title: Bewegung erkannt
         body: Die Kamera am Eingang hat Bewegung erkannt.
   ```

Statt `helpers.abwesend` lässt sich auch `unifi.anyone_home` verwenden
(dann `switch_active: "off"` bei presence_sim und `equals: "off"` in der
Bedingung).

4. Treppenhauslicht: Bewegung schaltet ein, jede weitere Bewegung
   verlängert – aus erst eine Weile nach der letzten. Das ist genau das
   Rezept **[Bewegungslicht](#bewegungslicht)** weiter oben; entscheidend
   ist dort die Zeile `mode: restart`.

## Tumbler ist fertig

Der Tumbler hängt an einer Homematic IP Schalt-Messsteckdose (HmIP-PSM). Er
meldet selbst nichts – aber seine Leistungsaufnahme tut es: Während des
Trocknens zieht er einige hundert Watt, danach fast nichts.

Dafür kennt der `state`-Trigger `above`/`below`: Er löst nur beim
**Übertritt** aus, nicht bei jeder Schwankung darunter. So kommt genau eine
Meldung, wenn die Leistung von «läuft» auf «fertig» fällt.

```yaml
automations:
  - id: tumbler_fertig
    alias: Tumbler fertig
    trigger:
      - type: state
        entity_id: homematic.0001D3C99C6A2B_3
        attribute: power
        below: 5              # Watt
    action:
      - type: notify
        to: all
        title: Tumbler fertig
        body: Die Wäsche kann raus.
```

Voraussetzung ist der Messkanal in der Gerätekonfiguration:

```yaml
- integration: homematic
  host: 10.10.1.x
  port: 2001
  devices:
    - address: "001015699EA263:3"           # Schaltkanal (STATE + Schalten)
      port: 2010                            # Homematic IP
      name: Tumbler
      kind: switch
      power_address: "001015699EA263:6"     # Messkanal (Leistung in Watt)
```

Umgekehrt geht es genauso – `above: 50` meldet, dass er angelaufen ist. Der
gleiche Trigger passt für jede Messgrösse, etwa `attribute: temperature`
mit `above: 26` für «im Schlafzimmer wird es zu warm».

## Adaptive Beleuchtung

Keine Automation nötig – die Integration `adaptive` erledigt es:

```yaml
- integration: adaptive
  lights: [hue.buero, hue.wohnzimmer]
  interval: 300
  warm: 400     # nachts/am Horizont (~2500 K)
  cool: 220     # Mittagssonne (~4500 K)
```

Nur eingeschaltete Lichter werden angepasst; nichts wird ein- oder
ausgeschaltet.

## Gerätegruppen

Mehrere Lichter als eine Kachel:

```yaml
- integration: group
  groups:
    - id: lichter_eg
      name: Lichter EG
      members: [hue.stehlampe, hue.decke_kueche, homematic.Licht_Flur]
      kind: light
```

`turn_on`/`turn_off`/`toggle` (und Helligkeit bei Lichtgruppen) gehen an alle
Mitglieder; die Gruppe zeigt „an", sobald ein Mitglied an ist.
