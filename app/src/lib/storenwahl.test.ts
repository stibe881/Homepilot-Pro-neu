/** Die Storen-Auswahl der Wächter-Regeln. */

import { dabei, storenSatz, umschalten } from './storenwahl';

const COVERS = [
  { id: 'c.1', name: 'Stube West' },
  { id: 'c.2', name: 'Küche' },
  { id: 'c.3', name: 'Schlafzimmer' },
];

describe('storenSatz', () => {
  it('leer heisst alle - und sagt das auch', () => {
    expect(storenSatz([], COVERS)).toBe('Alle 3 Storen.');
    expect(storenSatz([], [COVERS[0]])).toBe('Die eine Store des Hauses.');
    expect(storenSatz([], [])).toBe('Keine Storen im Haus gefunden.');
  });

  it('nennt die gewaehlten beim namen', () => {
    expect(storenSatz(['c.2'], COVERS)).toBe('Küche');
    expect(storenSatz(['c.1', 'c.2', 'c.3', 'c.x'], COVERS)).toBe(
      'Stube West, Küche, Schlafzimmer und 1 weitere'
    );
  });
});

describe('umschalten', () => {
  it('abwaehlen bei «alle» heisst: alle ausser diesem', () => {
    expect(umschalten([], 'c.2', COVERS)).toEqual(['c.1', 'c.3']);
  });

  it('der letzte haken zurueck ergibt wieder die leere liste', () => {
    // Als leer gespeichert, damit ein später dazugebauter Storen von
    // selbst mitmacht.
    expect(umschalten(['c.1', 'c.3'], 'c.2', COVERS)).toEqual([]);
  });

  it('den allerletzten haken gibt es nicht herzugeben', () => {
    // «Keine Storen» ist kein Zustand - dafür gibt es den Regelschalter.
    expect(umschalten(['c.1'], 'c.1', COVERS)).toEqual(['c.1']);
  });

  it('mittendrin wird schlicht umgeschaltet', () => {
    expect(umschalten(['c.1', 'c.2'], 'c.2', COVERS)).toEqual(['c.1']);
    expect(dabei([], 'c.9')).toBe(true);
    expect(dabei(['c.1'], 'c.2')).toBe(false);
  });
});
