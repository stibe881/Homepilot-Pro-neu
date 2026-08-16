# Tür- und Fensterkontakte (Aqara P2 über Matter)

Der Aqara Door and Window Sensor P2 spricht Matter über Thread und braucht
deshalb **keinen Aqara-Hub** – aber einen Thread-Border-Router im Haus
(HomePod mini, Apple TV 4K, Google Nest Hub 2, Echo 4) und den
Matter-Controller-Dienst neben dem Hub.

Steht ein Kontakt offen, zeigt die App das oben auf der Startseite neben der
Begrüssung: „Tür offen" mit dem Namen des Geräts. Sind alle zu, verschwindet
der Hinweis ganz.

## 1. Matter-Dienst starten

Der Hub bringt keinen eigenen Matter-Stack mit; er spricht mit dem
offiziellen `python-matter-server`. In der `docker-compose.portainer.yml`
steht der Block schon fertig – nur die Kommentarzeichen entfernen:

```yaml
  matter:
    image: ghcr.io/home-assistant-libs/python-matter-server:stable
    container_name: homepilot-matter
    restart: unless-stopped
    network_mode: host
    security_opt:
      - apparmor=unconfined
    volumes:
      - matter-data:/data
      - /run/dbus:/run/dbus:ro

volumes:
  matter-data:
```

Danach **Update the stack → Deploy**. Das Volume `matter-data` hält die
Schlüssel der Matter-Fabric – **ins Backup aufnehmen**, sonst müssen alle
Geräte neu gekoppelt werden.

## 2. Integration einschalten

```yaml
  - integration: matter
    url: ws://127.0.0.1:5580/ws
```

## 3. Sensoren koppeln

**Wichtig, wenn die Sensoren schon in Apple Home, Google Home oder Home
Assistant hängen:** Ein Matter-Gerät gehört immer nur einer Fabric – aber es
kann mehreren beitreten. Nicht zurücksetzen, sondern in der bestehenden App
einen zusätzlichen Kopplungscode erzeugen:

- **Apple Home:** Gerät → Zahnrad → *Gerät oder Zubehör teilen* → *Kopplungscode*
- **Google Home:** Gerät → Einstellungen → *Mit Matter-App verknüpfen*
- **Home Assistant:** Gerät → *Zu anderem Netzwerk hinzufügen*

Der angezeigte 11-stellige Code gilt einmalig und ein paar Minuten lang.
Damit im Container:

```bash
docker exec -it homepilot-hub \
  python -m homepilot.integrations.matter -c /config/config.yaml --pair 34970112332
```

Frisch aus der Packung geht es genauso, dann mit dem QR-Code-Inhalt vom
Gerät (`MT:...`) oder dem aufgedruckten Zahlencode.

Gekoppelte Geräte auflisten:

```bash
docker exec -it homepilot-hub \
  python -m homepilot.integrations.matter -c /config/config.yaml
```

## 4. Benennen und einsortieren

Der Sensor meldet sich mit dem Namen, der in der koppelnden App steht –
sprechende Namen wie `Balkontüre` oder `Küchenfenster` sparen später Arbeit,
denn daraus leitet die App ab, ob sie „Tür offen" oder „Fenster offen"
schreibt (Name enthält *Fenster* → Fenster, sonst Tür).

Raum zuordnen in der `config.yaml`:

```yaml
rooms:
  Wohnzimmer:
    - matter.12_1        # Balkontüre
```

Die Entitäts-IDs stehen unter **Einstellungen → Geräte**.

## Was der Sensor liefert

| Anzeige | Bedeutung |
|---|---|
| Offen / Geschlossen | Magnetkontakt |
| Batterie … % | unter 15 % mit dem Zusatz „schwach!" |

## Automationen

```yaml
automations:
  - id: fenster_offen_erinnerung
    alias: Fenster beim Verlassen offen
    trigger:
      - type: state
        entity_id: helpers.abwesend
        to: "on"
    condition:
      - type: state
        entity_id: matter.12_1
        equals: "on"        # 'on' heisst offen
    action:
      - type: notify
        to: all
        title: Fenster offen
        body: Beim Gehen war noch ein Fenster offen.
```

Auch ohne Matter funktioniert dasselbe: Jeder Kontakt, dessen Zustand
`device_class: contact` trägt – oder dessen Name nach Tür/Fenster klingt –
landet im Hinweis auf der Startseite. Beim Nuki Smart Lock Pro kommt der
eingebaute Türsensor dazu, der meldet „offen" ganz von selbst.
