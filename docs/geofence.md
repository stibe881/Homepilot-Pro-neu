# Geofence: Abläufe, die von Ankommen und Weggehen ausgelöst werden

Die Anwesenheit über UniFi merkt erst, dass jemand kommt, wenn das Telefon
sich ins WLAN einbucht – da steht man schon vor der Türe. Ein Geofence
meldet beim Verlassen des Quartiers, also Minuten vorher. Genau diese
Minuten braucht man, um die Heizung hochzufahren oder «alles aus»
anzubieten.

Das Telefon meldet den Wechsel selbst. Die App braucht dafür **keine**
Hintergrund-Ortungsrechte – das erledigen die Bordmittel der Systeme,
zuverlässiger und ohne Akku zu kosten.

## 1. Zonen im Hub anlegen

Nichts zu tun: **Die Zonen entstehen aus der Benutzerliste.** Wer in der
App als Benutzer angelegt ist, bekommt seine Zone von selbst – ohne
Neustart und ohne Eintrag in der `config.yaml`. Aus «Bine» wird
`geofence.bine`, aus «Stefan Gross» wird `geofence.stefan`: der Vorname,
klein geschrieben, Umlaute ausgeschrieben (`Björn` → `bjoern`).

Die Geräte zeigen `home`, `away` oder – bis zur ersten Meldung –
`unknown`.

Draussen bleiben Gäste (für die ist die Ortung in der App ohnehin aus),
geteilte Geräte wie das Wandtablet und das Systemtoken. Wird ein Benutzer
gelöscht, verschwindet seine Zone mit ihm – eine stehengebliebene Zone
auf «zuhause» hiesse sonst, dass «niemand mehr zuhause» nie wieder
eintritt.

Der Abschnitt `zones:` gibt es weiterhin, für die zwei Fälle, in denen
die Benutzerliste nicht reicht – ein abweichender Name, oder ein Telefon,
das keinem Benutzer gehört. Was dort steht, sticht:

```yaml
  - integration: geofence
    zones:
      - id: stefan
        name: Stefan (Diensthandy)
```

## 2. Auf dem iPhone: Kurzbefehle

In der App **Kurzbefehle** → *Automation* → *Neue Automation* → **Ort**:

- **Ankommen** wählen, Adresse setzen, «Sofort ausführen» einschalten.
- Als Aktion **«Inhalte von URL abrufen»**:
  - URL: `https://homepilot.deinedomain.ch/api/presence/geofence`
  - Methode: **POST**
  - Header: `Authorization` = `Bearer DEIN-TOKEN`
  - Anfragetext: **JSON** mit `event` = `enter` und `zone` = `stefan`

Dasselbe ein zweites Mal für **Verlassen** mit `event` = `leave`.

Das Token ist das der eigenen Person aus der Benutzerverwaltung. Gibt man
`zone` weg, nimmt der Hub den Namen des angemeldeten Benutzers in
Kleinbuchstaben – dann genügt ein Feld.

## 3. Auf Android

Dasselbe mit Tasker, HTTP Shortcuts oder der Home-Assistant-App: ein
POST auf dieselbe Adresse, gleicher Text.

## 4. Ablauf bauen

In der App unter **Abläufe** → neuer Ablauf → Auslöser **Ort** → Person
und «kommt an» oder «geht weg» wählen. Der Rest ist ein Ablauf wie jeder
andere.

### Was ein Neustart des Hubs bedeutet

Nichts – jedenfalls nicht mehr. Das Telefon meldet nur **Übertritte**:
Es weckt die App, wenn jemand eine Zonengrenze kreuzt. Wer zuhause
sitzt, kreuzt keine, und darum wusste der Hub nach einem Neustart oder
einem Update nicht mehr, wo die Leute sind – auf der Familienseite stand
wieder «Hat sich noch nie gemeldet», bis die Person das nächste Mal
wegging und wiederkam.

Seither merkt sich der Hub den letzten Stand je Zone (`presence_last` in
der `hub.data`) und nimmt ihn beim Start wieder auf, samt Ort, Quelle
und Akkustand. Zwei Grenzen dabei, beide mit Absicht:

- **Nichts Altes wird wiederbelebt.** Ist die gemerkte Meldung über
  zwölf Stunden alt, gilt wieder «unbekannt». Ein Hub, der eine Woche
  stand, soll nicht behaupten, jemand sei noch zuhause.
- **Die App meldet beim Öffnen einmal von selbst** – das fängt genau den
  Fall ab, den die zwölf Stunden offenlassen. Nicht während einer
  Ortungspause: Pausieren ist Pausieren.

### Das WLAN zählt nicht mit

Die Anwesenheit kommt **allein** vom Telefon. Es gab einmal eine Option
`wifi:` je Zone, mit der eine UniFi-Anmeldung die Ortsmeldung überstimmte;
die ist weg. Steht sie noch in der config.yaml, wird sie überlesen und der
Hub schreibt es beim Start ins Protokoll.

Der Grund ist im Betrieb aufgefallen: «Gerät im Netz» ist nicht «Mensch
zuhause». Das iPad hängt auch dann im WLAN, wenn alle weg sind, und ein
Telefon fällt heraus, sobald jemand im Garten sitzt. Auf der Startseite
stand darum «jemand da», während die Liste darunter niemanden führte – und
man weiss nicht, welcher der beiden Anzeigen man glauben soll.

`unifi.anyone_home` gibt es weiter, heisst in der App aber «Geräte im WLAN»
und beantwortet genau das. Für Anwesenheit ist `geofence.anyone_home`
zuständig.

### Die Sammelfrage «ist noch jemand da?»

Neben den Personen legt der Hub `geofence.anyone_home` an. Sie steht auf
«aus», sobald **alle** ausdrücklich weg sind, und auf «an», sobald eine
Person zuhause ist. Wichtig dabei: Nichtwissen zählt als «an». Ein Telefon
mit leerem Akku ist kein «niemand zuhause» – sonst fährt das Haus herunter,
während jemand darin sitzt.

Für «alles aus, wenn niemand mehr da ist» ist das der richtige Auslöser.
Ihn je Person zu bauen und zusätzlich zu prüfen, dass die anderen drei auch
weg sind, schreibt niemand von Hand richtig auf – und beim fünften
Familienmitglied stimmt es nicht mehr.

Fertig zum Anklicken gibt es das im Editor als Vorlage **«Wenn niemand mehr
zuhause ist»**: Licht aus, Saugroboter starten, eine Minute später Alarm
scharf. Die Minute ist Absicht – sonst meldet die eigene Anlage den eigenen
Saugroboter.

Zwei, die sich lohnen:

- *Wenn Stefan weggeht und niemand mehr da ist*: alles aus, Storen zu,
  Alarm scharf.
- *Wenn jemand ankommt und es dunkel ist*: Eingangslicht an.

## «Ich bin zuhause, der Hub sagt unterwegs»

Dafür gibt es zwei Ursachen, und sie sehen gleich aus.

**Die erste: Die Meldung kam nie an.** Die Ortung der App hängt daran,
dass iOS sie beim Übertreten der Grenze im Hintergrund weckt – mal
Minuten später, mal gar nicht. Sichtbar wird es daran, dass der Zustand
richtig wird, sobald man die App öffnet. Wer den Haushalt ohnehin bei
Life360 hat, stellt darauf um; siehe [Ortung über
Life360](#ortung-über-life360--auch-für-den-ganzen-haushalt) weiter
unten. Der Hub fragt dann im Takt ab, statt auf ein Wecken zu warten.

**Die zweite:** der **Hauskreis liegt am falschen Ort**. Er kam bisher aus dem
`location:`-Block der config.yaml, und wenn dort keiner stand, aus einer
Vorgabe im Quelltext. Beides ist eine Zahl, die jemand einmal eingetippt
hat – liegt sie um ein paar Kilometer daneben, ist man dauerhaft
«unterwegs», und **nichts sieht kaputt aus**.

Erkennen lässt es sich am Satz nach dem Melden:

> Gemeldet: unterwegs. Der nächste Ort (Zuhause) liegt 11.1 km entfernt.

Elf Kilometer sind keine Ungenauigkeit, sondern ein falscher Kreis.
Steht dort dagegen «Der nächste Ort (Zuhause) liegt 30 m entfernt», ist
der Kreis richtig und es war die erste Ursache.

**Die Behebung:** In der App unter **Einstellungen → Ortung** steht neben
«Jetzt melden» der Knopf **«Hier ist zuhause»**. Einmal drücken, während
man zuhause ist – der Hub übernimmt die gemessene Position als
Hausstandort. Vertippen ist dabei ausgeschlossen, und der `location:`-Block
in der config.yaml wird davon gestochen.

Zwei Dinge dazu:

- Der Knopf verlangt einen Standort, der **auf 100 Meter genau** ist. Ein
  Hausstandort, der um 200 Meter danebenliegt, wäre derselbe Fehler in
  Grün.
- Er darf nur, wer die Konfiguration ändern darf – es ist eine Einstellung
  fürs ganze Haus, nicht für eine Person.

Der gesetzte Standort liegt in den Hub-Daten, nicht in der config.yaml:
Ein Update überschreibt ihn nicht.

## Was der Hub dabei nicht tut

Er fragt das Telefon nie nach seinem Standort und speichert keine
Koordinaten – er erfährt nur «da» oder «weg», und zwar genau dann, wenn
das Telefon es meldet. Nach einem Neustart steht die Zone auf
`unknown`, bis die erste Meldung kommt; ein Ablauf, der auf «kommt an»
wartet, löst dadurch nicht versehentlich aus.

## Ortung über Life360 – auch für den ganzen Haushalt

Ursprünglich war das der Ausweg für Telefone, auf denen HomePilot nicht
läuft: das Gerät der Grosseltern, ein Kindergerät, ein Diensthandy.
Benutzt der Haushalt ohnehin Life360, ist es aber **auch für die eigenen
Telefone die verlässlichere Wahl**.

Der Grund liegt nicht am Hub. Die Ortung der App hängt daran, dass iOS
sie beim Übertreten einer Grenze im Hintergrund weckt, und das tut es
nicht zuverlässig – mal Minuten später, mal gar nicht, bis man die App
wieder öffnet. Wer heimkommt und weiter als «unterwegs» dasteht, hat
genau das erlebt. Life360 hält dafür einen eigenen Dienst am Laufen; der
Hub fragt ihn im Takt ab und ist damit nicht auf ein Wecken angewiesen.

**So stellt man um:**

1. In der `config.yaml` unter `life360` → `members` **alle** eintragen,
   auch sich selbst (`Name bei Life360: zone-im-hub`).
2. Auf jedem Telefon in der App **Einstellungen → Ortung ausschalten.**
3. Fertig – die Kurzbefehle darf man liegen lassen, sie werden ohnehin
   überhört (siehe nächster Punkt).

Drei Dinge, die man dabei wissen sollte:

- **Eine Quelle je Person – mit einer Ausnahme fürs Ankommen.** Wer bei
  `members` steht, wird von Life360 geführt; ein «weg» von anderswo wird
  überhört. Vorher gewann, wer zuletzt sprach – und wenn auf einem
  Telefon der Schalter noch stand, schob es aus dem Hintergrund ein
  «weg» nach, während Life360 «zuhause» meldete. Auf dem Schirm stand
  dann «unterwegs», während die Person in der Küche sass.

  Ein **Ankommen** darf dagegen weiterhin jeder melden – Telefon-App wie
  Kurzbefehl. Das Telefon meldet den Übertritt im Moment, in dem er
  passiert; Life360 erfährt ihn erst bei der nächsten Abfrage. Wer
  beides laufen lässt, bekommt das Beste aus beidem: das schnelle «bin
  da» vom Telefon, und Life360 als Rückgrat, das binnen einer Minute
  geraderückt, was das Telefon verschlafen hat. Ein verfrühtes «da»
  richtet nichts an – schlimmstenfalls geht das Licht an.

  Wer **nicht** bei `members` steht, meldet weiter selbst – beides
  nebeneinander ist also kein Problem.
- **Life360 hat keine offene Schnittstelle.** Sie war 2024 für Fremde
  dicht; Home Assistant hat seine eingebaute Integration deshalb
  entfernt. Sie kann jederzeit wieder dichtmachen. Der Hub geht bei
  403/429 in wachsende Pausen bis zwanzig Minuten, statt gegen die
  Sperre anzurennen.
- **Life360 kennt keine Passwörter mehr** – die Anmeldung läuft über
  einen Code per SMS oder Mail. Darum ist der `token` der Normalfall:
  im Browser bei life360.com anmelden (Code eingeben), die
  Entwicklerwerkzeuge öffnen (F12) → Reiter **Netzwerk** → eine Anfrage
  an `api-cloudfront.life360.com` anklicken → in den Anfrage-Headern den
  Wert hinter `Authorization: Bearer` kopieren. Diese lange
  Zeichenkette ist der Token; er bleibt gültig, bis man sich dort
  abmeldet.

**Die gespeicherten Orte kommen mit** – Schule, Arbeit, Grosseltern.
Der Hub holt die Orte eures Kreises einmal je Stunde ab und führt sie
als eigene Orte weiter. Das hat zwei Folgen:

- In der App steht der Name statt «unterwegs»: «Maja · Tanners Home».
- **Die Orte stehen in Abläufen zur Auswahl.** Beim Auslöser *Ort*
  wählt man Person, Richtung und Ort: «wenn Livia bei der Schule
  ankommt», «wenn Sandra die Arbeit verlässt». Erfassen muss man dafür
  nichts – was bei Life360 angelegt ist, ist hier da.

Zwei Feinheiten:

- **«Zuhause» sticht alles.** Wer im Hausradius steht, ist zuhause,
  auch wenn drüben ein Ort auf demselben Haus liegt und enger gezogen
  ist. Daran hängen Alarmanlage und Abläufe.
- **Sehr enge Orte werden aufgeweitet** (auf mindestens 60 m). Life360
  erlaubt Radien von wenigen Metern; so eng trifft keine Handy-Ortung
  zuverlässig, und der Ort meldete sich nie – ohne dass jemand wüsste,
  warum.

Die eigenen Orte des Hubs behalten dabei Vorrang: Wer im Hausradius
steht, ist «zuhause», auch wenn der Ort bei Life360 anders heisst. Sonst
hinge die Alarmanlage an einem Namen aus einer fremden App. Für Abläufe
entsteht aus «Tanners Home» die Kennung `tanners_home` – so wie `home`
und `quartier` –, und ein Ablauf kann darauf hören.

```yaml
  - integration: life360
    token: ${LIFE360_TOKEN}
    # username/password nur noch für alte Konten, die eines haben
    scan_interval: 60
    members:                        # Name bei Life360 → Zone im Hub
      Oma: oma
```

Die Zone (`- id: oma`) muss oben unter `geofence` stehen; sonst schreibt
der Hub genau das ins Protokoll. Der Akkustand kommt mit und steht in der
Anwesenheits-Diagnose («Warum steht da das?»).

## Wer kein Telefon trägt

Ein Kind ohne Telefon hat trotzdem eine Zone – sie entsteht aus der
Benutzerliste. Melden konnte sie bisher nur ein Telefon, und damit blieb
sie leer: Der Heimkomm-Ablauf lief für dieses Kind nie.

Dafür gibt es den Ablauf-Schritt **«Anwesenheit melden»**:

```yaml
  - type: presence
    zone: levin
    event: enter        # oder leave
```

Er gehört unter einen Auslöser, der die Ankunft *beweist* – ein Knopf am
Schlüsselanhänger, ein eigener Code am Türschloss, ein Fob. Dann ist die
Meldung so gut wie die eines Telefons, und `geofence.anyone_home` stimmt
wieder.

Drei Dinge, die man dabei wissen muss:

- **Die Quelle heisst `ablauf`.** In der Anwesenheits-Diagnose steht
  darum nicht der Rat «App öffnen und ‹Jetzt melden› drücken» – der
  ginge an jemanden, der keine App hat.
- **Ankommen darf jeder melden, Weggehen nur die führende Quelle.**
  Wer ein Telefon *und* einen Knopf hat, kann sich damit früher
  anmelden, aber nicht selbst abmelden: Ein Knopf, der in der
  Hosentasche gedrückt wird, soll nicht das Haus abschalten, während
  jemand darin sitzt (core/presence.py: `meldung_annehmen`).
- **Ohne neue Meldung verfällt der Stand nach zwölf Stunden** auf
  «unbekannt», und das zählt als weg. Wer kein «Ich gehe» drückt, steht
  also am nächsten Morgen wieder auf weg – für die Frage «ist Levin
  jetzt heimgekommen?» ist das richtig, für «war er heute überhaupt da?»
  ist es der Verlauf, den man liest.
