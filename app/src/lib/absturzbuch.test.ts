import { HOECHSTENS, absturzSatz, eintragen, nachBereich } from './absturzbuch';

const fehler = (bereich: string, at: number) => ({
  bereich,
  meldung: 'Cannot read property x of null',
  at,
});

describe('absturzbuch', () => {
  it('stellt den neuesten nach vorne und deckelt die Länge', () => {
    let buch = [] as ReturnType<typeof eintragen>;
    for (let i = 0; i < HOECHSTENS + 5; i += 1) {
      buch = eintragen(buch, fehler('Die Kameras', i));
    }
    expect(buch).toHaveLength(HOECHSTENS);
    expect(buch[0].at).toBe(HOECHSTENS + 4);
  });

  it('kürzt eine ausufernde Meldung', () => {
    const buch = eintragen([], { bereich: 'X', meldung: 'a'.repeat(500), at: 1 });
    expect(buch[0].meldung.length).toBeLessThanOrEqual(200);
  });

  it('zählt je Bereich statt zwanzig gleiche Zeilen zu zeigen', () => {
    const buch = [
      fehler('Die Kameras', 30),
      fehler('Die Kameras', 20),
      fehler('Die Musik', 10),
    ];
    expect(nachBereich(buch)).toEqual([
      { bereich: 'Die Kameras', anzahl: 2, zuletzt: 30 },
      { bereich: 'Die Musik', anzahl: 1, zuletzt: 10 },
    ]);
  });

  it('schweigt, solange nichts passiert ist', () => {
    // «0 Abstürze» ist eine Zeile, die man ab dem zweiten Mal überliest.
    expect(absturzSatz([])).toBe('');
  });

  it('nennt den Bereich, solange es nur einer ist', () => {
    expect(absturzSatz([fehler('Die Kameras', 1)])).toBe('Einmal gestolpert: Die Kameras');
    expect(absturzSatz([fehler('Die Kameras', 2), fehler('Die Kameras', 1)])).toBe(
      '2-mal gestolpert: Die Kameras'
    );
  });

  it('nennt bei mehreren den häufigsten', () => {
    const buch = [fehler('Die Kameras', 3), fehler('Die Kameras', 2), fehler('Die Musik', 1)];
    expect(absturzSatz(buch)).toBe('3-mal gestolpert, am häufigsten: Die Kameras');
  });
});
