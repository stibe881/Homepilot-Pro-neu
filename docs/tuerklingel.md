# Türklingel: Push beim Klingeln

Was passieren soll, ist schnell gesagt: Es klingelt an der Haustüre, und
das Telefon meldet sich. Dazwischen liegen drei Stationen, und jede kann
für sich still ausfallen – deshalb steht hier, wie man sieht, welche.

## Der Weg

1. **Ring meldet das Klingeln an den Hub.** Zwei Wege: der
   Ereigniskanal (Push von Ring, sofort) und die Abfrage der aktiven
   Meldungen (alle 10–30 s). Der zweite läuft immer mit – als Netz
   darunter, falls der erste stillschweigend wegbricht.
2. **Der Hub setzt das Feld `ring` auf `on`** und schreibt den Zeitpunkt
   nach `last_ring`. Nach ein paar Minuten fällt `ring` von selbst wieder
   auf `off`.
3. **Der Ablauf löst aus** – Auslöser: Gerät «Haustüre», «klingelt» – und
   schickt die Nachricht.

## Wenn keine Push kommt

**Einstellungen → System → Integrationen.** Dort steht bei `ring` eine
Zeile über den Ereigniskanal. Zwei Möglichkeiten:

- *«Ereigniskanal verbunden – Klingeln kommt sofort an»*: Station 1 ist in
  Ordnung, weiter bei Station 3.
- *«Ereigniskanal nicht verbunden (…)»* mit gelbem Zeichen: Ring hat die
  Anmeldung für den Push-Dienst abgelehnt. Das Klingeln kommt trotzdem an,
  nur bis zu zehn Sekunden später – die Abfrage übernimmt. Der Hub
  versucht den Kanal weiter aufzubauen; hilft das über Stunden nicht, ist
  meist das Ring-Token abgelaufen:

  ```
  docker exec -it homepilot-hub python -m homepilot.integrations.ring -c /config/config.yaml
  ```

  E-Mail, Passwort und den zugeschickten Code eingeben, danach den Hub neu
  starten.

### «Ereigniskanal verbunden» – und trotzdem klingelt nichts

Es gibt einen Fall dazwischen, der genau so aussah wie alles in Ordnung:
Die Anmeldung beim Push-Dienst gelingt, und eine Sekunde später schaltet
sich der Client wegen einer beschädigten gespeicherten Anmeldung selbst
ab (`Incorrect padding` im Protokoll). Im Log stand «Ring-Ereigniskanal
verbunden», danach nie wieder etwas.

Der Hub erkennt das inzwischen selbst: Bricht der Kanal innerhalb einer
Minute nach dem Verbinden wieder ab, wirft er die gespeicherte
Push-Anmeldung weg und registriert sich neu. Von Hand geht dasselbe so –
danach den Hub neu starten:

```
docker exec homepilot-hub python -c "
import json, pathlib
p = pathlib.Path('/config/ring-token.json')
d = json.loads(p.read_text())
d.pop('listener', None)
p.write_text(json.dumps(d))
print('Push-Anmeldung entfernt')
"
```

Das betrifft nur die Push-Anmeldung, nicht die Kontoanmeldung – der
2FA-Code wird dabei nicht erneut gebraucht.

**Station 3 prüfen:** Abläufe → der betreffende Ablauf → «Verlauf». Steht
dort kein Lauf zur Klingelzeit, hat der Auslöser nicht gepasst; steht dort
ein übersprungener Lauf, war es eine Bedingung. Kam der Lauf durch und
trotzdem keine Nachricht, liegt es am Telefon – dann hilft der Push-Test
in Einstellungen → System.

## Warum zweimal klingeln früher nur einmal zählte

Das Feld `ring` steht beim Klingeln auf `on` und fällt nach Ablauf der
Meldung zurück auf `off`. Startete der Hub genau in diesen Minuten neu,
blieb `on` stehen. Beim nächsten Läuten stand dort wieder `on` – und die
Prüfung «hat sich etwas geändert?» verwarf es. Kein Fehler, keine Zeile im
Log, bloss keine Nachricht mehr.

Deshalb zählt für Klingeln und Bewegung nicht nur der Wert, sondern auch
der Zeitstempel daneben (`last_ring`, `last_motion`): Ein neuer Zeitpunkt
ist ein neues Ereignis, auch wenn der Wert derselbe bleibt. Für Wandtaster
galt das schon länger – dort meldet jeder Druck ebenfalls «kurz gedrückt».
