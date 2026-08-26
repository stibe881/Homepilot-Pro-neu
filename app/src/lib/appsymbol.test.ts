import { PINK, SYMBOLE, eintrag, faviconPfad, gueltig, label } from './appsymbol';

describe('gueltig', () => {
  it('lässt Pink durch', () => {
    expect(gueltig(PINK)).toBe(PINK);
  });

  it('macht aus allem Unbekannten das Standardsymbol', () => {
    // Der Wert kommt aus dem Speicher des Geräts. Nach einem Rückbau
    // stünde dort sonst ein Name, den iOS nicht kennt - und
    // `setAlternateAppIcon` wirft darauf.
    expect(gueltig('Gruen')).toBeNull();
    expect(gueltig(undefined)).toBeNull();
    expect(gueltig(null)).toBeNull();
    expect(gueltig(42)).toBeNull();
  });
});

describe('eintrag', () => {
  it('findet beide', () => {
    expect(eintrag(null).label).toBe('Blau');
    expect(eintrag(PINK).label).toBe('Neon-Pink');
  });

  it('fällt bei Unsinn auf den ersten zurück', () => {
    expect(eintrag('Gruen' as never)).toBe(SYMBOLE[0]);
  });
});

describe('label', () => {
  it('nennt das Symbol beim Namen', () => {
    expect(label(null)).toBe('Blau');
    expect(label(PINK)).toBe('Neon-Pink');
  });
});

describe('faviconPfad', () => {
  it('führt von der Wurzel aus', () => {
    // Ohne führenden Schrägstrich wäre er relativ zur offenen Seite.
    expect(faviconPfad(null)).toBe('/favicon.ico');
    expect(faviconPfad(PINK)).toBe('/favicon-pink.png');
  });
});
