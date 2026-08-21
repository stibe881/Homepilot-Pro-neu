/**
 * Die Vorschläge im Eingabefeld der Einkaufsliste.
 *
 * Diese Regel muss mit der im Hub übereinstimmen (core/shopping.py):
 * Der Hub schickt die Liste vorgefiltert, die App filtert beim Tippen
 * weiter. Liefen die beiden auseinander, spränge der Vorschlag beim
 * ersten Buchstaben um.
 */
import { artikelVorschlaege } from './einkauf';

const BEKANNT = ['Salami', 'Milch', 'Mineralwasser', 'H-Milch', 'Bio Milch', 'Brot'];

describe('artikelVorschlaege', () => {
  it('stellt den Namensanfang vor das blosse Enthalten', () => {
    expect(artikelVorschlaege(BEKANNT, 'mi', [], 8)).toEqual([
      'Milch',
      'Mineralwasser',
      'Salami',
      'H-Milch',
      'Bio Milch',
    ]);
  });

  it('zeigt ohne Eingabe die zuletzt benutzten', () => {
    // Eingekauft wird meistens dasselbe – das ist beim leeren Feld der
    // nützlichste Anfang.
    expect(artikelVorschlaege(BEKANNT, '', [], 3)).toEqual(BEKANNT.slice(0, 3));
  });

  it('schlägt nicht vor, was schon auf der Liste steht', () => {
    // Ein Vorschlag, der einen Eintrag verdoppeln würde, ist keiner.
    expect(artikelVorschlaege(BEKANNT, 'mi', ['Milch'], 8)).not.toContain('Milch');
  });

  it('vergleicht ohne Rücksicht auf Gross- und Kleinschreibung', () => {
    expect(artikelVorschlaege(['Milch'], 'MILCH')).toEqual(['Milch']);
    expect(artikelVorschlaege(['Milch'], 'mi', ['  milch  '])).toEqual([]);
  });

  it('hält sich an die Höchstzahl', () => {
    expect(artikelVorschlaege(BEKANNT, 'mi', [], 2)).toHaveLength(2);
  });

  it('gibt nichts zurück, wenn nichts passt', () => {
    expect(artikelVorschlaege(BEKANNT, 'xyz')).toEqual([]);
    expect(artikelVorschlaege([], 'milch')).toEqual([]);
  });
});
