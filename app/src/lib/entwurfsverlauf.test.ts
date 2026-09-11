/**
 * Der Zurück-Stapel des Editors (Punkt 467).
 *
 * Der Fall: zwölf Schritte umgestellt, dann doch anders gewollt.
 */
import { VERLAUF_MAX, andersAls, merken, zurueck } from './entwurfsverlauf';

describe('Ein Zurück, das eine Sitzung lang hält', () => {
  it('merkt den Stand von vorher, nicht den neuen', () => {
    const stapel = merken(merken<string>([], 'a'), 'b');
    expect(stapel).toEqual(['a', 'b']);
  });

  it('gibt den obersten Stand zurück und nimmt ihn vom Stapel', () => {
    const { stand, stapel } = zurueck(['a', 'b', 'c']);
    expect(stand).toBe('c');
    expect(stapel).toEqual(['a', 'b']);
  });

  it('läuft auf einem leeren Stapel nicht im Kreis', () => {
    expect(zurueck([])).toEqual({ stand: null, stapel: [] });
  });

  it('läuft nicht über', () => {
    let stapel: number[] = [];
    for (let i = 0; i < VERLAUF_MAX + 10; i += 1) stapel = merken(stapel, i);
    expect(stapel).toHaveLength(VERLAUF_MAX);
    // Das Älteste fällt weg, das Jüngste bleibt.
    expect(stapel[stapel.length - 1]).toBe(VERLAUF_MAX + 9);
  });

  it('merkt nur, was sich wirklich geändert hat', () => {
    expect(andersAls({ alias: 'Flur' }, { alias: 'Flur' })).toBe(false);
    expect(andersAls({ alias: 'Flur' }, { alias: 'Flurlicht' })).toBe(true);
  });
});
