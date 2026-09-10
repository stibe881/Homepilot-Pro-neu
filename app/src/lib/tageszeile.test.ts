/** Die tageszeitliche Schnellzeile: was sie wann anbietet. */
import { Entity } from '../api/types';
import { abendSzenenGriff, griffLabel, istAbendfenster, tagesGriffe } from './tageszeile';

const geraet = (patch: Partial<Entity>): Entity =>
  ({
    id: Math.random().toString(36).slice(2),
    kind: 'light',
    name: 'X',
    integration: 'demo',
    state: {},
    commands: [],
    available: true,
    ...patch,
  }) as Entity;

const um = (stunde: number) => new Date(2026, 8, 7, stunde, 30);

const storeUnten = () =>
  geraet({
    kind: 'cover',
    state: { state: 'closed', position: 0 },
    commands: ['open', 'close', 'set_position'],
  });

const lichtAn = () =>
  geraet({ kind: 'light', state: { state: 'on' }, commands: ['toggle', 'turn_off'] });

describe('tagesGriffe', () => {
  it('bietet morgens die unteren Storen zum Öffnen an', () => {
    const griffe = tagesGriffe([storeUnten(), storeUnten()], um(7));
    expect(griffe).toHaveLength(1);
    expect(griffe[0].key).toBe('storen_auf');
    expect(griffe[0].label).toBe('2 Storen auf');
    expect(griffe[0].befehle.every((b) => b.command === 'open')).toBe(true);
  });

  it('zählt morgens auch die Store in Beschattung zu den unteren', () => {
    // Unten mit offenen Lamellen ist unten - morgens soll sie hoch.
    const beschattet = geraet({
      kind: 'cover',
      state: { state: 'closed', position: 0, tilt: 50 },
      commands: ['open', 'close', 'set_position', 'set_tilt'],
    });
    expect(tagesGriffe([beschattet], um(8))[0]?.key).toBe('storen_auf');
  });

  it('lässt offene Storen morgens in Ruhe', () => {
    const oben = geraet({
      kind: 'cover',
      state: { state: 'open', position: 100 },
      commands: ['open', 'close'],
    });
    expect(tagesGriffe([oben], um(7))).toHaveLength(0);
  });

  it('bietet abends Licht aus und Storen zu an - ausdrücklich, nicht als toggle', () => {
    const oben = geraet({
      kind: 'cover',
      state: { state: 'open', position: 100 },
      commands: ['open', 'close'],
    });
    const griffe = tagesGriffe([lichtAn(), oben], um(22));
    expect(griffe.map((griff) => griff.key)).toEqual(['licht_aus', 'storen_zu']);
    expect(griffe[0].label).toBe('Licht aus');
    expect(griffe[0].befehle[0].command).toBe('turn_off');
    expect(griffe[1].label).toBe('Store zu');
  });

  it('nennt Name und Raum jedes Geräts - für das Blatt hinter dem Griff', () => {
    // «4 Lichter aus» sagt nicht, welche vier. Wer erst nach dem Tippen
    // merkt, dass das Kinderzimmer dabei war, hat ein Kind im Dunkeln -
    // deshalb reisen Name und Raum am Befehl mit.
    const kinderzimmer = geraet({
      kind: 'light',
      name: 'Nachttischlampe',
      room: 'Kinderzimmer',
      state: { state: 'on' },
      commands: ['turn_off'],
    });
    const griff = tagesGriffe([kinderzimmer], um(22))[0];
    expect(griff.befehle[0]).toEqual({
      entityId: kinderzimmer.id,
      command: 'turn_off',
      name: 'Nachttischlampe',
      room: 'Kinderzimmer',
    });
    expect(griff.titel).toBe('Diese Lichter brennen');
    expect(griff.tunWort).toBe('ausschalten');
  });

  it('trägt je Griff das passende Zeitwort für den Knopf', () => {
    const oben = geraet({
      kind: 'cover',
      state: { state: 'open', position: 100 },
      commands: ['open', 'close'],
    });
    expect(tagesGriffe([oben], um(22))[0].tunWort).toBe('schliessen');
    expect(tagesGriffe([storeUnten()], um(7))[0].tunWort).toBe('öffnen');
  });

  it('gilt auch kurz nach Mitternacht noch als Abend', () => {
    expect(tagesGriffe([lichtAn()], um(1))).toHaveLength(1);
  });

  it('schweigt am Nachmittag und ohne Handlungsbedarf', () => {
    expect(tagesGriffe([lichtAn()], um(14))).toHaveLength(0);
    expect(tagesGriffe([], um(22))).toHaveLength(0);
  });
});

describe('griffLabel', () => {
  it('lässt die Eins weg - eine Eins vor dem einzigen Storen wäre Buchhaltung', () => {
    expect(griffLabel(1, 'Store auf', 'Storen auf')).toBe('Store auf');
    expect(griffLabel(3, 'Store auf', 'Storen auf')).toBe('3 Storen auf');
  });
});

describe('istAbendfenster', () => {
  it('gilt ab 21 Uhr und bis kurz vor 2 Uhr, sonst nicht', () => {
    expect(istAbendfenster(um(21))).toBe(true);
    expect(istAbendfenster(um(23))).toBe(true);
    expect(istAbendfenster(um(1))).toBe(true);
    expect(istAbendfenster(um(2))).toBe(false);
    expect(istAbendfenster(um(14))).toBe(false);
    expect(istAbendfenster(um(7))).toBe(false);
  });
});

describe('abendSzenenGriff', () => {
  const kino = { id: 'scene.kino', name: 'Kino', icon: 'film-outline' };

  it('zeigt die Szene abends, zur selben Zeit wie Licht aus und Storen zu', () => {
    expect(abendSzenenGriff(kino, um(22))).toEqual({
      key: 'abend_szene',
      sceneId: 'scene.kino',
      label: 'Kino',
      icon: 'film-outline',
    });
  });

  it('bleibt ausserhalb des Abendfensters weg', () => {
    expect(abendSzenenGriff(kino, um(14))).toBeNull();
  });

  it('bleibt ohne Szene weg', () => {
    expect(abendSzenenGriff(null, um(22))).toBeNull();
    expect(abendSzenenGriff(undefined, um(22))).toBeNull();
  });
});
