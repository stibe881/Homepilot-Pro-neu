/**
 * Erzeugt alle Symbol-Dateien aus einer Quelle.
 *
 * Gezeichnet wird im Browser: einen SVG-Rasterer gibt es hier sonst
 * nicht, und Chromium ist der ehrlichste - er zeichnet genau das, was
 * die App später auch zeigt.
 */
import { chromium } from 'playwright';

// Das Haus aus einem Zug. Die Zahlen gelten für eine 1024er Fläche und
// sind so gewählt, dass der äusserste Punkt samt halber Strichbreite
// innerhalb des Kreises bleibt - sonst verlöre die runde Maske des
// Browser-Tabs die Fussenden.
const HAUS = 'M 262 754 L 262 556 L 512 328 L 762 556 L 762 754';
const STRICH = 124;
const TUERE = '<rect x="440" y="566" width="144" height="188" rx="72" fill="#FFC24B"/>';

const grund = `
  <linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1">
    <stop offset="0" stop-color="#4A85FF"/>
    <stop offset="1" stop-color="#1B45C8"/>
  </linearGradient>`;

const marke = (farbe = '#FFFFFF', licht = true) => `
  <path d="${HAUS}" fill="none" stroke="${farbe}" stroke-width="${STRICH}"
        stroke-linecap="round" stroke-linejoin="round"/>
  ${licht ? TUERE : ''}`;

/** Voll gefüllte Kachel – iOS, Web, Splash. */
const kachel = `<defs>${grund}</defs>
  <rect width="1024" height="1024" fill="url(#g)"/>${marke()}`;

/** Android legt Vorder- und Hintergrund getrennt übereinander und
 *  beschneidet aussen rund ein Sechstel. Die Marke rückt deshalb
 *  zusammen, damit von den Fussenden nichts abgeschnitten wird. */
const vordergrund = `<g transform="translate(512 512) scale(0.86) translate(-512 -512)">
  ${marke()}</g>`;
const hintergrund = `<defs>${grund}</defs><rect width="1024" height="1024" fill="url(#g)"/>`;
// Einfarbig: Android färbt selbst, nur die Deckung zählt. Ohne Licht -
// ein freischwebender Punkt ergibt in einer Silhouette keinen Sinn.
const einfarbig = `<g transform="translate(512 512) scale(0.86) translate(-512 -512)">
  ${marke('#FFFFFF', false)}</g>`;

const dateien = [
  { datei: 'icon.png', groesse: 1024, inhalt: kachel, deckend: true },
  { datei: 'favicon.png', groesse: 256, inhalt: kachel, deckend: true },
  { datei: 'splash-icon.png', groesse: 1024, inhalt: kachel, deckend: true },
  { datei: 'android-icon-background.png', groesse: 512, inhalt: hintergrund, deckend: true },
  { datei: 'android-icon-foreground.png', groesse: 512, inhalt: vordergrund, deckend: false },
  { datei: 'android-icon-monochrome.png', groesse: 432, inhalt: einfarbig, deckend: false },
];

// Ohne eigenen Pfad: Playwright findet seinen Browser selbst. In der
// Prüfumgebung liegt er unter PLAYWRIGHT_BROWSERS_PATH.
const browser = await chromium.launch();
try {
  for (const { datei, groesse, inhalt, deckend } of dateien) {
    const page = await browser.newPage({ viewport: { width: groesse, height: groesse } });
    await page.setContent(`<!doctype html><meta charset="utf-8">
      <style>html,body{margin:0;padding:0;background:transparent}</style>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"
           width="${groesse}" height="${groesse}" style="display:block">${inhalt}</svg>`);
    await page.waitForTimeout(120);
    await page.screenshot({ path: `assets/${datei}`, omitBackground: !deckend });
    await page.close();
    console.log(datei, groesse);
  }
} finally {
  await browser.close();
}
