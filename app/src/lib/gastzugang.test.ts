import { ablaufDatum, ablaufSatz } from './gastzugang';

describe('Der spontane Gast-Zugang', () => {
  // Abends um Viertel nach zehn: Genau dann sitzt der Besuch auf dem
  // Sofa - und genau dann wäre das UTC-Datum schon das morgige.
  const abend = new Date(2026, 8, 5, 22, 15);

  it('«nur heute» endet heute, nicht morgen', () => {
    // Der Hub sperrt erst, wenn das heutige Datum NACH expires liegt -
    // der Zugang «2026-09-05» gilt also den ganzen Abend und ist am
    // Morgen danach zu.
    expect(ablaufDatum('heute', abend)).toBe('2026-09-05');
  });

  it('zählt Kalendertage, auch über den Monatswechsel', () => {
    expect(ablaufDatum('morgen', abend)).toBe('2026-09-06');
    expect(ablaufDatum('woche', new Date(2026, 8, 28, 9, 0))).toBe('2026-10-05');
  });

  it('«ohne Ablauf» heisst kein Datum', () => {
    expect(ablaufDatum('offen', abend)).toBeNull();
  });

  it('sagt dem Gast, wie lange es gilt', () => {
    expect(ablaufSatz('2026-09-06')).toBe(
      'Der Zugang endet am 6.9. um Mitternacht von selbst.'
    );
    expect(ablaufSatz(null)).toContain('läuft nicht ab');
  });
});
