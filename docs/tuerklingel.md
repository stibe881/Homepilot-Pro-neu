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

## Das Vollbild in der geöffneten App

Ist die App gerade offen, kommt zusätzlich zur Push das Klingel-Vollbild:
Kamerabild gross, darunter die Knöpfe.

- **Beide Türen.** Angeboten wird jede Türe, die sich wirklich öffnen
  lässt – die Haustüre unten und die Wohnungstüre oben. Zuerst steht die
  Türe, die zur klingelnden Kamera gehört. Höchstens drei Knöpfe: Ein
  Vollbild mit sieben ist unter Zeitdruck eine Suchaufgabe.
- **Öffnen heisst öffnen.** Bei einem Nuki wird `unlatch` geschickt, nicht
  `unlock` – letzteres macht bloss den Riegel auf, und der Besuch steht
  weiter im Treppenhaus. Kann eine Türe nur entriegeln, steht das auch auf
  dem Knopf.
- **Rückfrage je Türe.** Der erste Tipp fragt «Wirklich öffnen?», der
  zweite öffnet. Die Rückfrage verfällt nach acht Sekunden von selbst –
  sonst macht der nächste beiläufige Tipp auf.
- **Es schliesst sich von selbst**, nach einer Minute. Jede Berührung des
  Bildes stellt die Zeit zurück; unten im Knopf läuft die Restzeit mit.
  Am Wandpanel bliebe sonst ein Bild der Strasse stehen, bis es jemand
  bemerkt. Gerechnet wird aus der Uhr, nicht aus gezählten Sekunden: Wer
  eine halbe Stunde später zur App zurückkommt, findet sie geschlossen
  vor.
- **Sprechen** führt in die Ring-App. Die Gegensprech-Verbindung ist
  WebRTC gegen Rings Server, und die gibt der Hersteller nicht heraus.

## Wenn keine Push kommt

**Zuerst die Zeile unter `ring` in Einstellungen → System → Integrationen
lesen.** Sie sagt neu auch den Fall, den man sonst nirgends sieht:

> *Ereigniskanal gemeldet, aber die letzten Klingeln kamen über die
> Abfrage – der Kanal ist taub.*

Das ist der unangenehmste Ausgang: Die Anmeldung ging durch, der
Push-Client meldet «läuft», und trotzdem kommt jedes Klingeln erst über
die Abfrage – also bis zu zehn Sekunden zu spät. Vorher stand daneben
«Klingeln kommt sofort an», und man suchte den Fehler überall ausser
dort. Der Hub schreibt jetzt je Klingeln mit, auf welchem Weg es kam, und
urteilt danach statt nach der Anmeldung.

Zwei Dinge dazu:

- **Der Kreispfeil daneben lädt die Integration neu**, er fragt nicht bloss
  nach. In den Sekunden danach steht dort «Ereigniskanal startet gerade».
  Das ist kein Fehler – vorher stand in diesem Moment «nicht verbunden»,
  und es sah aus, als hätte das Neuladen ihn zerstört.
- **Ist der Kanal taub**, hilft fast immer, die gespeicherte
  Push-Anmeldung wegzuwerfen; der Hub macht das nach einem schnellen
  Abriss selbst, aber nur einmal je Lauf. Ein Neustart des Hubs setzt das
  zurück.

Und die Diagnose von Hand urteilt neu ebenfalls erst nach acht Sekunden:

```
docker exec -it homepilot-hub python -m homepilot.integrations.ring \
  -c /config/config.yaml --diagnose
```

Vorher rief sie «Ereigniskanal steht», sobald die Anmeldung durch war –
und lief damit in dieselbe Falle wie der Hub.

**Einstellungen → System → Integrationen.** Dort steht bei `ring` eine
Zeile über den Ereigniskanal. Zwei Möglichkeiten:

- *«Ereigniskanal verbunden – Klingeln kommt sofort an»*: Station 1 ist in
  Ordnung, weiter bei Station 3.
- *«Ereigniskanal nicht verbunden. …»* mit gelbem Zeichen: Der Push-Weg
  steht nicht. Das Klingeln kommt trotzdem an, nur bis zu zehn Sekunden
  später – die Abfrage übernimmt. Was dahinter steckt, sagt der Satz
  daneben; die nächsten zwei Abschnitte gehen die beiden Fälle durch.

### Woran es liegt – die Diagnose

Der Ereigniskanal läuft technisch über **Googles** Push-Dienst, nicht
über Ring. Das ist Rings Wahl, und es hat eine Folge, die man nicht
erwartet: Wer Google im Heimnetz sperrt – Firewall-Regel, Pi-hole, ein
eigenes VLAN –, sperrt damit die Türklingel aus, ohne dass irgendwo
«Türklingel» steht.

Drei Adressen sind beteiligt:

| Adresse | wofür |
| --- | --- |
| `android.clients.google.com:443` | Anmeldung (GCM-Checkin) |
| `fcm.googleapis.com:443` | Registrierung (FCM) |
| `mtalk.google.com:5228` | die Dauerverbindung (MCS) |

Nachsehen, ohne auf den nächsten Anlauf zu warten:

```
docker exec homepilot-hub \
    python -m homepilot.integrations.ring -c /config/config.yaml --diagnose
```

**Im Container, nicht auf dem Host.** Dort gelten andere Netzregeln, und
wer auf dem Host misst, misst das falsche Netz – dann sieht alles offen
aus und der Hub kommt trotzdem nicht durch. Deshalb nennt die Ausgabe
zuerst, von welchem Rechner aus sie misst.

Der zweite Teil – der Anmeldeversuch – teilt sich die Push-Anmeldung mit
dem laufenden Hub; der baut seinen Kanal danach neu auf. Und er legt
bewusst **keine** neue Anmeldung an, wenn keine gespeichert ist: Genau
davon kommt `PHONE_REGISTRATION_ERROR`, und wer bei einer Störung fünfmal
die Diagnose laufen lässt, erzeugte sonst die Krankheit, die er sucht.

Zwei Ausgänge, zwei verschiedene Baustellen:

- **Ein ✗ bei einer Adresse** – das ist das eigene Netz und reparierbar.
- **Alles ✓, trotzdem `PHONE_REGISTRATION_ERROR`** – Google lehnt die
  Registrierung ab. Das passiert und geht meist von selbst wieder; der
  Hub versucht es weiter (30 s, 1 min, 5, 15, dann alle 30 min).

Wer den Weg über Google gar nicht will, setzt `events: false` in den
`ring`-Block der config.yaml: Dann ist die Abfrage der reguläre Weg, und
die Warnung im System-Bildschirm verschwindet.

### Wenn das Ring-Token abgelaufen ist

Hilft die Diagnose nicht weiter und steht dort etwas von Authentifizierung,
ist meist die Kontoanmeldung fällig:

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
