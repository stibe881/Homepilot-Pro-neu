# Zigbee ohne Wolke

Zigbee2MQTT redet mit einem USB-Stick am Hub. Ein Aqara-Kontakt, der so
angebunden ist, funktioniert auch dann, wenn beim Hersteller ein
Rechenzentrum ausfällt – und das ist der ganze Grund für Zigbee.

## Was der Hub braucht

```yaml
- integration: zigbee2mqtt
  broker: 192.168.1.5
  port: 1883
  username: "${MQTT_USER}"
  password: "${MQTT_PASSWORD}"
  base_topic: zigbee2mqtt      # so heisst es in Zigbee2MQTT selbst
  ignore:                      # optional
    - Repeater Keller
```

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

## Wenn man umbenennt

Die Kennung einer Kachel leitet sich vom Namen in Zigbee2MQTT ab. Wer
dort umbenennt, bekommt eine neue Kachel – Raum, Favorit und Abläufe
zeigen dann auf die alte. Zigbee2MQTT schickt keine dauerhafte Kennung
mit, die nicht die IEEE-Adresse wäre, und die wollte niemand in seiner
config.yaml stehen haben. Also: Namen vergeben, bevor der Hub sie liest.
