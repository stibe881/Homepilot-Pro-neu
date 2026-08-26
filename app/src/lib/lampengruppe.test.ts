import { gruppenZeile, lampenZahl } from './lampengruppe';

describe('lampenZahl', () => {
  it('zählt in der Mehrzahl', () => {
    expect(lampenZahl({ name: 'Büro', members: ['a', 'b', 'c', 'd'] })).toBe('4 Lampen');
  });

  it('sagt im Einzelfall «1 Lampe»', () => {
    expect(lampenZahl({ name: 'Gang', members: ['a'] })).toBe('1 Lampe');
  });

  it('verträgt eine Gruppe ohne Mitglieder', () => {
    expect(lampenZahl({ name: 'Leer', members: [] })).toBe('0 Lampen');
  });
});

describe('gruppenZeile', () => {
  it('nennt nur die Zahl, wo die Spots verschwinden', () => {
    expect(gruppenZeile({ name: 'Büro', members: ['a', 'b'] })).toBe('2 Lampen');
  });

  it('sagt es, wo die Spots einzeln stehen bleiben', () => {
    // Der Unterschied zwischen «eine Deckenlampe» und «eine Deckenlampe
    // und fünf Spots» – sonst sieht man ihn erst im Raum.
    expect(
      gruppenZeile({ name: 'Büro', members: ['a', 'b'], hide_members: false })
    ).toBe('2 Lampen · einzeln sichtbar');
  });

  it('behandelt das fehlende Feld wie «verstecken»', () => {
    expect(gruppenZeile({ name: 'Büro', members: ['a'] })).toBe('1 Lampe');
    expect(gruppenZeile({ name: 'Büro', members: ['a'], hide_members: true })).toBe(
      '1 Lampe'
    );
  });
});
