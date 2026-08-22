/** «Was koche ich heute?» – die Gewichtung hinter dem Würfel-Knopf. */
import { kochVorschlaege, vorschlagsGrund } from './vorschlag';

const HEUTE = '2026-08-22';

describe('kochVorschlaege', () => {
  const rezepte = [
    { id: 'a', text: 'Lasagne', last_cooked: '2026-08-21' },
    { id: 'b', text: 'Riz Casimir', last_cooked: '2026-06-01' },
    { id: 'c', text: 'Ghackets', favorite: true, last_cooked: '2026-06-01' },
    { id: 'd', text: 'Fondue' }, // noch nie gekocht
  ];

  it('lange nicht Gekochtes und Favoriten liegen vorn', () => {
    // Ohne Zufall (immer 0) ist die Reihenfolge deterministisch. «b» und
    // «d» sind am 60-Tage-Deckel punktgleich - die stabile Sortierung
    // lässt dann die Bucheinträge in ihrer Reihenfolge stehen.
    const drei = kochVorschlaege(rezepte, 3, HEUTE, () => 0);
    expect(drei.map((r) => r.id)).toEqual(['c', 'b', 'd']);
  });

  it('gestern Gekochtes taucht zuletzt auf', () => {
    const alle = kochVorschlaege(rezepte, 4, HEUTE, () => 0);
    expect(alle[alle.length - 1].id).toBe('a');
  });

  it('liefert höchstens so viele, wie es Rezepte gibt', () => {
    expect(kochVorschlaege(rezepte, 10, HEUTE, () => 0)).toHaveLength(4);
    expect(kochVorschlaege([], 3, HEUTE, () => 0)).toEqual([]);
  });

  it('leere Titel fliegen raus', () => {
    const mitLeer = [...rezepte, { id: 'x', text: '  ' }];
    expect(kochVorschlaege(mitLeer, 10, HEUTE, () => 0)).toHaveLength(4);
  });
});

describe('vorschlagsGrund', () => {
  it('sagt, warum ein Rezept vorgeschlagen wird', () => {
    expect(vorschlagsGrund({ last_cooked: '2026-08-10' }, HEUTE)).toBe('vor 12 Tagen gekocht');
    expect(vorschlagsGrund({ last_cooked: '2026-08-21' }, HEUTE)).toBe('gestern gekocht');
    expect(vorschlagsGrund({}, HEUTE)).toBe('noch nie gekocht');
  });
});
