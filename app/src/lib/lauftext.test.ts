/** Was nicht auf die Zeile passt, wandert einmal durch. */
import {
  HALT_ENDE,
  HALT_START,
  SCHWELLE,
  TEMPO,
  WANDER_MIN,
  laufPlan,
  umlaufMs,
} from './lauftext';

describe('laufPlan', () => {
  it('lässt stehen, was passt', () => {
    expect(laufPlan(120, 300).noetig).toBe(false);
    expect(laufPlan(300, 300).noetig).toBe(false);
  });

  it('behauptet nichts, solange nichts gemessen ist', () => {
    // Beim ersten Zeichnen ist beides 0. Ein Lauftext, der da schon
    // losläuft, springt beim ersten Bild.
    expect(laufPlan(0, 0).noetig).toBe(false);
    expect(laufPlan(400, 0).noetig).toBe(false);
    expect(laufPlan(Number.NaN, 300).noetig).toBe(false);
  });

  it('wackelt nicht wegen ein paar Punkten', () => {
    // Um ein Haar zu lang: Da kosten die drei Pünktchen weniger als
    // die Bewegung.
    expect(laufPlan(300 + SCHWELLE, 300).noetig).toBe(false);
    expect(laufPlan(300 + SCHWELLE + 1, 300).noetig).toBe(true);
  });

  it('wandert genau um den Überhang', () => {
    // Nicht um die ganze Textbreite: Am Ende soll der Schluss am
    // rechten Rand stehen und nicht darüber hinaus.
    const plan = laufPlan(500, 300);
    expect(plan.weite).toBe(200);
  });

  it('nimmt sich für lange Zeilen mehr Zeit', () => {
    // Gleiches Lesetempo, egal wie lang - eine feste Dauer hiesse, dass
    // ein doppelt so langer Text doppelt so schnell vorbeizieht.
    expect(laufPlan(300 + TEMPO, 300).wanderMs).toBe(1000);
    expect(laufPlan(300 + 2 * TEMPO, 300).wanderMs).toBe(2000);
  });

  it('zuckt bei kurzem Überhang nicht', () => {
    expect(laufPlan(310, 300).wanderMs).toBe(WANDER_MIN);
  });
});

describe('umlaufMs', () => {
  it('zählt Warten, Wandern und Warten zusammen', () => {
    const plan = laufPlan(300 + 2 * TEMPO, 300);
    expect(umlaufMs(plan)).toBe(HALT_START + 2000 + HALT_ENDE);
    expect(umlaufMs(laufPlan(100, 300))).toBe(0);
  });
});
