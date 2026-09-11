# Zigbee ohne Wolke

Zigbee2MQTT redet mit dem Funkstück und schreibt alles in MQTT; der Hub
liest mit. Ein Aqara-Kontakt, der so angebunden ist, funktioniert auch
dann, wenn beim Hersteller ein Rechenzentrum ausfällt – und das ist der
ganze Grund für Zigbee.

**Der Hub sieht das Funkstück nie.** Für ihn ist Zigbee eine Liste von
MQTT-Themen. Ob dort ein USB-Stick steckt oder ein Kästchen am
Netzwerkkabel hängt, ist Sache von Zigbee2MQTT - und ändert an der
Konfiguration des Hubs kein Zeichen.

## Die Kette, einmal ganz

    Zigbee-Gerät  ~funk~  Dongle  ~LAN~  Zigbee2MQTT  →  Mosquitto  →  Hub  →  App

Alle drei Dienste laufen im selben Stack auf demselben Rechner
(`docker-compose.yml`) und erreichen einander über 127.0.0.1. Der
Broker horcht **nur** dort: Wer ihn aus dem WLAN erreichte, hörte jeden
Fensterkontakt mit und dürfte jedes Licht schalten - MQTT kennt keine
Rechte je Thema (`deploy/mosquitto.conf`).

## Der Dongle: SONOFF Dongle Max am Netzwerkkabel

Hier hängt kein USB-Stick am Server, sondern ein **SONOFF Dongle Max
(Dongle-M)** mit PoE irgendwo im Haus. Das ist mehr als Bequemlichkeit:
Zigbee ist ein Funknetz, und der entscheidende Punkt ist, wo der
Koordinator steht. Im Serverschrank neben zwei Netzteilen und einem
WLAN-Router steht er schlecht.

Drei Dinge, die man dabei wissen muss:

**Der Dongle braucht eine feste Adresse.** SONOFF nennt
`Dongle-M.local`, und das geht über mDNS - aber eben nur, solange mDNS
geht. Fällt es aus, sieht das aus wie ein defekter Dongle: Zigbee2MQTT
startet nicht, und kein Gerät meldet sich mehr. Fünf Minuten im Router
nehmen diese Fehlerquelle weg.

**Der Adapter heisst `ember`, nicht `zstack`.** Im Dongle Max sitzt ein
EFR32MG24 von Silicon Labs, und der spricht EmberZNet. `zstack` ist der
Texas-Instruments-Stick aus den meisten Anleitungen im Netz; damit
verbindet sich hier nichts, und die Fehlermeldung sagt es nicht
deutlich.

**Zigbee oder Thread, nicht beides gleichzeitig.** Der Dongle kann
beides, aber in einer Firmware jeweils eines. Für Zigbee2MQTT muss er
in der Zigbee-Fassung laufen; die Thread-Seite des Hauses hängt an
Matter (`docker-compose.yml`, Dienst `matter`) und braucht ihn nicht.

Die Einstellungen dazu stehen in `deploy/zigbee2mqtt.example.yaml` - die
Datei wird einmal nach `hub/zigbee2mqtt/configuration.yaml` kopiert und
bleibt danach dort. Ins Repo gehört sie nicht zurück: Zigbee2MQTT
schreibt beim ersten Start den Netzwerkschlüssel hinein, und mit dem
hört man das ganze Zigbee-Netz mit.

## Beim ersten Mal

1. Dongle anstecken (PoE), im Router eine feste Adresse geben.
2. `deploy/zigbee2mqtt.example.yaml` nach
   `hub/zigbee2mqtt/configuration.yaml` kopieren, die Adresse eintragen,
   den Ordner `chown -R 1000:1000` geben.
3. Dem Broker seinen Datenordner anlegen: `hub/mosquitto/data`, und zwar
   `chown -R 1883:1883` - im Abbild läuft Mosquitto als Benutzer
   `mosquitto` (1883), nicht als 1000 wie der Hub. Im Portainer-Stack
   liegen beide Ordner unter `/opt/homepilot`, und dort gehört auch die
   `mosquitto.conf` selbst hin: [`deploy/portainer.md`](../deploy/portainer.md).
4. Stack ausrollen. Die Weboberfläche von Zigbee2MQTT steht danach auf
   Port **8099**.
5. Dort «Permit join» für ein paar Minuten öffnen und die Geräte
   anlernen - und **gleich benennen**, siehe unten.
6. Im Hub die Integration eintragen (nächster Abschnitt) und neu starten.

## Was der Hub braucht

```yaml
- integration: zigbee2mqtt
  broker: 127.0.0.1            # der Broker im selben Stack
  port: 1883
  base_topic: zigbee2mqtt      # so heisst es in Zigbee2MQTT selbst
  ignore:                      # optional
    - Repeater Keller
```

Kein Benutzername, kein Passwort: Der Broker nimmt nur Verbindungen von
diesem Rechner an, und ein Passwort, das niemanden abhält, ist schlechter
als keines - es sieht nach Sicherheit aus. Steht der Broker später doch
im Netz, kommen `username`, `password` und `tls: true` dazu.

Mehr nicht. Die Geräte trägt niemand ein: Zigbee2MQTT führt eine Liste
und beschreibt jedes Gerät selbst – was es kann, was es misst, wie es
heisst. Der Hub liest sie beim Verbinden und legt daraus die Kacheln an.
Wer ein Gerät anlernt, sieht es ohne Neustart.

## Ein Gerät ist eine Kachel

Ein Bewegungsmelder, der Bewegung, Helligkeit, Temperatur und Batterie
meldet, ist im Alltag ein Bewegungsmelder. Er bekommt eine Kachel; der
Rest steht als Angabe daneben. Was ein Gerät *ist*, entscheidet sich
danach, was man mit ihm *tut* – erst die Bedienung, dann die Messwerte.

| Zigbee2MQTT | Im Hub | Bedienung |
| --- | --- | --- |
| light | Licht | an/aus, Helligkeit, Farbtemperatur, Farbe |
| switch | Schalter | an/aus |
| cover | Store | auf, zu, Stopp, Stellung |
| lock | Schloss | auf- und zuschliessen |
| action | Wandtaster | kein Zustand – der letzte Druck ist der Zustand |
| occupancy, contact, water_leak … | Melder | – |
| temperature, humidity … | Messfühler | – |

## Zwei Dinge, die überraschen

**`contact: true` heisst zu.** Zigbee dreht den Fensterkontakt um. Der
Hub dreht ihn zurück – ohne das meldet ein Haus nachts, alle Fenster
stünden offen, sobald sie geschlossen sind.

**Ein Gerät gilt erst als erreichbar, wenn es sich meldet.** Ein
Fensterkontakt meldet sich nur, wenn sich etwas ändert; bei einem selten
benutzten Fenster kann das Tage dauern. Bis dahin steht die Kachel blass
da. Das ist ehrlicher als ein «alles in Ordnung», das niemand geprüft
hat.

## Wenn der Container oben ist und nichts sagt

Sieht so aus:

```
Using '/app/data' as data directory
Starting Zigbee2MQTT without watchdog.
Migration notes written in /app/data/migration-1-to-2.log
...
[CHANGE] Migrated settings to version 5
```

...und danach minutenlang nichts, obwohl `docker ps` den Container als
`Up` führt. Das ist **kein** Hängen: Die Zeilen, die man jetzt sucht -
«Starting Zigbee2MQTT version …», «Connecting to MQTT server»,
«Adapter ready» - sind allesamt `info`. Stand in der configuration.yaml
`log_level: warning`, verschluckt der Dienst genau sie. Kein Fehler zu
sehen heisst dann: bis hierher kein Fehler passiert.

Ob er wirklich läuft, sagt die Weboberfläche, nicht das Protokoll:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8099
```

Die Migrationsnotizen davor sind harmlos: Zigbee2MQTT 2.x zieht eine
ältere configuration.yaml durch alle Schema-Stufen und schreibt sie
danach in der neuen Form zurück.

## Wenn man umbenennt

Die Kennung einer Kachel leitet sich vom Namen in Zigbee2MQTT ab. Wer
dort umbenennt, bekommt eine neue Kachel – Raum, Favorit und Abläufe
zeigen dann auf die alte. Zigbee2MQTT schickt keine dauerhafte Kennung
mit, die nicht die IEEE-Adresse wäre, und die wollte niemand in seiner
config.yaml stehen haben. Also: Namen vergeben, bevor der Hub sie liest.
