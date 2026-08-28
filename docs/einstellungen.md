# Was bleibt, wenn etwas neu startet

Die Frage dahinter ist einfach: *Muss ich nach einem Neustart oder einem
Update irgendetwas noch einmal einstellen?* Die kurze Antwort: nein –
ausser den drei Dingen weiter unten, die absichtlich am Gerät hängen.

Es gibt drei Orte, an denen etwas liegen kann, und nur einer davon ist
vergänglich.

| Ort | Was dort liegt | Überlebt Hub-Neustart | Überlebt App-Neustart | Überlebt Neuinstallation der App |
|---|---|---|---|---|
| **`homepilot-data.json`** neben der `config.yaml` | fast alles | ja | ja | ja |
| **`config.yaml`** | Integrationen, Zugangsdaten, Räume | ja | ja | ja |
| **Speicher der App** | drei Dinge, siehe unten | – | ja | **nein** |

Die Datendatei liegt auf dem Docker-Host in `./hub` und ist als
`/config` in den Container gereicht. Sie wird also weder vom
Neu-Ausrollen des Stacks noch von `rebuild-hub.sh` angefasst – beide
bauen ein neues Abbild, nicht einen neuen Ordner. Geschrieben wird über
eine temporäre Datei und `os.replace`: Ein Stromausfall mitten im
Speichern hinterlässt die alte Fassung, nie eine halbe.

## Auf dem Hub, für alle (`/api/houseprefs`)

Was das Haus prägt und darum überall gleich aussehen soll – auf dem
Wandpanel wie auf dem Telefon, bei Stefan wie bei Livia:

Kachel-Reihenfolge je Ansicht · ausgeblendete Geräte · ausgeblendete
Familien-Kacheln · gesperrte Geräte · in der Kopfzeile ungezählte Geräte ·
Face-ID-Hürde · Rückfrage vor dem Türöffnen · Widget-Knöpfe, die eigenen
Widget-Karten und ob das Widget Daten bekommt.

## Auf dem Hub, je Person (`/api/prefs`)

Was Gewohnheit ist und darum jedem selbst gehört:

eigene Favoriten und ihre Reihenfolge · Kameras nach Betrieb sortieren ·
Ansichten nach Tageszeit · Live-Karten auf dem Sperrbildschirm und welche
Arten davon · Durchsage-Box und die eigenen Sätze · **der gewählte
Anblick** (hell, dunkel, Pink, Mitternacht, Sand …) · **Reihenfolge und
Ausgeblendetes der Playlists je Musikkarte** · **welche Box ein Rezept
vorliest** · **für wie viele Portionen ein Rezept gekocht wird** ·
Lesemarke der «Was ist neu»-Karte.

Die vier fett gedruckten lagen bis zuletzt im Speicher des Telefons und
waren nach jedem neuen Build weg. Sie werden beim ersten Öffnen einmalig
übernommen – wer sie eingestellt hat, findet sie wieder vor und merkt vom
Umzug nichts.

## Auf dem Hub, in eigenen Listen

Benutzer und ihre Rechte · Abläufe samt Lauf-Verlauf · Szenen ·
Ablauf-Vorlagen · Papierkorb und frühere Fassungen · Raumzuordnung, Namen,
Gruppen und zusammengefasste Leuchten · Alarmanlage samt PIN und
Sensor-Zuordnung · Wächter-Regeln und abbestellte Nachrichten je Person ·
die Türe der Waschküche (an ihr liest der Wächter ab, ob jemand die
volle Maschine gesehen hat) ·
angemeldete Telefone für Push · Gute-Nacht-Knopf · Nachtruhe, Dämpfen,
Musik-Favoriten, Wecker und Schlummer · Radiosender · Ortungszonen und
Läden · Meldungen je Person · Wartung · alle Familienlisten (Einkauf,
Aufgaben, Ämtli, Rezepte, Kontakte, Medikamente, Notfallblatt,
Wochenplan) samt eigenem Papierkorb · Zugriffsprotokoll · Geräte-Verlauf
(eigene Datei daneben).

## Absichtlich am Gerät

Drei Dinge bleiben, wo sie sind – sie gehören zur Installation, nicht zur
Person:

- **App-Symbol.** Wer sich am Wandpanel anmeldet, soll damit nicht das
  Telefon umfärben.
- **Wandpanel-Modus** (Bildschirm an, Rückkehr zur Startseite) und die
  Anrede darauf.
- **Ortung.** Die Erlaubnis dafür gibt das Betriebssystem je
  Installation; nach einer Neuinstallation muss man sie ohnehin neu
  erteilen.

Dazu die Lesemarken der Familien-Kacheln («was ist hier neu?»): Ein
zweites Telefon derselben Person darf ruhig eine eigene Antwort haben.
Verliert man sie, sieht einmal alles neu aus – mehr nicht.

## Was einen Hub-Neustart bewusst nicht überlebt

Laufende Küchen-Timer und ausgestellte Einmal-Links für die Türe. Beides
ist ein laufender Vorgang, keine Einstellung: Ein Timer, der nach einem
Neustart weiterliefe, als wäre nichts gewesen, wäre eine Behauptung über
eine Küche, in der inzwischen jemand anders steht.

## Warum das jetzt zusammenpasst

Bis vor Kurzem ersetzte jedes Speichern den ganzen Bestand: Was die App
schickte, war danach der Stand. Das ging so lange gut, wie genau eine
Stelle schrieb. Inzwischen setzt der Anblick das Profil, die
Playlist-Reihenfolge die Musikkarte und die Vorlese-Box das Kochbuch –
und keine dieser Stellen kennt die Einstellungen der anderen.

Darum führt der Hub jetzt zusammen, statt zu ersetzen
(`core/einstellungen.py`): Genannt wird nur, was sich ändert; was nicht im
Zug steht, bleibt liegen. Das ist auch die Antwort auf zwei offene
Telefone – wer am einen den Anblick wechselt, löscht am anderen nicht die
Favoriten.

## Sicherung

`homepilot-data.json` wandert in die täglichen Sicherungen neben der Datei
(`backups/`) und, wenn eingerichtet, nach Supabase. Einmal im Monat legt
der Hub zusätzlich ein «Familienbuch» als HTML daneben – lesbar mit einem
Browser, für den Tag, an dem es den Hub nicht mehr gibt und trotzdem
jemand die Nummer der Kinderärztin sucht.
