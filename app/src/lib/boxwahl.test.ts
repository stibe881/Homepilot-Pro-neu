import { boxWechsel, zielBox } from './boxwahl';

const BOXEN = ['Büro', 'Terrasse', 'Küche'];

test('die im Panel angetippte Box gewinnt', () => {
  expect(zielBox('Küche', 'Büro', 'Terrasse', BOXEN)).toBe('Küche');
});

test('der Wunsch aus dem Wähler schlägt die aktive Box', () => {
  // Der gemeldete Fall: Büro gewählt, Terrasse noch aktiv - die Musik
  // gehört ins Büro.
  expect(zielBox(null, 'Büro', 'Terrasse', BOXEN)).toBe('Büro');
});

test('ohne Wahl gilt die aktive Box', () => {
  expect(zielBox(null, null, 'Terrasse', BOXEN)).toBe('Terrasse');
});

test('ein Wunsch auf eine verschwundene Box verdraengt nichts', () => {
  expect(zielBox(null, 'Bad', 'Terrasse', BOXEN)).toBe('Terrasse');
});

test('aus voelliger Stille die erste sichtbare', () => {
  expect(zielBox(null, null, null, BOXEN)).toBe('Büro');
  expect(zielBox(null, null, null, [])).toBeNull();
});

describe('boxWechsel', () => {
  const quelle = { id: 'spotify', kannUmziehen: true, devices: ['Büro', 'Terrasse'], spielt: true };

  it('zieht die Musik um, wenn die Quelle die Box kennt', () => {
    expect(boxWechsel(quelle, { id: 'box.buero', name: 'Büro' })).toEqual({
      art: 'umzug',
      device: 'Büro',
      play: true,
    });
  });

  it('wechselt nur die Ansicht, wenn die Quelle die Box nicht kennt', () => {
    expect(boxWechsel(quelle, { id: 'box.bad', name: 'Bad' })).toEqual({ art: 'ansicht' });
  });

  it('wechselt nur die Ansicht ohne Quelle oder auf die Quelle selbst', () => {
    expect(boxWechsel(null, { id: 'box.buero', name: 'Büro' })).toEqual({ art: 'ansicht' });
    expect(boxWechsel(quelle, { id: 'spotify', name: 'Spotify' })).toEqual({ art: 'ansicht' });
  });
});

