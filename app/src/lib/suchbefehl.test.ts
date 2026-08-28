import { Entity } from '../api/types';
import { befehlAusText, prozentAus } from './suchbefehl';

const geraet = (over: Partial<Entity> & { id: string; name: string }): Entity =>
  ({
    kind: 'light',
    integration: 'demo',
    state: {},
    commands: ['turn_on', 'turn_off', 'set_brightness'],
    available: true,
    room: 'Küche',
    favorite: false,
    ...over,
  }) as Entity;

const HAUS: Entity[] = [
  geraet({ id: 'l1', name: 'Licht Küche' }),
  geraet({ id: 'l2', name: 'Licht Wohnzimmer', room: 'Wohnzimmer' }),
  geraet({
    id: 'c1',
    name: 'Store Wohnzimmer',
    kind: 'cover',
    room: 'Wohnzimmer',
    commands: ['open', 'close', 'stop', 'set_position'],
  }),
  geraet({
    id: 'k1',
    name: 'Wohnungstüre',
    kind: 'lock',
    room: 'Flur',
    commands: ['lock', 'unlock', 'open_door'],
  }),
];

test('«licht küche aus» schaltet das Licht in der Küche aus', () => {
  const befehl = befehlAusText('licht küche aus', HAUS);
  expect(befehl).toEqual({
    entityId: 'l1',
    command: 'turn_off',
    satz: 'Licht Küche ausschalten',
  });
});

test('«store wohnzimmer hoch» findet die Store, nicht die Lampe', () => {
  expect(befehlAusText('store wohnzimmer hoch', HAUS)?.entityId).toBe('c1');
  expect(befehlAusText('store wohnzimmer hoch', HAUS)?.command).toBe('open');
});

test('eine Prozentzahl meint die Helligkeit', () => {
  expect(befehlAusText('licht küche 40%', HAUS)).toEqual({
    entityId: 'l1',
    command: 'set_brightness',
    data: { brightness: 40 },
    satz: 'Licht Küche auf 40 %',
  });
});

test('«storen auf 40» ist eine Position, kein «hoch»', () => {
  const befehl = befehlAusText('store wohnzimmer auf 40', HAUS);
  expect(befehl?.command).toBe('set_position');
  expect(befehl?.data).toEqual({ position: 40 });
});

test('Schlösser schaltet das Suchfeld nie – ein Tippfehler im Zug reicht', () => {
  expect(befehlAusText('wohnungstüre auf', HAUS)).toBeNull();
});

test('eine blosse Suche bleibt eine Suche', () => {
  expect(befehlAusText('licht', HAUS)).toBeNull();
  expect(befehlAusText('licht küche', HAUS)).toBeNull();
  expect(befehlAusText('bad', HAUS)).toBeNull();
});

test('ein Gerät, das den Befehl nicht kann, wird nicht geschaltet', () => {
  // Die Lampe kennt kein «hoch», und im Wohnzimmer gibt es keine zweite.
  expect(befehlAusText('licht wohnzimmer hoch', HAUS)).toBeNull();
});

test('Prozente lesen', () => {
  expect(prozentAus(['40%'])).toBe(40);
  expect(prozentAus(['auf', '40'])).toBe(40);
  expect(prozentAus(['200'])).toBeNull();
  expect(prozentAus(['küche'])).toBeNull();
});
