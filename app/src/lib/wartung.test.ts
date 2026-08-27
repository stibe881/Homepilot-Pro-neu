import { Wartungszeile, faelligText, frueherSatz, quittungSatz } from './wartung';

const zeile = (over: Partial<Wartungszeile>): Wartungszeile => ({
  id: 'w1',
  text: 'Wasserfilter wechseln',
  interval_days: 180,
  due: '2027-02-23',
  ...over,
});

test('überfällig sagt, seit wann', () => {
  expect(faelligText(zeile({ days_left: -7 }))).toBe('seit 7 Tagen fällig');
  expect(faelligText(zeile({ days_left: 0 }))).toBe('heute fällig');
  expect(faelligText(zeile({ days_left: 5 }))).toBe('in 5 Tagen');
});

test('ohne Frist steht das Datum lesbar da', () => {
  expect(faelligText(zeile({}))).toBe('fällig am 23.02.2027');
});

test('die Quittung nennt Tag und Namen', () => {
  expect(quittungSatz(zeile({ log: [{ at: '2026-08-27', by: 'Bine' }] }))).toBe(
    'zuletzt 27.08.2026 · Bine'
  );
});

test('eine alte Erledigung ohne Namen bleibt eine Auskunft', () => {
  expect(quittungSatz(zeile({ last_done: '2026-01-05' }))).toBe('zuletzt 05.01.2026');
});

test('eine frisch angelegte Wartung sagt nichts über Quittungen', () => {
  expect(quittungSatz(zeile({}))).toBe('');
  expect(frueherSatz(zeile({}))).toBe('');
});

test('der Abstand davor ist die eigentliche Auskunft', () => {
  const item = zeile({
    log: [
      { at: '2026-08-27', by: 'Bine' },
      { at: '2026-04-08', by: 'Stefan' },
      { at: '2026-01-05', by: null },
    ],
  });
  expect(frueherSatz(item)).toBe('davor: 08.04.2026 (Stefan), 05.01.2026');
});
