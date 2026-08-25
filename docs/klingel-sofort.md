# Klingeln, das wirklich sofort ankommt

## Warum es heute nicht sofort ist

Das Ring Intercom bekommt beim Klingeln ein Signal – aber nicht vom Hub
und nicht für den Hub. Es spricht mit **Rings Wolke**, und der Hub steht
daneben. Er hat zwei Möglichkeiten, davon zu erfahren:

1. **Rings Ereigniskanal.** Ring schiebt die Meldung aktiv zum Hub.
   Sofort, wenn er läuft. Für dieses Gerät läuft er nachweislich nicht:
   Der System-Bildschirm zeigt «Über den Kanal kam seit dem Start keine
   einzige Meldung». Das ist Rings Seite; die Gegensprechanlage hängt
   dort an einer anderen Adressfamilie als eine Türklingel, und was
   Ring für sie nicht schickt, kann der Hub nicht empfangen.

2. **Fragen.** Der Hub ruft Rings Wolke im Takt und schaut nach, ob
   geklingelt hat. Das tut er alle drei Sekunden (Verlauf) und alle
   fünf (aktive Meldungen). Schneller wäre möglich, aber unredlich
   gegenüber einem fremden Dienst – und es bleibt Fragen statt Wissen.

Zwischen einem Klingeln und der Nachricht liegen damit im schlechtesten
Fall etwa drei Sekunden. Das ist nicht «sofort», und mit Software allein
wird es das auch nicht.

## Der Weg, der sofort ist

Das Klingeln ist im Haus ein elektrisches Ereignis, lange bevor Ring
davon erfährt. Wer es dort abgreift, ist schneller als jede Wolke – und
unabhängig davon, ob das Internet gerade steht.

Gebraucht wird ein potenzialfreier Eingang, der am Klingelsignal hängt:

- **HomeMatic IP HmIP-FCI1** (Unterputz, ein Kanal) – passt in den
  bestehenden Bestand und meldet über die CCU, die der Hub ohnehin
  kennt.
- **Shelly Plus i4** – vier Eingänge, meldet über MQTT.
- Jeder andere Binärkontakt, den eine der eingebundenen Anbindungen
  führt.

Der Eingang wird parallel zum Signal geklemmt, das die Freisprechanlage
zum Klingeln bringt. Wie genau, hängt an der Anlage – bei einer
Wechselsprechanlage mit Klingeltaster meist an der Rufleitung, bei einem
Gong an dessen Spule. **Das gehört in die Hände eines Elektrikers**: Es
ist fremde Installation, und ein falsch geklemmter Eingang legt die
Anlage lahm.

Sobald der Kontakt als Gerät im Hub steht, ist nichts weiter zu tun: Die
eingebaute Regel «Es klingelt» hängt am Zustandswechsel und meldet ohne
Verzögerung. Der Ring-Weg darf daneben stehen bleiben – dieselbe Klingel
wird nur einmal gemeldet.

## Was das kostet

Ein Kontaktmodul liegt bei 30 bis 60 Franken, dazu die halbe Stunde
Elektriker. Dafür ist die Nachricht dann tatsächlich sofort da, und sie
kommt auch, wenn Ring gerade eine Störung hat.
