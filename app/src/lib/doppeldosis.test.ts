import { doppeldosisFrage, fruehereGabe } from './doppeldosis';

const LOG = [
  { day: '2026-08-27', slot: 'Mittag', by: 'Maja', at: '2026-08-27T12:02:00', undo: false },
  { day: '2026-08-27', slot: 'Mittag', by: 'Stefan', at: '2026-08-27T12:05:00', undo: true },
];

test('der gefährliche Fall: abgehakt, zurückgenommen, wieder offen', () => {
  const frage = doppeldosisFrage(LOG, '2026-08-27', 'Mittag', false);
  expect(frage).toContain('Maja');
  expect(frage).toContain('12:02');
  expect(frage).toContain('noch einmal');
});

test('ein sichtbares Häkchen zurückzunehmen braucht keine Frage', () => {
  expect(doppeldosisFrage(LOG, '2026-08-27', 'Mittag', true)).toBeNull();
});

test('die erste Gabe des Tages fragt nicht', () => {
  expect(doppeldosisFrage(LOG, '2026-08-27', 'Abend', false)).toBeNull();
  expect(doppeldosisFrage(undefined, '2026-08-27', 'Mittag', false)).toBeNull();
});

test('gestern zählt nicht – jede Gabe gehört zu ihrem Tag', () => {
  expect(doppeldosisFrage(LOG, '2026-08-28', 'Mittag', false)).toBeNull();
  expect(fruehereGabe(LOG, '2026-08-27', 'Mittag')?.by).toBe('Maja');
});
