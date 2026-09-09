import { gruppeVon, gruppiereZugaenge } from './benutzergruppen';

describe('gruppeVon', () => {
  it('stellt das Wandtablet zu den Geräten, nicht zu den Bewohnern', () => {
    // Es ist als Bewohner angelegt, damit es das Haus bedienen darf -
    // ein Mensch wird es dadurch nicht.
    expect(gruppeVon({ name: 'Flur', role: 'bewohner', shared: true })).toBe('geraete');
  });

  it('trennt Kinder und Gäste vom Haushalt', () => {
    expect(gruppeVon({ name: 'Finja', role: 'kind' })).toBe('kinder');
    expect(gruppeVon({ name: 'Babysitter', role: 'gast' })).toBe('gaeste');
    expect(gruppeVon({ name: 'Stefan', role: 'besitzer' })).toBe('haushalt');
    expect(gruppeVon({ name: 'Bine', role: 'bewohner' })).toBe('haushalt');
  });
});

describe('gruppiereZugaenge', () => {
  const leute = [
    { name: 'Zoe', role: 'gast' },
    { name: 'Stefan', role: 'besitzer' },
    { name: 'Flur', role: 'bewohner', shared: true },
    { name: 'Anna', role: 'gast', enabled: false },
    { name: 'Finja', role: 'kind' },
  ];

  it('gibt die Gruppen in der Reihenfolge des Hauses zurück', () => {
    expect(gruppiereZugaenge(leute).map((gruppe) => gruppe.key)).toEqual([
      'haushalt',
      'kinder',
      'gaeste',
      'geraete',
    ]);
  });

  it('stellt gesperrte Zugänge ans Ende ihrer Gruppe', () => {
    // «Anna» käme alphabetisch zuerst - sie kommt aber gerade gar nicht
    // herein, und die Liste liest man nach denen, die es tun.
    const gaeste = gruppiereZugaenge(leute).find((gruppe) => gruppe.key === 'gaeste');
    expect(gaeste?.eintraege.map((eintrag) => eintrag.name)).toEqual(['Zoe', 'Anna']);
  });

  it('lässt leere Gruppen weg', () => {
    // Ein Haushalt ohne Kinder soll keine leere Überschrift «Kinder»
    // sehen - eine Gruppe, die nichts enthält, ist nur Weg.
    const keys = gruppiereZugaenge([{ name: 'Stefan', role: 'besitzer' }]).map(
      (gruppe) => gruppe.key
    );
    expect(keys).toEqual(['haushalt']);
  });
});
