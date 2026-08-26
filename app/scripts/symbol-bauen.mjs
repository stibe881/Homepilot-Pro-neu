/**
 * Erzeugt alle Symbol-Dateien aus einer Quelle – für jeden Farbweg.
 *
 * Gezeichnet wird im Browser: einen SVG-Rasterer gibt es hier sonst
 * nicht, und Chromium ist der ehrlichste – er zeichnet genau das, was
 * die App später auch zeigt.
 *
 *   cd app && npx --yes -p playwright node scripts/symbol-bauen.mjs
 *
 * Playwright steht bewusst nicht in den Abhängigkeiten: `npm ci` läuft
 * bei jeder Prüfung, und ein Browser-Paket dafür herunterzuladen kostet
 * jedes Mal Minuten - für ein Werkzeug, das man einmal im Jahr braucht.
 */

/** Playwright liegt hier nicht als Abhängigkeit, sondern wird geliehen. */
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    'Playwright fehlt. Das Skript leiht es sich:\n' +
      '  npx --yes -p playwright node scripts/symbol-bauen.mjs'
  );
  process.exit(1);
}

// Das Haus aus einem Zug. Die Zahlen gelten für eine 1024er Fläche und
// sind so gewählt, dass der äusserste Punkt samt halber Strichbreite
// innerhalb des eingeschriebenen Kreises bleibt - sonst verlöre die
// runde Maske des Browser-Tabs die Fussenden.
const HAUS = 'M 262 754 L 262 556 L 512 328 L 762 556 L 762 754';
const STRICH = 124;
const LICHT = '#FFC24B';

/** Die Farbwege. `dateiende` ist leer für den Regelfall – so heissen die
 *  Dateien des blauen weiterhin wie bisher. */
const FARBWEGE = [
  { key: 'blau', dateiende: '', oben: '#4A85FF', unten: '#1B45C8', grund: '#2F6BF6' },
  { key: 'pink', dateiende: '-pink', oben: '#FF4FC3', unten: '#B0117E', grund: '#D81B9C' },
];

const marke = (licht = true) => `
  <path d="${HAUS}" fill="none" stroke="#FFFFFF" stroke-width="${STRICH}"
        stroke-linecap="round" stroke-linejoin="round"/>
  ${licht ? `<rect x="440" y="566" width="144" height="188" rx="72" fill="${LICHT}"/>` : ''}`;

const verlauf = (weg) => `
  <linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1">
    <stop offset="0" stop-color="${weg.oben}"/>
    <stop offset="1" stop-color="${weg.unten}"/>
  </linearGradient>`;

/** Voll gefüllte Kachel – iOS, Web, Splash. */
const kachel = (weg) =>
  `<defs>${verlauf(weg)}</defs><rect width="1024" height="1024" fill="url(#g)"/>${marke()}`;

// Android legt Vorder- und Hintergrund getrennt übereinander und
// beschneidet aussen rund ein Sechstel - je nach Hersteller zum Kreis,
// zum Squircle oder zum Quadrat. Die Marke rückt deshalb zusammen,
// damit im Kreis von den Fussenden nichts abgeschnitten wird.
const ENGER = 'translate(512 512) scale(0.86) translate(-512 -512)';
const vordergrund = () => `<g transform="${ENGER}">${marke()}</g>`;
const hintergrund = (weg) =>
  `<defs>${verlauf(weg)}</defs><rect width="1024" height="1024" fill="url(#g)"/>`;
// Einfarbig: Android färbt selbst, nur die Deckung zählt. Ohne Licht -
// ein freischwebender Punkt ergibt in einer Silhouette keinen Sinn.
const einfarbig = () => `<g transform="${ENGER}">${marke(false)}</g>`;

/** Welche Dateien ein Farbweg braucht.
 *
 *  Der Zweitweg bekommt nur, was zum Wechseln nötig ist: iOS verlangt
 *  ein 1024er ohne Alpha, Android den Vordergrund plus eine Farbe (kein
 *  Bild), und das Web den Favicon. Ein zweites Startbild wäre eine
 *  Datei, die niemand ansieht.
 */
function dateienFuer(weg) {
  const e = weg.dateiende;
  const liste = [
    { ordner: 'assets', datei: `icon${e}.png`, groesse: 1024, inhalt: kachel(weg), deckend: true },
    {
      ordner: 'assets',
      datei: `android-icon-foreground${e}.png`,
      groesse: 512,
      inhalt: vordergrund(),
      deckend: false,
    },
  ];
  // Der Favicon des Zweitwegs kommt nach `public/`: Expo kopiert diesen
  // Ordner unverändert in den Web-Bau. Aus `assets/` nimmt es nur den
  // einen, der in der app.json unter `web.favicon` steht - der zweite
  // läge dort und käme nie an. Der Erstweg braucht das nicht, aus ihm
  // rechnet Expo die favicon.ico selbst.
  if (e) {
    liste.push({
      ordner: 'public',
      datei: `favicon${e}.png`,
      groesse: 256,
      inhalt: kachel(weg),
      deckend: true,
    });
  }
  if (!e) {
    liste.push(
      { ordner: 'assets', datei: `favicon${e}.png`, groesse: 256, inhalt: kachel(weg), deckend: true },
      { ordner: 'assets', datei: 'splash-icon.png', groesse: 1024, inhalt: kachel(weg), deckend: true },
      {
        ordner: 'assets',
        datei: 'android-icon-background.png',
        groesse: 512,
        inhalt: hintergrund(weg),
        deckend: true,
      },
      {
        ordner: 'assets',
        datei: 'android-icon-monochrome.png',
        groesse: 432,
        inhalt: einfarbig(),
        deckend: false,
      }
    );
  }
  return liste;
}

// Ohne eigenen Pfad: Playwright findet seinen Browser selbst.
const browser = await chromium.launch();
try {
  for (const weg of FARBWEGE) {
    for (const { ordner, datei, groesse, inhalt, deckend } of dateienFuer(weg)) {
      const page = await browser.newPage({ viewport: { width: groesse, height: groesse } });
      await page.setContent(`<!doctype html><meta charset="utf-8">
        <style>html,body{margin:0;padding:0;background:transparent}</style>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"
             width="${groesse}" height="${groesse}" style="display:block">${inhalt}</svg>`);
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${ordner}/${datei}`, omitBackground: !deckend });
      await page.close();
      console.log(`${weg.key.padEnd(5)} ${ordner}/${datei} (${groesse})`);
    }
  }
} finally {
  await browser.close();
}
