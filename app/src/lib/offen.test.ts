/** Was «offen» heisst – und welche Türe die Wohnungstüre ist. */
import { Entity } from '../api/types';
import { hasOpenDoor, wohnungstuer, wohnungstuerOffen } from './offen';

describe('Wohnungstüre', () => {
  const schloss = (
    id: string,
    name: string,
    patch: Partial<Entity> = {},
    state: Record<string, unknown> = {}
  ): Entity =>
    ({
      id,
      name,
      kind: 'lock',
      available: true,
      commands: ['lock', 'unlock'],
      integration: 'nuki',
      state: { state: 'locked', ...state },
      ...patch,
    }) as unknown as Entity;

  const kontakt = (id: string, name: string, offen: boolean): Entity =>
    ({
      id,
      name,
      kind: 'binary_sensor',
      available: true,
      commands: [],
      integration: 'demo',
      state: { state: offen ? 'on' : 'off', device_class: 'door' },
    }) as unknown as Entity;

  it('nimmt das Schloss, das so heisst', () => {
    const liste = [
      schloss('a', 'Nuki Keller'),
      schloss('b', 'Wohnungstüre'),
    ];
    expect(wohnungstuer(liste)?.id).toBe('b');
  });

  it('nimmt sonst das erste Schloss, das abschliessen kann', () => {
    // Ein blosser Türöffner kann das nicht – der ist die Haustüre.
    const liste = [
      schloss('oeffner', 'Gegensprechanlage', { commands: ['unlatch'] }),
      schloss('nuki', 'Smart Lock Pro'),
    ];
    expect(wohnungstuer(liste)?.id).toBe('nuki');
  });

  it('lässt die Klingel aussen vor', () => {
    const liste = [
      schloss('ring', 'Haustüre', { integration: 'ring' }),
      schloss('nuki', 'Smart Lock Pro'),
    ];
    expect(wohnungstuer(liste)?.id).toBe('nuki');
  });

  it('findet keine, wo keine ist', () => {
    expect(wohnungstuer([kontakt('f', 'Fenster Küche', true)])).toBeNull();
  });

  it('meldet die offene Wohnungstüre über den Türsensor im Schloss', () => {
    const liste = [schloss('b', 'Wohnungstüre', {}, { door: 'open' })];
    expect(wohnungstuerOffen(liste)).toBe(true);
  });

  it('meldet sie auch über einen eigenen Kontaktsensor', () => {
    // Wer kein Schloss mit Türsensor hat, hätte sonst nie ein Rot
    // gesehen.
    const liste = [kontakt('k', 'Wohnungstüre', true)];
    expect(wohnungstuerOffen(liste)).toBe(true);
  });

  it('schweigt bei einer offenen Balkontüre', () => {
    const liste = [
      schloss('b', 'Wohnungstüre', {}, { door: 'closed' }),
      kontakt('balkon', 'Balkontüre', true),
    ];
    expect(wohnungstuerOffen(liste)).toBe(false);
    // Die zählt weiter als offene Türe – nur eben nicht als diese.
    expect(hasOpenDoor(liste)).toBe(true);
  });

  it('schweigt, wenn alles zu ist', () => {
    const liste = [schloss('b', 'Wohnungstüre', {}, { door: 'closed' })];
    expect(wohnungstuerOffen(liste)).toBe(false);
  });
});
