import { Entity } from '../api/types';
import { gemerkteAktion, menuLabel, merkbar } from './doppeltipp';

const licht = (over: Partial<Entity> = {}): Entity =>
  ({
    id: 'l1',
    kind: 'light',
    name: 'Licht Küche',
    integration: 'demo',
    state: { state: 'on', brightness: 40 },
    commands: ['turn_on', 'turn_off', 'set_brightness'],
    available: true,
    favorite: false,
    ...over,
  }) as Entity;

test('gemerkt wird, was gerade eingestellt ist', () => {
  expect(merkbar(licht())).toEqual({
    command: 'set_brightness',
    data: { brightness: 40 },
    wort: '40 %',
  });
});

test('ein Schalter hat nichts zu merken – dafür gibt es den ersten Tipp', () => {
  expect(
    merkbar(licht({ kind: 'switch', commands: ['turn_on', 'turn_off'], state: {} }))
  ).toBeNull();
  // Ein dunkles Licht auch nicht: «0 %» als Lieblingshelligkeit wäre aus.
  expect(merkbar(licht({ state: { state: 'off', brightness: 0 } }))).toBeNull();
});

test('Storen merken ihre Position', () => {
  const store = licht({
    id: 'c1',
    kind: 'cover',
    state: { position: 55 },
    commands: ['open', 'close', 'set_position'],
  });
  expect(merkbar(store)).toEqual({
    command: 'set_position',
    data: { position: 55 },
    wort: '55 %',
  });
});

test('ohne Eintrag tut der Doppeltipp nichts – geraten wird nicht', () => {
  expect(gemerkteAktion(undefined, 'l1')).toBeNull();
  expect(gemerkteAktion({}, 'l1')).toBeNull();
});

test('das Menü bietet merken an – und vergessen, wenn es dasselbe wäre', () => {
  expect(menuLabel({}, licht())).toBe('Doppeltipp merken: 40 %');
  const gemerkt = { l1: { command: 'set_brightness', data: { brightness: 40 }, wort: '40 %' } };
  expect(menuLabel(gemerkt, licht())).toBe('Doppeltipp (40 %) vergessen');
  // Steht das Licht anders, bietet das Menü das Neue an.
  expect(menuLabel(gemerkt, licht({ state: { state: 'on', brightness: 80 } }))).toBe(
    'Doppeltipp merken: 80 %'
  );
});
