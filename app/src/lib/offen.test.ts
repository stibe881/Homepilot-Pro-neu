/** Was «offen» heisst – und welche Türe die Wohnungstüre ist. */
import { Entity } from '../api/types';
import {
  hasOpenDoor,
  offenSeit,
  offenSortiert,
  raumZeile,
  wohnungstuer,
  wohnungstuerOffen,
} from './offen';

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

describe('Wie lange steht es offen', () => {
  const JETZT = 1_700_000_000_000;
  const vorSekunden = (s: number) => JETZT / 1000 - s;

  it('sagt die Dauer, wie man sie sagen würde', () => {
    expect(offenSeit({ last_change: vorSekunden(20 * 60) }, JETZT)).toBe('seit 20 Min');
    expect(offenSeit({ last_change: vorSekunden(3 * 3600) }, JETZT)).toBe('seit 3 Std');
    expect(offenSeit({ last_change: vorSekunden(30) }, JETZT)).toBe('gerade eben');
  });

  it('schweigt, solange der Hub nichts gesehen hat', () => {
    // Nach einem Neustart ist das Gedächtnis leer. «gerade eben» wäre
    // dann eine Behauptung über etwas, das er nicht miterlebt hat.
    expect(offenSeit({}, JETZT)).toBeNull();
    expect(offenSeit({ last_change: null }, JETZT)).toBeNull();
  });

  it('stellt das am längsten Offene voran', () => {
    // Was seit drei Stunden offen steht, ist der Grund, warum man hinsieht.
    const kontakt = (id: string, seit: number | null) =>
      ({
        id,
        name: id,
        kind: 'binary_sensor',
        available: true,
        commands: [],
        state: { state: 'on', device_class: 'contact' },
        last_change: seit,
      }) as unknown as Entity;
    const sortiert = offenSortiert(
      [
        kontakt('kurz', vorSekunden(60)),
        kontakt('ohne', null),
        kontakt('lang', vorSekunden(3 * 3600)),
      ],
      JETZT
    );
    expect(sortiert.map((e) => e.id)).toEqual(['lang', 'kurz', 'ohne']);
  });
});

describe('raumZeile', () => {
  it('lässt den Raum weg, wenn er nur den Namen wiederholt', () => {
    // Der Kontakt an der Terrassentüre heisst «Terrasse» und liegt im
    // Raum «Terrasse» - untereinander stand das zweimal da.
    expect(raumZeile({ name: 'Terrasse', room: 'Terrasse' })).toBeNull();
    expect(raumZeile({ name: 'Terrasse', room: ' terrasse ' })).toBeNull();
  });

  it('nennt ihn, wo er etwas sagt', () => {
    expect(raumZeile({ name: 'Fenster', room: 'Küche' })).toBe('Küche');
    expect(raumZeile({ name: 'Fenster' })).toBeNull();
    expect(raumZeile({ name: 'Fenster', room: '  ' })).toBeNull();
  });
});
