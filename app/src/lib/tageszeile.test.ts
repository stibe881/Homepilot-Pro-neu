/** Die tageszeitliche Schnellzeile: was sie wann anbietet. */
import { Entity } from '../api/types';
import { griffLabel, tagesGriffe } from './tageszeile';

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
