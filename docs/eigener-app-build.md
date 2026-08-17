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

## Updates verteilen

Code-Änderungen (unsere täglichen Verbesserungen) lassen sich ohne neuen
Store-Build ausliefern:

```bash
eas update --branch production --message "Neues Familienmodul"
```

Die installierten Apps ziehen das Update beim nächsten Start. Ein voller
Neu-Build ist nur nötig, wenn neue native Pakete dazukommen.
