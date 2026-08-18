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
