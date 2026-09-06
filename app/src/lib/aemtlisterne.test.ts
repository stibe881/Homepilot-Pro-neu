import {
  protokollVon,
  sternHinweis,
  sternProtokoll,
  sternReihe,
  sternSatz,
  sternZiel,
  wochenSterne,
} from './aemtlisterne';

// Der 2.9.2026 ist ein Mittwoch; die Woche läuft vom Montag, 31.8.,
// bis Sonntag, 6.9.
const mittwoch = new Date('2026-09-02T15:00:00');

test('ein Abhaken schreibt den Stern der zugeteilten Person', () => {
  const log = sternProtokoll({ member: 'Levin' }, '2026-09-02');
  expect(log).toEqual([{ by: 'Levin', on: '2026-09-02' }]);
});

test('ohne Zuteilung gibt es keinen Stern - niemand weiss, wer es war', () => {
  expect(sternProtokoll({ member: '' }, '2026-09-02')).toEqual([]);
  expect(sternProtokoll({}, '2026-09-02')).toEqual([]);
});

test('zweimal am selben Tag abgehakt gibt keinen zweiten Stern', () => {
  const einmal = sternProtokoll({ member: 'Levin' }, '2026-09-02');
  const zweimal = sternProtokoll(
    { member: 'Levin', stars_log: einmal },
    '2026-09-02'
  );
  expect(zweimal).toHaveLength(1);
});

test('alte Sterne fliegen beim Schreiben hinaus', () => {
  const log = sternProtokoll(
    {
      member: 'Levin',
      stars_log: [
        { by: 'Levin', on: '2026-01-05' }, // acht Monate her
        { by: 'Levin', on: '2026-08-31' },
      ],
    },
    '2026-09-02'
  );
  expect(log.map((stern) => stern.on)).toEqual(['2026-08-31', '2026-09-02']);
});

test('kaputte Protokollzeilen werden ausgelassen statt mitgezählt', () => {
  expect(
    protokollVon({ stars_log: [{ by: 'Levin' }, { on: '2026-09-01' }, 'x', null] })
  ).toEqual([]);
  expect(protokollVon({ stars_log: 'kein array' })).toEqual([]);
});

test('gezählt wird je Kind und nur die Woche ab Montag', () => {
  const chores = [
    {
      stars_log: [
        { by: 'Levin', on: '2026-08-31' }, // Montag dieser Woche
        { by: 'Levin', on: '2026-09-02' },
        { by: 'Lina', on: '2026-09-01' }, // anderes Kind
        { by: 'Levin', on: '2026-08-30' }, // Sonntag - letzte Woche
      ],
    },
    { stars_log: [{ by: 'Levin', on: '2026-09-06' }] }, // Sonntag dieser Woche
  ];
  expect(wochenSterne(chores, 'Levin', mittwoch)).toBe(3);
  expect(wochenSterne(chores, 'Lina', mittwoch)).toBe(1);
  expect(wochenSterne(chores, 'Mia', mittwoch)).toBe(0);
});

test('ohne gesetztes Ziel gibt es keine Sterne-Anzeige (kein Zwang)', () => {
  expect(sternZiel({})).toBeNull();
  expect(sternZiel({ stars_goal: 0 })).toBeNull();
  expect(sternZiel({ stars_goal: 'abc' })).toBeNull();
  expect(sternZiel(null)).toBeNull();
});

test('Ziel und Belohnung kommen aus dem Mitglieds-Eintrag', () => {
  expect(sternZiel({ stars_goal: 10, stars_reward: ' Kino ' })).toEqual({
    goal: 10,
    reward: 'Kino',
  });
  expect(sternZiel({ stars_goal: '5' })).toEqual({ goal: 5, reward: '' });
});

test('der Fortschrittssatz heisst «7 von 10 Sternen»', () => {
  expect(sternSatz(7, 10)).toBe('7 von 10 Sternen');
});

test('die Zeile darunter nennt den Handel und dann den Erfolg', () => {
  const ziel = { goal: 10, reward: 'Kino' };
  expect(sternHinweis(7, ziel)).toBe('10 Sterne = Kino');
  expect(sternHinweis(10, ziel)).toBe('Geschafft! Kino ist verdient.');
  expect(sternHinweis(3, { goal: 10, reward: '' })).toBeNull();
  expect(sternHinweis(10, { goal: 10, reward: '' })).toBe('Wochenziel geschafft!');
});

test('die Sternenreihe zeigt volle und leere Sterne - und passt oder fehlt', () => {
  expect(sternReihe(2, 4)).toEqual([true, true, false, false]);
  // Mehr als das Ziel bleibt eine volle Reihe.
  expect(sternReihe(6, 4)).toEqual([true, true, true, true]);
  // Ein Riesenziel sprengt keine Karte.
  expect(sternReihe(17, 40)).toBeNull();
});
