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

Der Hub verschickt Pushes bereits über den Expo-Dienst – mit dem eigenen
Build funktionieren sie automatisch, sobald sich die App einmal mit dem Hub
verbunden hat (sie meldet ihr Push-Token selbst an; sichtbar unter
System → Push-Geräte). Nichts weiter nötig.

## Updates verteilen

Code-Änderungen (unsere täglichen Verbesserungen) lassen sich ohne neuen
Store-Build ausliefern:

```bash
eas update --branch production --message "Neues Familienmodul"
```

Die installierten Apps ziehen das Update beim nächsten Start. Ein voller
Neu-Build ist nur nötig, wenn neue native Pakete dazukommen.
