import { anzeigedauer, HOECHSTENS, istLang } from './meldung';

describe('anzeigedauer', () => {
  it('gibt einer langen Meldung mehr Zeit als einer kurzen', () => {
    // Der Fall aus dem Haus: Die CCU-Erklärung zum Funk-Timeout ist vier
    // Zeilen lang, und was zu prüfen ist, steht am Ende. Fünf Sekunden
    // reichten dafür nicht - man las die Hälfte, dann war sie weg.
    const kurz = anzeigedauer('Licht antwortet nicht');
    const lang = anzeigedauer(
      'Die CCU erreicht das Gerät zu Kanal 001A58A9A24256:4 nicht ' +
        '(Funk-Timeout). Der Kanal stimmt, geantwortet hat das Gerät nicht. ' +
        'Prüfen: Steckt es und ist es angelernt, stehen in der CCU noch ' +
        'Konfigurationsdaten aus, und ist der Sendespeicher frei?'
    );
    expect(lang).toBeGreaterThan(kurz);
    expect(kurz).toBeGreaterThanOrEqual(5000);
  });

  it('bleibt gedeckelt', () => {
    // Eine Einblendung, die eine halbe Minute über den Kacheln hängt,
    // ist ein Fenster, das man wegräumen muss.
    expect(anzeigedauer('x'.repeat(5000))).toBe(HOECHSTENS);
  });
});

describe('istLang', () => {
  it('erkennt, was nicht in drei Zeilen passt', () => {
    expect(istLang('Licht antwortet nicht')).toBe(false);
    expect(istLang('x'.repeat(200))).toBe(true);
    expect(istLang(null)).toBe(false);
  });
});
