# HomePilot im Auto

Was im Auto möglich ist, entscheiden nicht wir, sondern Google und
Apple. Beide lassen keine eigene Oberfläche auf den Autobildschirm,
sondern nur Vorgefertigtes: bei Google Vorlagen, bei Apple ein Widget.
Das ist keine Schikane, sondern der Grund, warum man das Ganze während
der Fahrt überhaupt bedienen darf.

Deshalb steht hier zuerst, was geht und was nicht – und erst danach,
wie es gebaut ist.

## Der Stand in einem Satz

**Android Auto: gebaut und benutzbar.** Google hat für Haussteuerungen
eine eigene Schublade (`androidx.car.app.category.IOT`), und in die
passen wir hinein. Es braucht niemandes Erlaubnis, solange die App
nicht in den Play Store soll.

**CarPlay: gebaut – über das Widget, nicht über eine CarPlay-App.**
Hier steckt die Unterscheidung, an der man sich zuerst verrennt:

- Eine **eigene CarPlay-App** (ein `UIApplicationSceneManifest` mit
  `CPTemplateApplicationScene`) braucht eine Berechtigung von Apple.
  Deren Liste kennt Audio, Navigation, Parken, Laden, Tanken,
  Essensbestellung, Nachrichten, öffentliche Sicherheit und
  «Fahraufgaben» – eine Haussteuerung ist keine davon. Ohne die
  Berechtigung läuft so eine App auf keinem CarPlay-Bildschirm, auch
  nicht auf dem eigenen.
- Die **Widget-Seite in CarPlay** – seit iOS 26 – nimmt ganz normale
  WidgetKit-Widgets an, ohne Berechtigung, ohne Antrag, ohne App Store.
  Wer ein Widget hat, das `.systemSmall` kann, ist schon dort.

Deshalb ist die iOS-Seite **nicht** über eine CarPlay-App gebaut,
sondern über das Widget, das es ohnehin gibt. Dass in der alten
Haussteuerung «CarPlay einfach funktionierte, ohne einen Antrag zu
stellen», ist genau dieser Weg: Was ohne Apples Zutun im Auto landet,
sind Widgets und Siri – nicht eine App mit eigenen CarPlay-Bildschirmen.

### Android Auto ist nicht Android Automotive

Zwei Namen, die fast gleich klingen und zwei Welten meinen:

- **Android Auto** – das Telefon spiegelt auf den Bildschirm im Auto.
  Das ist HomePilot. Im Manifest steht dafür die Meta-Angabe
  `com.google.android.gms.car.application` und der `CarAppService`.
- **Android Automotive OS** – das System läuft *im* Auto, ohne Telefon.
  Dafür stünde `<uses-feature android:name="android.hardware.type.automotive">`
  im Manifest.

Beides zusammen widerspricht sich, und Google Play nimmt es nicht an:

```
The app cannot declare 'android.hardware.type.automotive' device feature
and 'com.google.android.gms.car.application' metadata at the same time.
```

Genau daran ist eine Einreichung gescheitert – die `uses-feature`-Zeile
stand im Modul, mit dem Kommentar, ohne sie erscheine die App im Auto
gar nicht. Ein Test hält das seither fest
(`app/src/lib/automanifest.test.ts`); auffallen würde es sonst erst im
Play Store, eine halbe Stunde nach dem Bau.

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
  ├── Android: lib/auto.ts   Welche Knöpfe taugen fürs Auto (rein, testbar)
  │    └── lib/autoablage.ts   schreibt sie in den Topf
  │         └── AutoAblageModule.kt   SharedPreferences «homepilot_auto»
  │              └── HomePilotAutoDienst.kt   liest sie, zeichnet Kacheln,
  │                  schickt den Befehl an den Hub
  └── iOS: lib/widget.ts     schreibt sie in die App-Gruppe
       └── targets/widget/index.swift   dasselbe Widget wie am Homescreen,
           in CarPlay als Knopfwand (KleineFassung → AutoKnopfwand)
```

Auf iOS gibt es also keine eigene Auto-Ablage: Das Widget steht schon
da, und CarPlay zeigt es. Nur die Darstellung ist eine andere.

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

## Die Widget-Seite in CarPlay

Auf dem Autobildschirm nach rechts wischen, oben rechts das Plus,
HomePilot wählen. Danach steht es dort, solange das Telefon am Auto
hängt – wie ein Widget auf dem Homescreen, nur breiter als hoch.

Gezeigt wird dieselbe kleine Grösse wie auf dem Homescreen, aber mit
einem anderen Inhalt (`app/targets/widget/index.swift`,
`KleineFassung`). Woran das Widget merkt, wo es steht:

```swift
@Environment(\.showsWidgetContainerBackground) var mitHintergrund
```

Das ist falsch, wo das System keinen Kasten hinter das Widget zeichnet –
in StandBy und in CarPlay. Dort erscheint statt Hausstand, Maschine und
einer Reihe blosser Symbole (`KleinAufHomescreen`) eine Knopfwand
(`AutoKnopfwand`): zwei mal zwei, jeder Knopf mit Beschriftung und mit
einer Fläche zum Treffen. Der Grund steht am Code – am Steuer ist
«welcher war noch der linke?» die falsche Frage, und die Trefferfläche
eines blossen Symbols sind seine Striche.

Geschaltet wird über denselben `SchaltIntent` wie auf dem Homescreen:
`Button(intent:)` statt `Link`, also ohne dass das Telefon aufwacht.
Ein Knopf ohne ⚡ bleibt ein `Link` und täte im Auto nichts – deshalb
lohnt es, fürs Auto die ersten vier auf «direkt schalten» zu stellen.

Was es dafür **nicht** braucht: keinen Antrag, keine Berechtigung, kein
`UIApplicationSceneManifest`, keine Zeile im nativen Projekt. Das Widget
gibt es seit `runtimeVersion` 5/6 ohnehin; CarPlay holt es sich selbst.

Bleibt es nach einem Update leer, ist es der übliche Verdächtige: Das
Widget liest aus der App-Gruppe, und die füllt die App beim Öffnen
(`lib/widget.ts`). Einmal HomePilot am Telefon starten genügt.

## Was bewusst fehlt

**Kameras.** Ein Live-Bild im fahrenden Auto ist bei beiden Herstellern
verboten, und zwar zu Recht.

**Der Hausstand** (scharf? Tor offen?). Technisch ginge er als Zeile
über den Kacheln. Er fehlt, weil er einen Abruf beim Zeichnen bräuchte
und die Kachelwand damit erst nach dem Netz dastünde. Wenn er kommt,
dann als eigener Schritt – mit einer Antwort auf die Frage, was die
Wand zeigt, solange der Hub schweigt.
