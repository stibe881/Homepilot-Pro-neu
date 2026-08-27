import { balkenHoehen, regenSatz } from './regen';

test('die Vorwarnung sagt, in wie vielen Minuten es losgeht', () => {
  expect(regenSatz({ now: false, minutes: 45 })).toBe('Regen in etwa 45 Min.');
});

test('«gleich» heisst gleich – eine Minutenzahl wäre hier genauer, als die Quelle ist', () => {
  expect(regenSatz({ now: false, minutes: 0 })).toBe('Es fängt gleich an zu regnen.');
});

test('wenn es schon regnet, zählt die andere Hälfte der Frage', () => {
  expect(regenSatz({ now: true, minutes: 30 })).toBe('Es regnet noch etwa 30 Min.');
  expect(regenSatz({ now: true, minutes: null })).toBe('Es regnet.');
});

test('ohne anstehenden Regen steht da nichts', () => {
  expect(regenSatz({ now: false, minutes: null })).toBeNull();
  expect(regenSatz(null)).toBeNull();
  expect(regenSatz(undefined)).toBeNull();
});

describe('balkenHoehen', () => {
  test('skaliert auf den nassesten Balken', () => {
    expect(balkenHoehen([0, 1, 2], 24)).toEqual([0, 12, 24]);
  });

  test('ein Hauch Regen bleibt sichtbar', () => {
    expect(balkenHoehen([0.1, 2], 24)[0]).toBeGreaterThanOrEqual(3);
  });

  test('eine trockene Reihe gibt keine Grafik – Tinte für nichts', () => {
    expect(balkenHoehen([0, 0, 0], 24)).toEqual([]);
    expect(balkenHoehen(undefined, 24)).toEqual([]);
  });
});
