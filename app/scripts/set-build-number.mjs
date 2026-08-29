#!/usr/bin/env node
/**
 * Die Build-Nummer setzen, bevor EAS baut.
 *
 * Apple nimmt jede Build-Nummer genau einmal an. `autoIncrement` von EAS
 * zählt sie in der app.json hoch - und schreibt sie damit in eine Datei,
 * die bei uns aus einem frischen Klon stammt und nach dem Bau
 * weggeworfen wird. Die Erhöhung überlebte den Lauf nicht: Jeder Build
 * war wieder Nummer 2, und Apple wies ihn ab, weil es die 2 schon hatte.
 *
 * Die Nummer sind die Minuten seit 1970. Vorher war es die Anzahl
 * Commits - aus dem flachen Klon des Bau-Skripts (--depth 50) ist die
 * aber keine feste Grösse: Wie viele Commits die 50 Schritte erreichen,
 * hängt von der Verzweigungs-Topologie ab, und so folgte auf Build 928
 * ein Build 168, den TestFlight nie anbot. Die Uhr kann nur vorwärts,
 * und sie bleibt noch Jahrzehnte unter Apples Obergrenze (2^31).
 *
 * Aufruf (im Ordner app/):
 *   node scripts/set-build-number.mjs           # aus der Uhr
 *   node scripts/set-build-number.mjs 123       # von Hand
 */

import { readFileSync, writeFileSync } from 'node:fs';

const PFAD = new URL('../app.json', import.meta.url);

const ausDerUhr = () => Math.floor(Date.now() / 60000);

const gewuenscht = Number(process.argv[2]) || ausDerUhr();
if (!Number.isFinite(gewuenscht) || gewuenscht < 1) {
  console.error(
    '✗ Keine Build-Nummer zu ermitteln. Von Hand: ' +
      'node scripts/set-build-number.mjs <zahl>'
  );
  process.exit(1);
}

const roh = readFileSync(PFAD, 'utf8');
const config = JSON.parse(roh);
const vorher = config.expo?.ios?.buildNumber;

// Nie zurück: Auch eine von Hand gesetzte Zahl darf nicht hinter dem
// Startwert in der app.json liegen - eine kleinere Nummer weist Apple
// ebenso ab wie eine gleiche.
const nummer = Math.max(gewuenscht, Number(vorher) + 1 || 0);

config.expo.ios.buildNumber = String(nummer);
config.expo.android = config.expo.android ?? {};
config.expo.android.versionCode = nummer;

// Mit Zeilenumbruch am Ende und zwei Leerzeichen Einzug - so, wie die
// Datei aussieht, wenn ein Mensch sie schreibt.
writeFileSync(PFAD, `${JSON.stringify(config, null, 2)}\n`);
console.log(`→ Build-Nummer ${vorher} → ${nummer} (Version ${config.expo.version})`);
