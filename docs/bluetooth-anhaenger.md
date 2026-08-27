# Bluetooth-Anhänger: wo liegt der Schlüssel?

Ein kleiner Anhänger am Schlüsselbund, ein zweiter im Rucksack – und die
App sagt, in welchem Zimmer sie zuletzt lagen. Nicht auf den Meter, aber
auf das Zimmer, und das ist die Frage, die man morgens um sieben stellt.

## Zuerst: AirTags gehen nicht

Und zwar grundsätzlich, nicht «noch nicht».

Ein AirTag sendet seine Kennung verschlüsselt und wechselt sie ständig.
Wiedererkennen kann ihn nur, wer den privaten Schlüssel des Besitzers
hat, und der liegt im iPhone. Eine öffentliche Schnittstelle zu «Wo
ist?» gibt es nicht.

Wer trotzdem AirTags in einem Haus-System anbietet, meldet sich im
Hintergrund mit dem Apple-Konto an einem undokumentierten Dienst an.
Das fliegt beim nächsten Umbau bei Apple auf, das Konto ist dabei im
Spiel, und wiederherstellen lässt sich das Ganze nur mit denselben
Zugangsdaten. Für «wo liegt der Schlüssel?» ist das der falsche Handel –
deshalb macht HomePilot es nicht.

Dasselbe gilt für Tile und Chipolo: Beide reden nur mit ihrer eigenen
Wolke.

## Was geht: Anhänger mit fester Kennung

iBeacon- und Eddystone-Anhänger senden dieselbe Kennung an jeden, der
zuhört. Sie kosten wenige Franken, halten mit einer Knopfzelle etwa ein
Jahr, und niemand muss sich irgendwo anmelden.

Gehört werden sie von ein paar Empfängern im Haus. Am einfachsten sind
ESP32-Platinen mit [ESPresense](https://espresense.com) – einer je
Stockwerk oder Zimmer, an einem USB-Netzteil. Sie melden über MQTT, wie
weit ein Anhänger gerade weg ist.

```yaml
- integration: bletags
  broker: 192.168.1.5
  port: 1883
  username: "${MQTT_USER}"
  password: "${MQTT_PASSWORD}"
  base_topic: espresense       # so heisst es in ESPresense selbst
  away_after: 120              # Sekunden ohne Meldung = ausser Haus
  tags:
    - id: tile:abcd1234
      name: Schlüsselbund
    - id: ibeacon:0102...-1-2
      name: Rucksack
```

## Welche Kennung hat mein Anhänger?

Nicht raten – nachsehen. Es genügt der Abschnitt mit `broker`; die Tags
trägt man danach ein:

```bash
python -m homepilot.integrations.bletags -c config.yaml --geraete
```

Das hört eine halbe Minute mit und zeigt, was gerade sendet – mit
Zimmer und Entfernung. Wer den Anhänger dabei durch die Wohnung trägt,
erkennt ihn daran, dass seine Entfernung sich ändert.

## Warum das Zimmer manchmal stehen bleibt

Zwei Empfänger sind selten gleich weit weg, aber oft fast. Ein Anhänger
auf dem Küchentisch springt dann die halbe Nacht zwischen Küche und
Wohnzimmer. Beide Zimmer wären richtig; der Wechsel ist es nicht.

Deshalb wechselt der Hub das Zimmer erst, wenn ein anderes **deutlich**
näher ist (ein Meter). Und er nimmt die gemeldete Entfernung, nicht die
Signalstärke: Die schwankt mit jeder Wand.

## «weg» heisst weg

Hört kein Empfänger den Anhänger mehr, steht dort nach zwei Minuten
`weg` – und nicht das letzte Zimmer. Ein Schlüssel, der laut App im Büro
liegt, obwohl er in der Jackentasche unterwegs ist, wäre die
unangenehmere Auskunft.

Damit lässt sich auch ein Ablauf bauen: «Wenn der Rucksack das Haus
verlässt und die Kinder nicht in der Schule sind …» – der Anhänger ist
für Abläufe ein Gerät wie jedes andere.
