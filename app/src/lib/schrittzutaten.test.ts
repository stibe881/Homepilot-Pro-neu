/** Welche Zutaten meint dieser Kochschritt? */
import { zutatenImSchritt } from './schrittzutaten';

const ZUTATEN = [
  { name: 'Zwiebeln', amount: 2 },
  { name: 'Kalbfleisch', amount: 600, unit: 'g' },
  { name: 'Rahm', amount: 2, unit: 'dl' },
  { name: 'Salz' },
];

describe('zutatenImSchritt', () => {
  it('findet Zutaten trotz deutscher Endungen', () => {
    // «Zwiebeln» im Rezept, «Zwiebel» im Schritt - und umgekehrt.
    const treffer = zutatenImSchritt('Die Zwiebel fein hacken', ZUTATEN);
    expect(treffer.map((z) => z.name)).toEqual(['Zwiebeln']);
    const umgekehrt = zutatenImSchritt('Zwiebeln anbraten', [{ name: 'Zwiebel' }]);
    expect(umgekehrt).toHaveLength(1);
  });

  it('mehrere Zutaten in einem Schritt', () => {
    const treffer = zutatenImSchritt('Kalbfleisch anbraten, mit Rahm ablöschen', ZUTATEN);
    expect(treffer.map((z) => z.name)).toEqual(['Kalbfleisch', 'Rahm']);
  });

  it('kurze Wörter zählen nicht - «Salz» steckt sonst in «Salzwasser» ok, aber «Ei» in «Eintopf»', () => {
    expect(zutatenImSchritt('Den Eintopf umrühren', [{ name: 'Ei' }])).toEqual([]);
  });

  it('ohne Treffer bleibt es leer', () => {
    expect(zutatenImSchritt('Backofen auf 180° vorheizen', ZUTATEN)).toEqual([]);
  });
});
