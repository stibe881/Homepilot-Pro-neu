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
 * Die Anzahl Commits ist die Nummer, die es braucht: monoton steigend,
 * ohne dass sich jemand etwas merken muss, und aus dem Repo ablesbar
 * statt in ihm gespeichert. Wer zwischen zwei Builds nichts committet,
 * baut auch nichts Neues.
 *
 * Aufruf (im Ordner app/):
 *   node scripts/set-build-number.mjs           # aus der Commit-Anzahl
 *   node scripts/set-build-number.mjs 123       # von Hand
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const PFAD = new URL('../app.json', import.meta.url);

function ausDerGeschichte() {
  try {
    return Number(execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim());
  } catch {
    return NaN;
  }
}

const gewuenscht = Number(process.argv[2]) || ausDerGeschichte();
if (!Number.isFinite(gewuenscht) || gewuenscht < 1) {
  console.error(
    '✗ Keine Build-Nummer zu ermitteln (kein git?). Von Hand: ' +
      'node scripts/set-build-number.mjs <zahl>'
  );
  process.exit(1);
}

const roh = readFileSync(PFAD, 'utf8');
const config = JSON.parse(roh);
const vorher = config.expo?.ios?.buildNumber;

// Nie zurück: Läuft der Bau einmal aus einem flachen Klon, ist die
// Commit-Anzahl kleiner als die echte - und eine kleinere Nummer weist
// Apple ebenso ab wie eine gleiche.
const nummer = Math.max(gewuenscht, Number(vorher) + 1 || 0);

config.expo.ios.buildNumber = String(nummer);
config.expo.android = config.expo.android ?? {};
config.expo.android.versionCode = nummer;

// Mit Zeilenumbruch am Ende und zwei Leerzeichen Einzug - so, wie die
// Datei aussieht, wenn ein Mensch sie schreibt.
writeFileSync(PFAD, `${JSON.stringify(config, null, 2)}\n`);
console.log(`→ Build-Nummer ${vorher} → ${nummer} (Version ${config.expo.version})`);
