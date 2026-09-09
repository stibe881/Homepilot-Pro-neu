# HomePilot im Auto

Was im Auto möglich ist, entscheiden nicht wir, sondern Google und
Apple. Beide lassen nur bestimmte Arten von Apps auf den
Autobildschirm, und beide geben Vorlagen vor statt einer eigenen
Oberfläche. Das ist keine Schikane: Es ist der Grund, warum man das
Ganze während der Fahrt überhaupt bedienen darf.

Deshalb steht hier zuerst, was geht und was nicht – und erst danach,
wie es gebaut ist.

## Der Stand in einem Satz

**Android Auto: gebaut und benutzbar.** Google hat für Haussteuerungen
eine eigene Schublade (`androidx.car.app.category.IOT`), und in die
passen wir hinein. Es braucht niemandes Erlaubnis, solange die App
nicht in den Play Store soll.

**CarPlay: nicht gebaut, weil es nicht darf.** Apples Liste der
zugelassenen Arten kennt Audio, Navigation, Parken, Laden, Tanken,
Essensbestellung, Nachrichten, öffentliche Sicherheit und
«Fahraufgaben» – eine Haussteuerung ist keine davon. Ohne eine
Berechtigung von Apple erscheint die App auf keinem CarPlay-Bildschirm,
auch nicht auf dem eigenen, auch nicht über TestFlight. Der Antrag
steht unten.

## Was im Auto steht

Dieselben Knöpfe wie im Sperrbildschirm-Widget – aber nur die, die
**selbst schalten** (das ⚡ in den Widget-Einstellungen). Der Grund
steht in `app/src/lib/auto.ts`: Auf dem Telefon darf ein Knopf die App
an der richtigen Stelle öffnen; im Auto gibt es nichts zu öffnen. Der
Telefonbildschirm bleibt während der Fahrt dunkel, und der Bildschirm
im Auto kann nur, was seine Vorlagen können. Eine Kachel, die beim
Antippen nichts tut, wäre schlimmer als eine, die fehlt.

Eine zweite Liste zu pflegen wäre eine zweite Liste zum Vergessen.

## Wie es zusammenhängt

```
App (Widget-Einstellungen)
  └── lib/auto.ts          Welche Knöpfe taugen fürs Auto (rein, testbar)
       └── lib/autoablage.ts   schreibt sie in den Topf
            └── AutoAblageModule.kt   SharedPreferences «homepilot_auto»
                 └── HomePilotAutoDienst.kt   liest sie, zeichnet Kacheln,
                     schickt den Befehl an den Hub
```

Der Autodienst startet, wenn jemand das Telefon einsteckt – oft ohne
dass die App je offen war. Er kann deshalb nichts erfragen: Adresse,
Token und Knöpfe müssen schon dastehen. Dieselbe Bauart wie beim
Widget, nur ein anderer Topf.

Der Befehl geht direkt an den Hub, in einem eigenen Faden. Was dabei
herauskommt, steht danach als Titel über den Kacheln – ein Toast ist im
Auto nicht erlaubt, und stumm wäre schlimmer: Der häufigste Fall ist
«nicht im WLAN daheim», und das soll dastehen.

## Ausprobieren, ohne ins Auto zu sitzen

Google liefert einen Autobildschirm für den Rechner mit (Desktop Head
Unit):

```bash
# Einmalig: im Android Studio SDK Manager «Android Auto Desktop Head
# Unit emulator» installieren.
adb forward tcp:5277 tcp:5277
~/Library/Android/sdk/extras/google/auto/desktop-head-unit   # macOS
```

Auf dem Telefon vorher: Einstellungen → Android Auto → ganz unten
zehnmal auf die Versionsnummer tippen (Entwicklermodus), dann im
Dreipunktmenü **«Unbekannte Quellen»** einschalten und **«Head-Unit-Server
starten»**. Ohne «Unbekannte Quellen» zeigt Android Auto nur Apps aus
dem Play Store – die eigene erscheint nicht, und man sucht den Fehler
im Code.

## Der Antrag bei Apple

Ohne Berechtigung kein CarPlay. Beantragt wird sie unter
<https://developer.apple.com/contact/carplay/> mit dem
Entwickler-Konto, das die App baut. Was dort hineingehört – zum
Abschreiben:

> **App:** HomePilot (ch.stibe.homepilot)
> **Kategorie:** Driving task
>
> HomePilot steuert das eigene Zuhause. Im Auto braucht es davon genau
> drei Dinge, und alle drei betreffen die Fahrt selbst: das Garagentor
> öffnen, während man in die Einfahrt einbiegt; die Alarmanlage scharf
> schalten, nachdem man losgefahren ist; das Licht einschalten, bevor
> man ankommt.
>
> Die App zeigt dafür eine feste Kachelwand mit höchstens acht
> Knöpfen, die der Benutzer vorher am Telefon zusammenstellt. Keine
> Listen, kein Scrollen, keine Eingabe, keine Bilder, kein Video, kein
> Ton. Ein Tipp schickt genau einen Befehl an den eigenen Hub im
> Haushalt; danach steht eine Zeile Rückmeldung da.
>
> Die App wird nicht im App Store verkauft; sie läuft in einem
> Haushalt und wird über TestFlight verteilt.

Erfahrungsgemäss ist die Antwort auf so etwas oft ein Nein – eine
Haussteuerung steht nicht auf Apples Liste. Deshalb ist die iOS-Seite
bewusst **nicht** vorgebaut: Ein `UIApplicationSceneManifest` für
CarPlay in der `Info.plist` fasst den Start der ganzen App an, und
dafür ein Risiko einzugehen, solange die Berechtigung fehlt, wäre die
falsche Reihenfolge. Kommt die Zusage, ist die Arbeit klein: Die
Knopfliste liegt schon fertig da (`lib/auto.ts`), es fehlt eine
`CPTemplateApplicationScene` mit einem `CPGridTemplate` – dieselben
Kacheln, dieselben Befehle.

## Was bewusst fehlt

**Kameras.** Ein Live-Bild im fahrenden Auto ist bei beiden Herstellern
verboten, und zwar zu Recht.

**Der Hausstand** (scharf? Tor offen?). Technisch ginge er als Zeile
über den Kacheln. Er fehlt, weil er einen Abruf beim Zeichnen bräuchte
und die Kachelwand damit erst nach dem Netz dastünde. Wenn er kommt,
dann als eigener Schritt – mit einer Antwort auf die Frage, was die
Wand zeigt, solange der Hub schweigt.
