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
