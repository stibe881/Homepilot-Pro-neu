# Das App-Symbol

Quelle ist `icon.svg`. Alle PNG in diesem Ordner sind daraus erzeugt –
von Hand nachgezeichnet wird nichts, sonst laufen sie auseinander.

| Datei | Grösse | Wofür |
| --- | --- | --- |
| `icon.png` | 1024, ohne Alpha | iPhone und iPad. Apple verlangt einen deckenden Grund. |
| `favicon.png` | 256 | Browser-Tab. Expo rechnet die kleineren Grössen selbst daraus. |
| `splash-icon.png` | 1024 | Startbild. Derzeit in der `app.json` nicht eingehängt, wird aber mitgeführt. |
| `android-icon-background.png` | 512 | Nur der Verlauf. |
| `android-icon-foreground.png` | 512, mit Alpha | Nur das Haus, auf 86 % verkleinert. |
| `android-icon-monochrome.png` | 432, mit Alpha | Silhouette ohne Licht; Android färbt selbst. |

Und dasselbe Haus in Neon-Pink, als Zweitsymbol:

| Datei | Grösse | Wofür |
| --- | --- | --- |
| `icon-pink.png` | 1024, ohne Alpha | iPhone und iPad |
| `android-icon-foreground-pink.png` | 512, mit Alpha | Android; der Grund ist dort eine Farbe, kein Bild |
| `../public/favicon-pink.png` | 256 | Browser-Tab |

Warum der pinke Favicon in `public/` liegt und nicht hier: Expo nimmt aus
`assets/` nur den einen, der in der `app.json` unter `web.favicon` steht –
ein zweiter läge hier und käme nie im Web-Bau an. Den Ordner `public/`
kopiert Expo dagegen unverändert.

Ein zweites Startbild und ein zweites einfarbiges Symbol gibt es nicht:
Das Startbild sieht man eine halbe Sekunde, und Android färbt sein
Themensymbol ohnehin selbst.

Warum der Vordergrund kleiner ist: Android legt Vorder- und Hintergrund
übereinander und beschneidet aussen rund ein Sechstel – je nach Hersteller
zum Kreis, zum Squircle oder zum Quadrat. Ohne die Verkleinerung fehlten
im Kreis die Fussenden des Hauses.

## Neu erzeugen

Einen SVG-Rasterer gibt es hier nicht; gezeichnet wird im Browser, und
das ist kein Notbehelf – Chromium zeichnet genau das, was die App später
auch zeigt. Das Skript dazu steht in `scripts/symbol-bauen.mjs`:

```bash
cd app && npx --yes -p playwright node scripts/symbol-bauen.mjs
```

Playwright steht bewusst nicht in den Abhängigkeiten: `npm ci` läuft bei
jeder Prüfung, und ein Browser-Paket dafür herunterzuladen kostet jedes
Mal Minuten – für ein Werkzeug, das man einmal im Jahr braucht.

Danach anschauen, bevor man es einlagert: besonders in der runden Maske
(Browser-Tab) und einfarbig (Android-Themensymbole) – dort fällt zuerst
auf, wenn eine Form zu gross geraten ist.

## Das Symbol wechseln

Unter *Einstellungen → Konto & Verbindung → Erscheinungsbild* steht die
Wahl. Gespeichert wird sie am Gerät (neben dem Farbthema), nicht an der
Person: Ein App-Symbol ist eine Eigenschaft der Installation – wer sich
am Wandpanel anmeldet, färbt damit nicht das Telefon in der Hosentasche
um.

Im Browser tauscht die App den `<link rel="icon">` aus; auf dem Telefon
übernimmt es `expo-alternate-app-icons`. **Das Zweitsymbol muss beim
Bauen mit ins Paket** – ein neues Symbol lässt sich nicht nachladen.
Nach einer OTA-Fassung bleibt die Wahl deshalb wirkungslos, bis ein
frischer Build im TestFlight liegt.
