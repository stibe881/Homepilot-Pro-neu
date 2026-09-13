/**
 * Die kleinste Trefffläche (Punkt 613 der Werkbank).
 *
 * Der Fall: Der Ein/Aus-Knopf war 34 Punkte gross, der Stift 32, die
 * Zeitraum-Chips im Verlauf 19 - und niemand mass die Trefffläche. Wer
 * neben den Ein/Aus-Knopf tippt, tippt auf die Kachel, und die öffnet
 * den Verlauf.
 */
import { treffer, trefferRand } from '../theme';

describe('Die kleinste Trefffläche', () => {
  it('ist Apples Mass, nicht das Minimum der WCAG', () => {
    // 24 wäre erlaubt, aber der Ein/Aus-Knopf ist die meistgedrückte
    // Fläche im Haus - und im Vorbeigehen, nicht mit ruhiger Hand.
    expect(treffer.mindest).toBe(44);
  });

  it('rechnet den Rand, der einer kleineren Fläche fehlt', () => {
    expect(trefferRand(34)).toBe(5);
    expect(trefferRand(32)).toBe(6);
    expect(trefferRand(19)).toBe(13);
  });

  it('rundet auf, statt einen halben Punkt zu verschenken', () => {
    expect(trefferRand(33)).toBe(6);
  });

  it('lässt eine grosse Fläche in Ruhe', () => {
    expect(trefferRand(44)).toBe(0);
    expect(trefferRand(58)).toBe(0);
  });
});
