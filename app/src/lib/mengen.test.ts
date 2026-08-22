/** «¾ TL» statt «0,75 TL» – Mengen, wie man sie in der Küche sagt. */
import { kuechenMenge } from './mengen';

describe('kuechenMenge', () => {
  it('schreibt gängige Brüche als Bruchzeichen', () => {
    expect(kuechenMenge(0.75)).toBe('¾');
    expect(kuechenMenge(0.5)).toBe('½');
    expect(kuechenMenge(1 / 3)).toBe('⅓');
    expect(kuechenMenge(1.5)).toBe('1½');
    expect(kuechenMenge(2.25)).toBe('2¼');
  });

  it('rundet grosse Mengen auf Waagen-Schritte', () => {
    expect(kuechenMenge(187.5)).toBe('190');
    expect(kuechenMenge(112)).toBe('110');
    expect(kuechenMenge(62.5)).toBe('63');
    expect(kuechenMenge(20.4)).toBe('20');
  });

  it('lässt ganze Zahlen ganz', () => {
    expect(kuechenMenge(3)).toBe('3');
    expect(kuechenMenge(250)).toBe('250');
  });

  it('fast-ganze Werte werden ganz - 2,97 Eier gibt es nicht', () => {
    expect(kuechenMenge(2.97)).toBe('3');
    expect(kuechenMenge(3.02)).toBe('3');
  });

  it('bleibt ehrlich, wenn kein Bruch nahe genug liegt', () => {
    expect(kuechenMenge(1.1)).toBe('1,1');
    expect(kuechenMenge(0.02)).toBe('0,02');
  });
});
