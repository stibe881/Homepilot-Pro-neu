import { HALBWERT_MS, merken, reihenfolge, verblasst } from './raumnutzung';

const JETZT = 1_800_000_000_000;

test('der meistbediente Raum steht zuoberst', () => {
  let zaehler = {};
  zaehler = merken(zaehler, 'Küche', JETZT);
  zaehler = merken(zaehler, 'Küche', JETZT);
  zaehler = merken(zaehler, 'Bad', JETZT);
  expect(reihenfolge(['Bad', 'Wohnzimmer', 'Küche'], zaehler, JETZT)).toEqual([
    'Küche',
    'Bad',
    'Wohnzimmer',
  ]);
});

test('bei Gleichstand tauscht niemand die Plätze', () => {
  expect(reihenfolge(['A', 'B', 'C'], {}, JETZT)).toEqual(['A', 'B', 'C']);
});

test('die Zählung verblasst – das Besuchswochenende regiert nicht monatelang', () => {
  const gast = merken(merken({}, 'Gästezimmer', JETZT - 6 * HALBWERT_MS), 'Küche', JETZT);
  // Zweimal Gästezimmer vor drei Monaten verliert gegen einmal Küche heute.
  const alt = merken(gast, 'Gästezimmer', JETZT - 6 * HALBWERT_MS);
  expect(reihenfolge(['Gästezimmer', 'Küche'], alt, JETZT)[0]).toBe('Küche');
  expect(verblasst({ wert: 8, at: JETZT - HALBWERT_MS }, JETZT)).toBeCloseTo(4);
});

test('ein kaputter Eintrag zählt null statt zu werfen', () => {
  expect(verblasst({ wert: Number.NaN, at: 0 }, JETZT)).toBe(0);
  expect(verblasst(undefined, JETZT)).toBe(0);
});
