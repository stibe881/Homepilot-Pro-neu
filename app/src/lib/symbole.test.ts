/**
 * Für keinen Begriff zwei Zeichen im Umlauf.
 *
 * Dieser Test liest die Quelldateien, nicht ihre Ausgabe – aus
 * demselben Grund wie tastaturplatz.test.ts: Von Auge findet man das
 * nie. Jedes einzelne Symbol sieht für sich in Ordnung aus; der Fehler
 * entsteht erst über fünfundvierzig Dateien hinweg, wenn «Bearbeiten»
 * hier ein Stift und dort ein Quadrat mit Stift ist. Der Bündler merkt
 * nichts, der Typprüfer auch nicht - es ist kein Fehler, es ist bloss
 * uneinheitlich.
 *
 * Er wird rot, sobald jemand ein gleichbedeutendes Zeichen einführt.
 * Das ist der Sinn: Beim nächsten Knopf soll die Frage «welches Symbol
 * denn nun» einmal beantwortet sein und nicht jedes Mal neu.
 */
import fs from 'fs';
import path from 'path';

import { GLEICHBEDEUTEND, SYMBOL, symbol } from './symbole';

const QUELLE = path.join(__dirname, '..');

/** Alle Quelldateien der App - Tests und diese Liste selbst zählen nicht. */
function dateien(ordner: string): string[] {
  return fs.readdirSync(ordner, { withFileTypes: true }).flatMap((eintrag) => {
    const voll = path.join(ordner, eintrag.name);
    if (eintrag.isDirectory()) return dateien(voll);
    if (!/\.tsx?$/.test(eintrag.name)) return [];
    if (eintrag.name.includes('.test.')) return [];
    if (eintrag.name === 'symbole.ts') return [];
    return [voll];
  });
}

/** Welche Ionicons-Namen in dieser Datei stehen (rein, testbar). */
function symboleIn(text: string): string[] {
  const treffer = text.match(/name=\{?['"]([a-z0-9-]+)['"]\}?/g) ?? [];
  return treffer.map((zeile) => zeile.replace(/.*['"]([a-z0-9-]+)['"].*/, '$1'));
}

describe('Die Symbolsprache', () => {
  it('kennt kein gleichbedeutendes Zeichen neben einem festgelegten', () => {
    const verstoesse: string[] = [];
    for (const datei of dateien(QUELLE)) {
      const text = fs.readFileSync(datei, 'utf8');
      for (const name of symboleIn(text)) {
        const begriff = GLEICHBEDEUTEND[name];
        if (!begriff) continue;
        verstoesse.push(
          `${path.relative(QUELLE, datei)}: «${name}» – für «${begriff}» gilt «${symbol(begriff)}»`
        );
      }
    }
    expect(verstoesse).toEqual([]);
  });

  it('führt jeden Begriff nur mit einem Zeichen', () => {
    // Zwei Begriffe dürfen sich kein Zeichen teilen: Sonst hiessen zwei
    // Dinge im Haus gleich, und das ist derselbe Fehler von der anderen
    // Seite.
    const zeichen = Object.values(SYMBOL);
    expect(new Set(zeichen).size).toBe(zeichen.length);
  });

  it('kennt keine Gleichbedeutung, die selbst festgelegt ist', () => {
    // Ein Zeichen, das in beiden Listen steht, wäre gleichzeitig
    // erlaubt und verboten - und der Test darüber unbrauchbar.
    const festgelegt = new Set<string>(Object.values(SYMBOL));
    const doppelt = Object.keys(GLEICHBEDEUTEND).filter((name) => festgelegt.has(name));
    expect(doppelt).toEqual([]);
  });

  it('verweist nur auf Begriffe, die es gibt', () => {
    for (const begriff of Object.values(GLEICHBEDEUTEND)) {
      expect(SYMBOL[begriff]).toBeDefined();
    }
  });
});

describe('Die Umrissregel', () => {
  it('lässt gefüllt nur, was eine Aussage macht', () => {
    // Gefüllt heisst «das gilt jetzt», Umriss heisst «das kannst du
    // tun». Ohne die Regel entscheidet sie jeder neu, und ein
    // Bildschirm sieht halb angeschaltet aus.
    const gefuelltErlaubt = new Set([
      'erledigt',
      'bestaetigt',
      'hinzufuegen',
      'entfernen',
      'schliessen',
      'leeren',
      'suchen',
      'sortieren',
      'weiter',
      'zurueck',
      'aufklappen',
      'zuklappen',
      'mehr',
      'anruf',
    ]);
    const verstoesse = Object.entries(SYMBOL)
      .filter(([begriff, name]) => !name.endsWith('-outline') && !gefuelltErlaubt.has(begriff))
      .map(([begriff, name]) => `${begriff}: ${name}`);
    expect(verstoesse).toEqual([]);
  });
});
