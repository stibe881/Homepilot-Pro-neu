/**
 * Das Tagesgericht auf der Startseite (Punkt 587): Das Abendessen stand
 * im Wochenplan und nirgends sonst.
 */
import { planTag, tagesgericht, tagesgerichtZeile } from './tagesgericht';

// Dienstag, 8. September 2026.
const NACHMITTAG = new Date(2026, 8, 8, 17, 0);
const MORGEN = new Date(2026, 8, 8, 9, 0);
const PLAN = [
  { day: 'Montag', text: 'Reis' },
  { day: 'Dienstag', text: 'Lasagne', recipe_id: 'r1' },
  { day: 'Mittwoch', text: '' },
];

describe('tagesgericht', () => {
  it('kennt den Tag des Essensplans', () => {
    expect(planTag(NACHMITTAG)).toBe('Dienstag');
    expect(planTag(new Date(2026, 8, 13, 12, 0))).toBe('Sonntag');
  });

  it('findet den heutigen Eintrag samt Rezept', () => {
    expect(tagesgericht(PLAN, NACHMITTAG)).toEqual({ text: 'Lasagne', recipeId: 'r1' });
    // Leerer Text ist kein Plan.
    expect(tagesgericht(PLAN, new Date(2026, 8, 9, 17, 0))).toBeNull();
    expect(tagesgericht(null, NACHMITTAG)).toBeNull();
  });

  it('steht erst ab 15 Uhr auf der Startseite', () => {
    // Am Morgen ist das Abendessen keine Frage - eine Zeile, die immer
    // da ist, liest bald niemand mehr.
    expect(tagesgerichtZeile(PLAN, MORGEN)).toBeNull();
    expect(tagesgerichtZeile(PLAN, NACHMITTAG)).toBe('Heute: Lasagne');
    expect(tagesgerichtZeile([], NACHMITTAG)).toBeNull();
  });
});
