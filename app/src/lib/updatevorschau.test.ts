import { HOECHSTENS_ZEILEN, vorschauZeilen } from './updatevorschau';

describe('vorschauZeilen', () => {
  it('zeigt die Liste seit dem laufenden Stand', () => {
    const ergebnis = vorschauZeilen({
      available: true,
      exact: true,
      commits: ['Joyn auf der Fernbedienung', 'Stopp-Knopf auf den Medienkarten'],
    });
    expect(ergebnis.art).toBe('genau');
    expect(ergebnis.zeilen).toHaveLength(2);
    expect(ergebnis.mehr).toBe(0);
  });

  it('deckelt lange Listen und zählt den Rest', () => {
    const commits = Array.from({ length: 12 }, (_, i) => `Änderung ${i + 1}`);
    const ergebnis = vorschauZeilen({ available: true, exact: true, commits });
    expect(ergebnis.zeilen).toHaveLength(HOECHSTENS_ZEILEN);
    expect(ergebnis.mehr).toBe(12 - HOECHSTENS_ZEILEN);
  });

  it('sagt «nichts Neues» nur bei der genauen Antwort', () => {
    expect(vorschauZeilen({ available: true, exact: true, commits: [] }).art).toBe(
      'nichts'
    );
    // Eine leere Näherungsliste heisst nur: GitHub gab nichts her.
    expect(vorschauZeilen({ available: true, exact: false, commits: [] }).art).toBe(
      'keine'
    );
  });

  it('fällt ohne Auskunft auf den Erklärtext zurück', () => {
    expect(vorschauZeilen(null).art).toBe('keine');
    expect(vorschauZeilen({ available: false }).art).toBe('keine');
  });

  it('lässt Zusammenführungen weg - und sagt dann ehrlich «nichts Neues»', () => {
    // Die Merge-Zeilen stammen vom Zweige-Abgleich - Buchhaltung, keine
    // Änderung. Bringt ein Update nur solche, bringt es nichts.
    const gemischt = vorschauZeilen({
      available: true,
      exact: true,
      commits: [
        "Merge remote-tracking branch 'origin/main' into claude/x",
        'Joyn auf der Fernbedienung',
      ],
    });
    expect(gemischt.zeilen).toEqual(['Joyn auf der Fernbedienung']);
    expect(
      vorschauZeilen({
        available: true,
        exact: true,
        commits: ["Merge branch 'a' into b"],
      }).art
    ).toBe('nichts');
  });

  it('kennzeichnet die Näherung', () => {
    const ergebnis = vorschauZeilen({
      available: true,
      exact: false,
      commits: ['Jüngste Änderung'],
    });
    expect(ergebnis.art).toBe('ungefaehr');
  });
});
