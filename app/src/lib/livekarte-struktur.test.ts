/**
 * Die Live-Karte steht zweimal in Swift - und muss zweimal gleich lauten.
 *
 * `HausAktivitaetAttributes` gibt es in der App (modules/live-aktivitaet)
 * und in der Widget-Erweiterung (targets/widget). Das sind getrennte
 * Programme; Apple ordnet den Start-Push allein über den Strukturnamen
 * zu, und decodiert wird je Seite mit der eigenen Fassung.
 *
 * Gehen die beiden auseinander, merkt es niemand: Codable überliest
 * unbekannte Schlüssel stillschweigend. Ein Feld, das nur in der App
 * steht, kommt auf der Karte schlicht nie an - und man sucht den Fehler
 * im Hub.
 *
 * Geprüft wird hier und nicht im Bau: Für Swift gibt es in diesem Repo
 * keinen Übersetzer, und der EAS-Bau meldet sich erst eine
 * Viertelstunde später.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const WURZEL = join(__dirname, '..', '..');
const APP = join(WURZEL, 'modules', 'live-aktivitaet', 'ios', 'HausAktivitaetAttributes.swift');
const WIDGET = join(WURZEL, 'targets', 'widget', 'index.swift');

/** Der Quelltext einer Swift-Struktur, von ihrem Namen bis zur
 *  zugehörigen schliessenden Klammer.
 *
 *  Gezählt und nicht geraten: Die Strukturen liegen ineinander, und
 *  «bis zur nächsten schliessenden Klammer» endete schon bei der ersten
 *  inneren. */
function block(quelle: string, struktur: string, ab = 0): string {
  const anfang = quelle.indexOf(`struct ${struktur}`, ab);
  if (anfang < 0) return '';
  let tiefe = 0;
  for (let i = quelle.indexOf('{', anfang); i < quelle.length; i += 1) {
    if (quelle[i] === '{') tiefe += 1;
    if (quelle[i] === '}') {
      tiefe -= 1;
      if (tiefe === 0) return quelle.slice(anfang, i);
    }
  }
  return '';
}

/** Die Feldnamen einer Struktur **innerhalb** der Live-Karte.
 *
 *  Der Umweg über die äussere Struktur ist der Punkt: In
 *  targets/widget/index.swift steht noch eine zweite `ContentState` -
 *  die der Haustür-Karte. Ohne diese Klammer verglich der Test die
 *  Felder der Türkarte mit denen der Hauskarte und meldete
 *  Unterschiede, die keine waren. */
function felder(quelle: string, struktur: string): string[] {
  const aussen = block(quelle, 'HausAktivitaetAttributes');
  const innen = struktur === 'HausAktivitaetAttributes' ? aussen : block(aussen, struktur);
  return [...innen.matchAll(/^\s*var\s+(\w+)\s*:/gm)].map((treffer) => treffer[1]);
}

describe('HausAktivitaetAttributes', () => {
  const app = readFileSync(APP, 'utf8');
  const widget = readFileSync(WIDGET, 'utf8');

  it('führt in App und Widget dieselben Felder', () => {
    // Die Reihenfolge darf abweichen - JSON kennt keine; die Namen nicht.
    expect(felder(widget, 'ContentState').sort()).toEqual(
      felder(app, 'ContentState').sort()
    );
  });

  it('führt auch die Kreise der Fühler in beiden', () => {
    // Punkt 553: Ohne diese Struktur auf der Widget-Seite blieben die
    // Fleischfühler unsichtbar, obwohl der Hub sie schickt.
    expect(felder(widget, 'KartenWert').sort()).toEqual(
      felder(app, 'KartenWert').sort()
    );
    expect(felder(app, 'KartenWert')).toContain('nummer');
    // Punkt 570: der Anteil für den Ring - fehlt er im Widget, bleibt der
    // Ring voll, obwohl der Hub ihn schickt.
    expect(felder(widget, 'KartenWert')).toContain('anteil');
  });

  it('führt den Griff unten in beiden', () => {
    // Punkt 556: «Timer stellen» auf der Grillkarte. Fehlte die
    // Struktur im Widget, käme der Griff nie an - und der Hub schickt
    // ihn trotzdem bei jeder Karte mit.
    expect(felder(widget, 'KartenLink').sort()).toEqual(
      felder(app, 'KartenLink').sort()
    );
    expect(felder(app, 'KartenLink')).toContain('url');
  });

  it('führt die Knöpfe in beiden', () => {
    expect(felder(widget, 'KartenKnopf').sort()).toEqual(
      felder(app, 'KartenKnopf').sort()
    );
  });

  it('findet überhaupt Felder', () => {
    // Die Gegenprobe: Fände das Muster nichts, verglichen die Tests
    // oben zwei leere Listen und wären immer grün.
    expect(felder(app, 'ContentState').length).toBeGreaterThan(5);
    expect(felder(widget, 'ContentState').length).toBeGreaterThan(5);
  });
});
