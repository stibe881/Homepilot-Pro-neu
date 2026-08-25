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
   geklingelt hat – auf zwei Arten, und die sind nicht gleich schnell:

   - **Laufende Meldungen** (`dings/active`), alle **drei Sekunden**.
     Das ist dieselbe Liste, aus der die Ring-App ihre Nachricht baut;
     sie steht in dem Moment da, in dem geklingelt wird. Der schnellste
     Weg ohne Ereigniskanal.
   - **Der Verlauf**, alle **zehn Sekunden**. Ein Protokoll: Ring
     schreibt den Eintrag, wenn das Ereignis vorbei ist, nicht wenn es
     beginnt. Für ein Klingeln, das gerade stattfindet, ist er nie der
     schnellste Weg – er ist das Netz für den Fall, dass die andere
     Abfrage etwas nicht sieht.

Zwischen einem Klingeln und der Nachricht liegen damit etwa drei bis
vier Sekunden (gemessen: Klingeln 21:34:39, beim Hub 21:34:43), dazu die
Zustellung über Expo und Apple. Das ist nicht «sofort», und mit Software
allein wird es das auch nicht.

## Der häufigste Grund, warum der Kanal schweigt

**Ring merkt sich einen Empfänger je Konto.** Die Anmeldung für Push
hängt an der Sitzung: Wer sich zuletzt angemeldet hat, bekommt die
Klingeln – alle anderen bekommen nichts mehr, ohne dass irgendwo ein
Fehler stünde.

Läuft also neben dem Hub noch etwas anderes mit demselben Ring-Konto –
eine Home-Assistant-Instanz, die noch steht; ein zweiter Hub; ein altes
Telefon, auf dem die Ring-App noch angemeldet ist –, dann zeigt Rings
Wegweiser dorthin. Der Hub meldet sich an, Ring bestätigt, und dann
kommt nie etwas: genau das Bild, das der System-Bildschirm zeigt
(«Ereigniskanal gemeldet» und «über den Kanal kam keine einzige
Meldung»).

**Abhilfe:** Das andere Programm abschalten oder dessen Ring-Anbindung
entfernen. Danach den Hub neu starten – er meldet sich dann wieder vorne
an.

Ab dieser Fassung merkt der Hub das selbst: Steht der Kanal eine halbe
Stunde, ohne dass je etwas kam, erneuert er seine Anmeldung. Das holt
die Klingel zurück, solange das andere Programm sie nicht seinerseits
wieder holt – zwei Programme mit demselben Konto bleiben ein Kampf, den
niemand gewinnt.

Ein eigenes Ring-Konto für den Hub (mit dem Gerät geteilt) löst das
dauerhaft.

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
