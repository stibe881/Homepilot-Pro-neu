import { szenenFarben, weisstonFarbe } from './szenenfarben';

test('die gewählten Farben erscheinen als Punkte, doppelte einmal', () => {
  expect(
    szenenFarben([
      { command: 'set_color', data: { color: '#E5484D' } },
      { command: 'set_color', data: { color: '#E5484D' } },
      { command: 'set_color', data: { color: '#2F6BF6' } },
      { command: 'turn_off' },
    ])
  ).toEqual(['#E5484D', '#2F6BF6']);
});

test('Weisstöne bekommen den Ton aus dem Editor wieder', () => {
  expect(weisstonFarbe(370)).toBe('#FFD9A0');
  expect(weisstonFarbe(286)).toBe('#FFF1D6');
  expect(weisstonFarbe(200)).toBe('#DCEBFF');
  expect(szenenFarben([{ command: 'set_color_temp', data: { color_temp: 370 } }])).toEqual([
    '#FFD9A0',
  ]);
});

test('eine Szene, die nur schaltet, bekommt keine geratenen Punkte', () => {
  expect(
    szenenFarben([
      { command: 'turn_on' },
      { command: 'set_brightness', data: {} },
    ])
  ).toEqual([]);
  expect(szenenFarben(undefined)).toEqual([]);
});

test('mehr als vier Stimmungen zeigt niemand mehr auseinander', () => {
  const viele = ['#1', '#2', '#3', '#4', '#5'].map((color) => ({
    command: 'set_color',
    data: { color },
  }));
  expect(szenenFarben(viele)).toHaveLength(4);
});
