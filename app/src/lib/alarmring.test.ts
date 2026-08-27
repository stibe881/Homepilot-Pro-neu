import { ringAnteil } from './alarmring';

test('der Ring zeigt den Rest der Frist', () => {
  expect(ringAnteil({ seconds_left: 30, seconds_total: 60 })).toBe(0.5);
  expect(ringAnteil({ seconds_left: 0, seconds_total: 60 })).toBe(0);
});

test('ohne Gesamtlänge gibt es keinen Ring – eine Zahl allein reicht nicht', () => {
  expect(ringAnteil({ seconds_left: 30 })).toBeNull();
  expect(ringAnteil({ seconds_left: null, seconds_total: 60 })).toBeNull();
  expect(ringAnteil({ seconds_left: 30, seconds_total: 0 })).toBeNull();
});

test('mehr Rest als Frist bleibt bei voll – Uhren gehen auch mal ungleich', () => {
  expect(ringAnteil({ seconds_left: 70, seconds_total: 60 })).toBe(1);
});
