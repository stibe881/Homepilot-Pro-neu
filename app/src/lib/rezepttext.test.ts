/** Rezept als Text teilen – mit den eingestellten Portionen. */
import { scaledAmount } from './mengen';
import { rezeptAlsText } from './rezepttext';

describe('scaledAmount', () => {
  it('rundet beim Skalieren küchentauglich (Punkt 147)', () => {
    expect(scaledAmount(1, 0.75)).toBe('¾');
    expect(scaledAmount(250, 0.75)).toBe('190');
    expect(scaledAmount(2, 0.75)).toBe('1½');
  });

  it('lässt bei Faktor 1 stehen, was erfasst wurde', () => {
    // Sonst veränderte schon das Bearbeiten-Formular die Mengen.
    expect(scaledAmount(187.5, 1)).toBe('187,5');
    expect(scaledAmount(0.75, 1)).toBe('0,75');
  });
});

describe('rezeptAlsText', () => {
  const rezept = {
    text: 'Ghackets mit Hörnli',
    servings: 4,
    ingredients: [
      { amount: 500, unit: 'g', name: 'Hackfleisch' },
      { name: 'Salz' },
    ],
    instructions: [{ text: 'Anbraten.' }, { text: 'Köcheln lassen.' }],
    source: 'von Mama',
  };

  it('schreibt Titel, Zutaten und Schritte als lesbaren Text', () => {
    const text = rezeptAlsText(rezept, 1, 4);
    expect(text).toContain('Ghackets mit Hörnli');
    expect(text).toContain('Für 4 Portionen');
    expect(text).toContain('- 500 g Hackfleisch');
    expect(text).toContain('- Salz');
    expect(text).toContain('1. Anbraten.');
    expect(text).toContain('2. Köcheln lassen.');
    expect(text).toContain('Quelle: von Mama');
  });

  it('teilt die eingestellten Portionen, nicht die des Rezepts', () => {
    const text = rezeptAlsText(rezept, 1.5, 6);
    expect(text).toContain('Für 6 Portionen');
    expect(text).toContain('- 750 g Hackfleisch');
  });
});
