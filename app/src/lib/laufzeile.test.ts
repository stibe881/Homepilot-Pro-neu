import { laufzeile } from './laufzeile';

const JETZT = 1_700_000_000_000;
const VOR_ZWEI_STUNDEN = (JETZT - 7_200_000) / 1000;

describe('laufzeile', () => {
  it('unterscheidet «nie ausgelöst» von «lief und tat nichts»', () => {
    // Der Anfang jeder Fehlersuche: Kam der Auslöser überhaupt an?
    const zeile = laufzeile(null, JETZT);
    expect(zeile.text).toBe('Noch nie ausgelöst');
    expect(zeile.ton).toBe('still');
  });

  it('sagt, wann er lief', () => {
    const zeile = laufzeile({ at: VOR_ZWEI_STUNDEN, executed: true }, JETZT);
    expect(zeile.text).toContain('Gelaufen');
    expect(zeile.ton).toBe('ok');
  });

  it('nennt beim Überspringen den Grund', () => {
    const zeile = laufzeile(
      { at: VOR_ZWEI_STUNDEN, executed: false, skipped: ['nur wenn dunkel'] },
      JETZT,
    );
    expect(zeile.text).toContain('Übersprungen');
    expect(zeile.text).toContain('nur wenn dunkel');
    expect(zeile.ton).toBe('warn');
  });

  it('verschweigt einen Fehler nicht', () => {
    const zeile = laufzeile(
      { at: VOR_ZWEI_STUNDEN, executed: true, error: 'Box nicht erreichbar' },
      JETZT,
    );
    expect(zeile.text).toContain('Fehlgeschlagen');
    expect(zeile.text).toContain('Box nicht erreichbar');
    expect(zeile.ton).toBe('warn');
  });

  it('kennzeichnet einen Testlauf', () => {
    // Eine halbe Stunde später ist sonst nicht zu unterscheiden, ob das
    // Licht wegen eines Tests anging oder von selbst.
    const zeile = laufzeile({ at: VOR_ZWEI_STUNDEN, executed: true, test: true }, JETZT);
    expect(zeile.text).toContain('(Probe)');
  });

  it('sagt beim Test, was im Alltag gestoppt hätte', () => {
    // Ein Test, der lief, obwohl der Ablauf sonst gestoppt worden wäre,
    // ist nur die halbe Auskunft.
    const zeile = laufzeile(
      { at: VOR_ZWEI_STUNDEN, executed: true, test: true, skipped: ['niemand zuhause'] },
      JETZT,
    );
    expect(zeile.text).toContain('im Alltag hätte gestoppt');
    expect(zeile.text).toContain('niemand zuhause');
  });
});
