/**
 * Die von Expo erzeugte index.html für den iPhone-Homescreen nachrüsten.
 *
 * Warum als eigener Schritt und nicht im App-Code: Zwei der Angaben liest
 * iOS, *bevor* JavaScript läuft - beim Hinzufügen zum Homescreen und bei
 * jedem Start. Nachträglich eingefügte Meta-Tags kommen zu spät, und
 * genau daran ist der erste Versuch gescheitert: Die App lief weiter im
 * Browser-Modus, mit weissem Balken über dem dunklen Inhalt.
 *
 * Warum nicht in eine eigene HTML-Vorlage: Die index.html erzeugt Expo
 * beim Export selbst; eine Vorlage wäre beim nächsten Fassungswechsel
 * überholt. Dieses Skript ergänzt nur, was fehlt, und lässt den Rest in
 * Ruhe.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const html = join(process.argv[2] ?? 'dist', 'index.html');

// Der dunkelste Ton des Hintergrunds. Ohne theme-color malt iOS den
// Bereich hinter der Statusleiste weiss - der Balken im Screenshot.
const THEME = '#171C24';

const METAS = [
  // Ohne diese Zeile läuft die Web-App mit Browser-Leisten, und alles
  // Weitere hier ist wirkungslos.
  ['apple-mobile-web-app-capable', 'yes'],
  ['mobile-web-app-capable', 'yes'],
  // «black-translucent»: Der Inhalt reicht bis unter die Statusleiste,
  // deren Schrift wird hell. Zusammen mit dem Polster aus
  // safe-area-inset-top steht die obere Zeile dann genau darunter.
  ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
  ['theme-color', THEME],
  ['apple-mobile-web-app-title', 'HomePilot'],
];

const STYLE = `
    html, body, #root {
      height: 100%;
      /* dvh statt vh: Auf iOS meint vh die Höhe MIT eingeblendeten
         Leisten - mit vh ragt der untere Rand unter die Home-Anzeige. */
      height: 100dvh;
      margin: 0;
      background: ${THEME};
      /* Der Kern: Die Seite selbst scrollt nicht. Gescrollt wird nur
         innerhalb der App, damit obere Zeile und untere Leiste stehen
         bleiben, wo sie hingehören. */
      overflow: hidden;
      overscroll-behavior: none;
    }
    body { -webkit-text-size-adjust: 100%; }
    /* Doppeltipp auf eine Kachel soll schalten, nicht zoomen. Zoomen mit
       zwei Fingern bleibt erlaubt - wer schlecht sieht, soll es können. */
    #root { touch-action: manipulation; }
`;

if (!existsSync(html)) {
  console.error(`✗ ${html} gibt es nicht - lief der Export durch?`);
  process.exit(1);
}

let text = readFileSync(html, 'utf8');
const before = text;

// viewport ersetzen: viewport-fit=cover ist die Bedingung dafür, dass
// iOS die Masse von Kerbe und Home-Anzeige über env(safe-area-inset-*)
// überhaupt herausgibt. Ohne sie meldet es 0, und die App polstert nicht.
const viewport =
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />';
text = /<meta[^>]*name=["']viewport["'][^>]*>/i.test(text)
  ? text.replace(/<meta[^>]*name=["']viewport["'][^>]*>/i, viewport)
  : text.replace('</head>', `  ${viewport}\n</head>`);

for (const [name, content] of METAS) {
  if (new RegExp(`name=["']${name}["']`, 'i').test(text)) continue;
  text = text.replace(
    '</head>',
    `  <meta name="${name}" content="${content}" />\n</head>`
  );
}

if (!text.includes('id="homepilot-frame"')) {
  text = text.replace(
    '</head>',
    `  <style id="homepilot-frame">${STYLE}  </style>\n</head>`
  );
}

if (text === before) {
  console.log('· index.html war schon vollständig.');
} else {
  writeFileSync(html, text, 'utf8');
  console.log('✓ index.html für den Homescreen ergänzt.');
}
