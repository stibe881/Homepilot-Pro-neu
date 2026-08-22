/**
 * Die Familienseite ohne Netz.
 *
 * Der Fall, der wehtut: Im Ladenkeller ein Häkchen setzen und glauben,
 * es sei angekommen. Diese Funktionen entscheiden, ob es das wird.
 */
import { anwenden, frisch, merke, standText, vorlaeufigeId, Vorgemerkt } from './familiecache';

const JETZT = 1_700_000_000_000;

describe('merke', () => {
  test('je Eintrag bleibt der letzte Stand', () => {
    let offen: Vorgemerkt[] = [];
    offen = merke(offen, { kind: 'update', collection: 'shopping', id: 'a', body: { done: true }, at: JETZT });
    offen = merke(offen, { kind: 'update', collection: 'shopping', id: 'a', body: { done: false }, at: JETZT + 10 });
    expect(offen).toHaveLength(1);
    expect(offen[0].body).toEqual({ done: false });
  });

  test('lokal angelegt und wieder gelöscht verschwindet ganz', () => {
    let offen: Vorgemerkt[] = [];
    offen = merke(offen, { kind: 'add', collection: 'tasks', id: 'lokal-1', body: { text: 'x' }, at: JETZT });
    offen = merke(offen, { kind: 'remove', collection: 'tasks', id: 'lokal-1', at: JETZT + 5 });
    expect(offen).toEqual([]);
  });

  test('ein noch nicht gesendeter Neuzugang wird geändert, nicht ergänzt', () => {
    let offen: Vorgemerkt[] = [];
    offen = merke(offen, { kind: 'add', collection: 'tasks', id: 'lokal-1', body: { text: 'Milch' }, at: JETZT });
    offen = merke(offen, { kind: 'update', collection: 'tasks', id: 'lokal-1', body: { done: true }, at: JETZT + 5 });
    expect(offen).toHaveLength(1);
    expect(offen[0]).toMatchObject({ kind: 'add', body: { text: 'Milch', done: true } });
  });
});

describe('anwenden', () => {
  test('zeigt sofort, was nach dem Senden dasteht', () => {
    const data = { shopping: [{ id: 'a', text: 'Milch' }] };
    const offen: Vorgemerkt[] = [
      { kind: 'update', collection: 'shopping', id: 'a', body: { done: true }, at: JETZT },
      { kind: 'add', collection: 'shopping', id: 'lokal-2', body: { text: 'Butter' }, at: JETZT },
    ];
    const sicht = anwenden(data, offen);
    expect(sicht.shopping).toHaveLength(2);
    expect(sicht.shopping[0]).toMatchObject({ done: true, pending: true });
    expect(sicht.shopping[1]).toMatchObject({ text: 'Butter', id: 'lokal-2' });
  });

  test('Gelöschtes ist sofort weg', () => {
    const data = { tasks: [{ id: 'a', text: 'x' }] };
    const sicht = anwenden(data, [{ kind: 'remove', collection: 'tasks', id: 'a', at: JETZT }]);
    expect(sicht.tasks).toEqual([]);
  });
});

test('frisch wirft weg, was einen Tag alt ist', () => {
  const offen: Vorgemerkt[] = [
    { kind: 'update', collection: 'tasks', id: 'a', at: JETZT - 25 * 3600 * 1000 },
    { kind: 'update', collection: 'tasks', id: 'b', at: JETZT - 3600 * 1000 },
  ];
  expect(frisch(offen, JETZT).map((e) => e.id)).toEqual(['b']);
});

describe('standText', () => {
  const jetzt = new Date('2026-08-22T15:00:00');

  test('schweigt, wenn alles in Ordnung ist', () => {
    expect(standText(jetzt.getTime(), true, 0)).toBeNull();
  });

  test('sagt Stand und Grund', () => {
    const stand = new Date('2026-08-22T14:12:00').getTime();
    expect(standText(stand, false, 0, jetzt)).toBe('Stand von 14:12 · keine Verbindung');
  });

  test('zählt die wartenden Änderungen', () => {
    const stand = new Date('2026-08-22T14:12:00').getTime();
    expect(standText(stand, false, 3, jetzt)).toContain('3 Änderungen warten');
  });
});

test('vorläufige Kennungen sind als solche erkennbar', () => {
  expect(vorlaeufigeId(JETZT, 0.5).startsWith('lokal-')).toBe(true);
});
