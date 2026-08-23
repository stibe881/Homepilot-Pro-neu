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

In der `config.yaml`:

```yaml
  - integration: geofence
    zones:
      - id: stefan
        name: Stefan
      - id: livia
        name: Livia
```

Daraus werden die Geräte `geofence.stefan` und `geofence.livia`. Sie
zeigen `home`, `away` oder – bis zur ersten Meldung – `unknown`.

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

## Was der Hub dabei nicht tut

Er fragt das Telefon nie nach seinem Standort und speichert keine
Koordinaten – er erfährt nur «da» oder «weg», und zwar genau dann, wenn
das Telefon es meldet. Nach einem Neustart steht die Zone auf
`unknown`, bis die erste Meldung kommt; ein Ablauf, der auf «kommt an»
wartet, löst dadurch nicht versehentlich aus.

## Wenn das Telefon HomePilot nicht bekommt

Das Telefon der Grosseltern, ein Kindergerät, ein Diensthandy, auf dem
nichts installiert werden darf: Dort meldet niemand. Benutzt die Familie
ohnehin schon Life360, kann der Hub die Standorte von dort holen – siehe
`life360` in [integrationen.md](integrationen.md).

Drei Dinge, die man vorher wissen sollte:

- **Eine Quelle je Person.** Wer die App hat, bleibt bei der eigenen
  Ortung; wer bei `members` steht, meldet über Life360. Zwei Quellen auf
  dieselbe Frage widersprechen sich früher oder später – daran ist die
  WLAN-Anwesenheit gescheitert.
- **Life360 hat keine offene Schnittstelle.** Sie war 2024 für Fremde
  dicht; Home Assistant hat seine eingebaute Integration deshalb
  entfernt. Sie kann jederzeit wieder dichtmachen. Der Hub geht bei
  403/429 in wachsende Pausen bis zwanzig Minuten, statt gegen die
  Sperre anzurennen.
- **Konten mit bestätigter Telefonnummer** kommen mit E-Mail und
  Passwort nicht mehr hinein. Dann meldet man sich im Browser bei
  life360.com an und kopiert den Wert des Cookies `LIFE360_AUTH_TOKEN`
  in die `secrets.env`.

```yaml
  - integration: life360
    username: ${LIFE360_USER}
    password: ${LIFE360_PASSWORD}
    # token: ${LIFE360_TOKEN}      # statt Benutzername/Passwort
    scan_interval: 60
    members:                        # Name bei Life360 → Zone im Hub
      Oma: oma
```

Die Zone (`- id: oma`) muss oben unter `geofence` stehen; sonst schreibt
der Hub genau das ins Protokoll. Der Akkustand kommt mit und steht in der
Anwesenheits-Diagnose («Warum steht da das?»).
