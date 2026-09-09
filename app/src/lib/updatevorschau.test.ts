import { vorschauZeilen } from './updatevorschau';

describe('vorschauZeilen', () => {
  it('zeigt die Liste seit dem laufenden Stand', () => {
    const ergebnis = vorschauZeilen({
      available: true,
      exact: true,
      commits: ['Joyn auf der Fernbedienung', 'Stopp-Knopf auf den Medienkarten'],
    });
    expect(ergebnis.art).toBe('genau');
    expect(ergebnis.zeilen).toHaveLength(2);
  });

  it('zählt auch lange Listen vollständig auf', () => {
    // Es gab einen Deckel von acht Zeilen und darunter «… und 4
    // weitere». Aus dem Haus kam dazu: Genau die vier will man sehen.
    const commits = Array.from({ length: 12 }, (_, i) => `Änderung ${i + 1}`);
    const ergebnis = vorschauZeilen({ available: true, exact: true, commits });
    expect(ergebnis.zeilen).toHaveLength(12);
    expect(ergebnis.zeilen[11]).toBe('Änderung 12');
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

  it('zählt ohne genauen Vergleich gar nichts auf', () => {
    // Gemeldet aus dem Haus: «momentan stehen da auch Sachen drin, die
    // bereits im letzten Update gemacht wurden.» Die Näherung zeigte
    // die neusten Commits des Zweigs - ob sie laufen oder nicht -, und
    // die Klammer daneben las niemand als Warnung. Wer vor dem Knopf
    // steht, will wissen, was *noch* kommt.
    const ergebnis = vorschauZeilen({
      available: true,
      exact: false,
      commits: ['Läuft längst', 'Läuft auch längst'],
    });
    expect(ergebnis.art).toBe('ungefaehr');
    expect(ergebnis.zeilen).toEqual([]);
  });
});
