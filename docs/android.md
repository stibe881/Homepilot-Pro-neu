# Die App auf einem Android-Telefon

Dieselbe Quelle wird zu drei Programmen – iPhone/iPad, Android, Browser
(siehe [plattformen.md](plattformen.md)). Ausgeliefert wurde bisher nur
iOS; Android war «grundsätzlich möglich, nie gebaut». Diese Seite hält
fest, was schon bereitliegt, was der erste Build braucht und was auf
Android anders bleibt.

## Was schon bereitliegt

Mehr, als man denkt – die Vorarbeit ist über die Jahre nebenher
passiert:

- **`app/app.json`** trägt den `android`-Block komplett: Paketname
  `ch.stibe.homepilot`, `versionCode`, das adaptive Symbol in allen vier
  Fassungen (Vordergrund, Hintergrund, einfarbig, Pink-Variante) – die
  Bilddateien liegen in `app/assets/`.
- **Benachrichtigungskanäle** (`app/src/lib/kanaele.ts`): Ab Android 8
  entscheidet der Kanal, was unterbrechen darf. Die zwei Kanäle
  «Sofort» und «Kann warten» sind angelegt und ihre Kennungen mit
  `KANAL_DRINGEND`/`KANAL_LEISE` in `hub/homepilot/core/push.py`
  abgestimmt – der Hub schickt die `channelId` bereits mit.
- **Ortung im Hintergrund**: Das `expo-location`-Plugin ist mit
  `isAndroidBackgroundLocationEnabled` konfiguriert, die
  Berechtigungstexte sind geschrieben.
- **`versionCode`**: `deploy/rebuild-hub.sh` stempelt ihn bei jedem
  Lauf zusammen mit der Apple-Build-Nummer (Minuten seit 1970) – er
  kann also nur wachsen, auch auf Android.
- **Fähigkeiten statt Plattformabfragen** (`app/src/lib/plattform.ts`):
  Die Bildschirme fragen `kann.widgets`, nicht `Platform.OS`. Was es
  auf Android nicht gibt, verschwindet von selbst.

## Der erste Build

Gebaut wird wie bei iOS auf den EAS-Servern; dieser Rechner stösst nur
an. Einmalig mit Rückfragen (EAS legt dabei den Android-Signierschlüssel
an und verwahrt ihn – er muss nirgends hin kopiert werden):

```bash
cd app
npx eas-cli@latest build --platform android --profile production
```

Heraus kommt eine **APK**, keine App-Bundle-Datei: `buildType: apk`
steht absichtlich im Produktionsprofil (`eas.json`). Ein App-Bundle
(`.aab`) kann nur der Play Store installieren – und dort ist die App
nicht und muss sie nicht sein. Die APK lädt man von expo.dev aufs
Telefon (Link aus dem Build teilen genügt) und installiert sie direkt;
Android fragt einmal nach der Erlaubnis für «unbekannte Apps aus dieser
Quelle».

Danach erreichen **OTA-Fassungen das Telefon von selbst**: Der
Update-Knopf im Haus veröffentlicht über `eas update --branch
production` für beide Plattformen, und die `runtimeVersion` gilt
plattformübergreifend. Ein neuer APK-Build ist – wie bei iOS – nur
nötig, wenn sich Natives ändert.

## Push braucht Firebase – einmalig einrichten

Ohne diesen Schritt läuft die App vollständig, nur Push-Nachrichten
kommen keine an: `getExpoPushTokenAsync` schlägt fehl, und die
System-Seite zeigt den Grund an (die Anmeldung meldet ihren Zustand,
statt still zu scheitern – `usePushRegistration.ts`).

Apple stellt Push-Zugang über das Entwicklerkonto, Google über ein
Firebase-Projekt. Das kann nur der Kontoinhaber anlegen:

1. [console.firebase.google.com](https://console.firebase.google.com) →
   Projekt erstellen (Name egal, Analytics aus).
2. Im Projekt eine **Android-App** hinzufügen, Paketname exakt
   `ch.stibe.homepilot`.
3. Die angebotene `google-services.json` herunterladen und als
   `app/google-services.json` ablegen. Sie steht in der `.gitignore` –
   sie gehört zum Bauen dazu, aber nie ins Repository.
4. In `app/app.json` im `android`-Block eine Zeile ergänzen:
   `"googleServicesFile": "./google-services.json"`. (Sie steht dort
   noch nicht, weil der Build sonst bei allen scheitert, die die Datei
   nicht haben.)
5. Den FCM-Dienstkonto-Schlüssel bei EAS hinterlegen:
   Firebase-Konsole → Projekteinstellungen → Dienstkonten → «Neuen
   privaten Schlüssel generieren», dann `npx eas-cli@latest
   credentials --platform android` → Google Service Account Key
   hochladen.
6. Neu bauen. Ab dann meldet sich das Telefon wie die iPhones unter
   *System → Benachrichtigungen* am Hub an – `hub/core/push.py` schickt
   an Expos Push-Dienst und unterscheidet die Plattform nicht.

## Was auf Android fehlt und fehlen darf

Die Tabelle in [plattformen.md](plattformen.md) gilt; kurz: keine
Sperrbildschirm-Widgets, keine Live-Aktivitäten, keine Watch, keine
Siri-Kurzbefehle – alles iOS-eigene Wege, und `@bacons/apple-targets`
wird auf Android schlicht ignoriert. NFC-Marken funktionieren anders
(Android liest sie ohne App im Hintergrund, der `homepilot://`-Link
öffnet die App genauso). Haptik gibt es, sie fühlt sich je nach Gerät
anders an.

## Über den Update-Knopf in die Play Console

Der Update-Knopf («Hub + App-Builds», früher «Hub + iOS-Build») stösst
seit September 2026 **beide** Builds an: iOS wie gehabt, dazu Android
über das Profil `play` (`app/eas.json`) - ein **App-Bundle** statt der
APK, denn die Play Console nimmt nur `.aab` an. `--auto-submit` reicht
es dort auf der **internen Testspur** ein (Spur ändern:
`submit.play.android.track` in `eas.json`). Wer eine Plattform einzeln
will, setzt `HOMEPILOT_ANDROID_BUILD=0` (oder `=1` ohne iOS) in
`/opt/homepilot/github-credentials.env`.

Das Profil `production` bleibt, was es war: die direkt installierbare
APK für Telefone ohne Play-Weg.

Zwei einmalige Schritte, bevor der Knopf durchläuft:

1. **Signierschlüssel**: Beim allerersten Android-Build legt EAS ihn
   nur mit Rückfragen an - einmal von Hand bauen (Befehl oben, mit
   `--profile play`), danach ist er bei EAS verwahrt.
2. **Play-Zugang fürs Einreichen**: In der Play Console unter
   *API-Zugriff* ein Dienstkonto anlegen (Rolle: Releases verwalten),
   den JSON-Schlüssel laden und bei EAS hinterlegen:
   `npx eas-cli@latest credentials --platform android` → *Google
   Service Account Key* (für Submissions). Und: Die **allererste**
   Fassung verlangt Google von Hand in der Play Console hochgeladen -
   erst danach darf ein Dienstkonto einreichen.

Die `google-services.json` (Firebase, siehe oben) fehlt in jedem
frischen Klon, weil sie in der `.gitignore` steht. Liegt sie als
`/opt/homepilot/google-services.json` auf dem Host, kopiert
`deploy/rebuild-hub.sh` sie vor dem Bauen in den Bau-Kontext - ohne
sie baut die App trotzdem, nur Push bleibt auf Android stumm.
