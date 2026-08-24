import { ortKennung } from './orte';

describe('ortKennung', () => {
  it('rechnet dasselbe wie der Hub', () => {
    // Die Gegenprobe zu hub/tests/test_shopping.py. Weicht eine Seite
    // ab, zeigt der Laden auf einen Ort, den es nicht gibt.
    expect(ortKennung('Coop Willisau')).toBe('coop_willisau');
    expect(ortKennung('Bäckerei Müller')).toBe('baeckerei_mueller');
    expect(ortKennung('  Migros   Sursee  ')).toBe('migros_sursee');
  });

  it('kommt mit Nichts zurecht', () => {
    expect(ortKennung('')).toBe('');
    expect(ortKennung(null)).toBe('');
    expect(ortKennung('!!!')).toBe('');
  });
});
