# Eigener App-Build (statt Expo Go)

Expo Go ist zum Entwickeln gedacht. Ein eigener Build macht HomePilot zur
richtigen App auf dem Homescreen – mit drei handfesten Vorteilen:

- **Echte Push-Nachrichten** (Klingel, Wächter-Alarme) auch bei
  geschlossener App – in Expo Go kommen sie nicht durch.
- Eigenes Icon und Name «HomePilot», kein Umweg über den Expo-Go-Scanner.
- Stabiler Dauerbetrieb als Wandpanel.

Der einfachste Weg ist **EAS Build** (Expos Build-Dienst, kostenloses
Kontingent reicht für den Privatgebrauch).

## Voraussetzungen

- Kostenloses Konto auf [expo.dev](https://expo.dev)
- Für die Installation auf dem iPhone: **Apple-Developer-Konto**
  (99 USD/Jahr) *oder* der Gratis-Weg über einen Development-Build mit
  7-Tage-Signatur (zum Ausprobieren okay, für den Alltag unpraktisch).
  Fürs iPad/iPhone im Dauerbetrieb lohnt sich das Developer-Konto.

## Einmalig einrichten

```bash
cd app
npm install -g eas-cli
eas login                # Expo-Konto
eas build:configure      # legt eas.json an, Projekt-ID in app.json
```

In `app/app.json` prüfen/ergänzen (Name und Bundle-ID):

```json
{
  "expo": {
    "name": "HomePilot",
    "slug": "homepilot",
    "ios": { "bundleIdentifier": "ch.stibe.homepilot" },
    "android": { "package": "ch.stibe.homepilot" }
  }
}
```

## Build fürs iPhone/iPad

```bash
eas build --platform ios --profile production
```

Beim ersten Mal fragt EAS nach dem Apple-Konto und legt Zertifikate selbst
an. Nach ~15 Minuten gibt es einen Link; die Installation läuft am
saubersten über **TestFlight** (`eas submit --platform ios`), dann bekommt
die Familie die App wie aus dem App Store und erhält Updates automatisch.

## Push-Nachrichten scharf schalten

Der Hub verschickt Pushes bereits über den Expo-Dienst. Die App meldet ihr
Push-Token selbst an, sobald sie mit dem Hub verbunden ist – sichtbar unter
System → Push-Geräte, und mit «Push testen» direkt prüfbar.

Zwei Dinge müssen dafür stimmen:

**1. Die EAS-Projekt-Kennung.** Ohne sie stellt Expo gar keinen Push-Token
aus. Einmalig im Ordner `app/`:

```bash
npx eas init
```

Das legt das Projekt in deinem Expo-Konto an und trägt die Kennung in die
`app.json` unter `extra.eas.projectId` ein. Danach die App neu starten.
Fehlt sie, sagt die Karte «Benachrichtigungen» im System-Screen genau das.

**2. Die richtige Umgebung.** Expo Go kann seit SDK 53 auf **Android** keine
Push-Nachrichten mehr empfangen (auf iOS geht es dort weiterhin). Für
Android braucht es also den eigenen Build von oben – mit ihm funktioniert es
auf beiden Systemen.

## Das Kamerabild in der Alarm-Meldung

Löst der Alarm aus, kann die Push-Nachricht das Kamerabild des betroffenen
Raums gleich im Banner zeigen – man sieht dann, was los ist, ohne die App zu
öffnen.

Dafür braucht es zwei Dinge:

**1. Eine von aussen erreichbare Adresse des Hubs.** Das Telefon zeigt die
Nachricht an, lange bevor die App läuft; es holt das Bild also selbst und
ohne Anmeldung. In der `config.yaml` des Hubs:

```yaml
push:
  public_url: https://haus.example.ch
```

Der Hub legt das Bild daraufhin unter einer zufälligen Adresse ab, die zehn
Minuten gilt und nur dieses eine Standbild hergibt – kein Zugang zur
laufenden Kamera und zu nichts sonst. Ohne diesen Eintrag geht die Nachricht
wie bisher ohne Bild raus; die Kamera öffnet sich trotzdem, wenn man die
Meldung antippt.

**2. Auf iOS die Team-ID deines Apple-Kontos.** Android zeigt das Bild ohne
weiteres Zutun. iOS lässt ein Bild nur von einer *Notification Service
Extension* anhängen – einem zweiten, winzigen Programm, das das System
zwischen dem Eintreffen der Nachricht und ihrer Anzeige laufen lässt. Die
App selbst läuft zu diesem Zeitpunkt nicht.

Dieses Ziel liegt bereits im Repo unter `app/targets/notification-image/`
und wird beim Build automatisch mitgebaut. Bundle-ID, Paketname und
EAS-Projekt-Kennung stehen in der `app.json` – sie sind keine Geheimnisse
und für jeden Build dieser App gleich. Was fehlt, ist die Team-ID zum
Signieren. Im Ordner `app/` eine Datei `.env` anlegen (Git ignoriert sie):

```
HOMEPILOT_APPLE_TEAM_ID=ABCDE12345
```

Sie steht auf <https://developer.apple.com/account> unter «Membership».

Für den EAS-Build gehört derselbe Wert zusätzlich in die `eas.json`, denn
der Build läuft auf einem fremden Rechner und sieht deine `.env` nicht:

```json
{
  "build": {
    "production": {
      "env": {
        "HOMEPILOT_APPLE_TEAM_ID": "ABCDE12345"
      }
    }
  }
}
```

Danach einmal `eas build --platform ios --profile production`. Ein
`eas update` genügt hier nicht: Das Ziel ist nativ, es braucht einen neuen
Build.

Prüfen lässt sich das Ergebnis lokal ohne Xcode mit

```bash
cd app
npx expo prebuild --platform ios --clean
grep -c NotificationImage ios/HomePilot.xcodeproj/project.pbxproj
```

Kommt dort eine Zahl grösser 0, steckt das Ziel im Projekt. Der Ordner
`ios/` wird erzeugt und ist von Git ausgenommen – er darf danach weg.

## Updates verteilen

Code-Änderungen (unsere täglichen Verbesserungen) lassen sich ohne neuen
Store-Build ausliefern:

```bash
eas update --branch production --message "Neues Familienmodul"
```

Die installierten Apps ziehen das Update beim nächsten Start. Ein voller
Neu-Build ist nur nötig, wenn neue native Pakete dazukommen.
