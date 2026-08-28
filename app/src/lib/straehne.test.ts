import { naechsteStraehne, straehnenSatz } from './straehne';

test('die Reihe hält – jede Runde verlängert', () => {
  let stand: { streak: number; streak_last: string } = naechsteStraehne(
    { repeat: 'weekly' },
    '2026-08-03'
  );
  expect(stand.streak).toBe(1);
  stand = naechsteStraehne({ ...stand, repeat: 'weekly' }, '2026-08-10');
  expect(stand.streak).toBe(2);
});

test('einen Tag zu spät ist keine gerissene Strähne', () => {
  const stand = naechsteStraehne(
    { streak: 4, streak_last: '2026-08-03', repeat: 'weekly' },
    '2026-08-11'
  );
  expect(stand.streak).toBe(5);
});

test('eine ausgelassene Runde setzt auf eins zurück', () => {
  const stand = naechsteStraehne(
    { streak: 6, streak_last: '2026-07-20', repeat: 'weekly' },
    '2026-08-10'
  );
  expect(stand.streak).toBe(1);
});

test('zweimal am selben Tag verlängert nicht', () => {
  const stand = naechsteStraehne(
    { streak: 3, streak_last: '2026-08-10', repeat: 'daily' },
    '2026-08-10'
  );
  expect(stand.streak).toBe(3);
});

test('der Satz erscheint erst ab zwei – eine Einzelne ist keine Strähne', () => {
  expect(straehnenSatz({ streak: 1, repeat: 'weekly' })).toBeNull();
  expect(straehnenSatz({ streak: 6, repeat: 'weekly' })).toBe('6 Wochen am Stück');
  expect(straehnenSatz({ streak: 3, repeat: 'daily' })).toBe('3 Tage am Stück');
});

test('einmalige Aufgaben haben keine Strähne', () => {
  const stand = naechsteStraehne(
    { streak: 2, streak_last: '2026-08-09', repeat: 'none' },
    '2026-08-10'
  );
  expect(stand.streak).toBe(1);
});
