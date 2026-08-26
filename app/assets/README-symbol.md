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

Warum der Vordergrund kleiner ist: Android legt Vorder- und Hintergrund
übereinander und beschneidet aussen rund ein Sechstel – je nach Hersteller
zum Kreis, zum Squircle oder zum Quadrat. Ohne die Verkleinerung fehlten
im Kreis die Fussenden des Hauses.

## Neu erzeugen

Einen SVG-Rasterer gibt es hier nicht; gezeichnet wird im Browser, und
das ist kein Notbehelf – Chromium zeichnet genau das, was die App später
auch zeigt. Das Skript dazu steht in `scripts/symbol-bauen.mjs`:

```bash
cd app && node scripts/symbol-bauen.mjs
```

Danach anschauen, bevor man es einlagert: besonders in der runden Maske
(Browser-Tab) und einfarbig (Android-Themensymbole) – dort fällt zuerst
auf, wenn eine Form zu gross geraten ist.
