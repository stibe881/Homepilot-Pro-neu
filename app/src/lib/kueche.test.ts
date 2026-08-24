/**
 * «Waschküche» ist keine Küche.
 *
 * Der Fall: Der Küchentimer stand nicht nur im Raum Küche, sondern auch
 * in der Waschküche – die Prüfung war ein Teilstring-Vergleich.
 */
import { istKueche } from './raum';

describe('istKueche', () => {
  it('erkennt die Küche, auch mit Zusatz', () => {
    expect(istKueche('Küche')).toBe(true);
    expect(istKueche('küche')).toBe(true);
    expect(istKueche('Küche oben')).toBe(true);
    expect(istKueche('Grosse Küche')).toBe(true);
    expect(istKueche('  Küche  ')).toBe(true);
  });

  it('fällt nicht auf Zusammensetzungen herein', () => {
    // Genau der gemeldete Fall.
    expect(istKueche('Waschküche')).toBe(false);
    expect(istKueche('Teeküche')).toBe(false);
    expect(istKueche('Sommerküche')).toBe(false);
  });

  it('verträgt Leeres', () => {
    expect(istKueche('')).toBe(false);
    expect(istKueche(null)).toBe(false);
    expect(istKueche(undefined)).toBe(false);
  });
});
