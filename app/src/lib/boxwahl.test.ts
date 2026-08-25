import { zielBox } from './boxwahl';

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
