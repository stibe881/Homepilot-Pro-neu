import { szenenfarbe } from './szenenfarbe';

describe('szenenfarbe', () => {
  it('liest die Farbe aus dem Namen, wenn er eine nennt', () => {
    expect(szenenfarbe('Rubinrotes Leuchten').von).toBe('#E0457B');
    expect(szenenfarbe('Arktischer Polarkreis').von).toBe('#7FB2F0');
    expect(szenenfarbe('Tropendämmerung').von).toBe('#7BD88F');
  });

  it('erkennt auch Stimmungen statt Farbwörter', () => {
    // «Entspannen» ist keine Farbe und trotzdem eindeutig warm.
    expect(szenenfarbe('Entspannen').von).toBe('#FFD9A0');
    expect(szenenfarbe('Konzentrieren').von).toBe('#DCEBFF');
  });

  it('gibt derselben Szene immer dieselbe Farbe', () => {
    // Der Grund für die feste Rechnung statt eines Zufalls: Wer die
    // Szene morgen sucht, sucht sie an ihrer Farbe.
    const a = szenenfarbe('Szene 3');
    const b = szenenfarbe('Szene 3');
    expect(a).toEqual(b);
  });

  it('gibt benachbarten Namen verschiedene Farben', () => {
    const namen = ['Szene 1', 'Szene 2', 'Szene 3', 'Abend', 'Morgen'];
    const farben = new Set(namen.map((name) => szenenfarbe(name).von));
    expect(farben.size).toBeGreaterThan(1);
  });

  it('ohne Namen bleibt es ruhig', () => {
    expect(szenenfarbe('').von).toBe('#C9D3E2');
    expect(szenenfarbe('   ').von).toBe('#C9D3E2');
  });

  it('jede Farbe bringt ihre Tinte mit', () => {
    for (const name of ['Rubinrotes Leuchten', 'Entspannen', 'Alles aus', 'Szene 9']) {
      const farbe = szenenfarbe(name);
      expect(['#FFFFFF', '#1E1A1C']).toContain(farbe.tinte);
    }
  });
});
