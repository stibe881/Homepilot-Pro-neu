/**
 * Beträge und Mengen in Listen stehen fest breit – Punkt 362.
 *
 * Punkt 296 gab der grossen Kennzahl feste Ziffernbreite; Listen mit
 * Beträgen (Gutscheine, Energie) blieben aussen vor. Ohne sie ruckt eine
 * Zeile seitwärts, sobald sich eine Ziffer ändert – «21.50» wird zu
 * «8.90» und die «2» ist schmaler als die «8». Der Test liest die
 * Quelldateien wie symbole.test.ts: Von Auge fällt eine fehlende
 * `tabular-nums`-Angabe unter Dutzenden Stildefinitionen nicht auf.
 */
import fs from 'fs';
import path from 'path';

const STELLEN: { datei: string; stile: string[] }[] = [
  {
    datei: '../screens/family/gutscheine.tsx',
    stile: ['betragGross', 'betragEinheit', 'detailZahl', 'verlaufBetrag'],
  },
  {
    datei: '../screens/EnergyScreen.tsx',
    stile: ['factValue', 'rowValue', 'rankValue'],
  },
];

/** Den Stil-Block ab seinem Namen bis zur schliessenden Klammer (rein, testbar). */
function stilBlock(text: string, name: string): string {
  const treffer = text.match(new RegExp(`\\b${name}:\\s*\\{[^}]*\\}`));
  if (!treffer) throw new Error(`Stil «${name}» nicht gefunden`);
  return treffer[0];
}

describe('Zahlen in Beträgen und Mengen stehen fest breit', () => {
  for (const { datei, stile } of STELLEN) {
    const text = fs.readFileSync(path.join(__dirname, datei), 'utf8');
    for (const name of stile) {
      it(`${datei.replace('../', '')}: ${name} nutzt tabular-nums`, () => {
        const block = stilBlock(text, name);
        // Entweder direkt angegeben oder über den gemeinsamen ZIFFERN-Stil
        // (lib/schriftart.ts) eingemischt – beides ergibt dieselbe Breite.
        expect(block.includes('tabular-nums') || block.includes('ZIFFERN')).toBe(true);
      });
    }
  }
});
