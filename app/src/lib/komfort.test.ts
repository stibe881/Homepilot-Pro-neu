import { bandPosition, feuchteUrteil, klimaUrteil, tempUrteil } from './komfort';

test('der Winterfall bekommt ein Wort – an der Zahl erkennt ihn niemand', () => {
  expect(feuchteUrteil(35)).toEqual({ wort: 'zu trocken', ton: 'warn' });
  expect(feuchteUrteil(25)).toEqual({ wort: 'sehr trocken', ton: 'danger' });
});

test('über 65 Prozent heisst es Schimmelgefahr, nicht bloss «feucht»', () => {
  expect(feuchteUrteil(62)).toEqual({ wort: 'feucht', ton: 'warn' });
  expect(feuchteUrteil(70)).toEqual({ wort: 'Schimmelgefahr', ton: 'danger' });
});

test('im grünen Bereich schweigt die Zeile – «gut» wäre Lärm', () => {
  expect(feuchteUrteil(47)).toBeNull();
  expect(tempUrteil(21.3)).toBeNull();
  expect(klimaUrteil(21.3, 47)).toBeNull();
});

test('die Temperatur-Grenzen sind weit – 17 Grad im Schlafzimmer sind kein Fall', () => {
  expect(tempUrteil(17)).toBeNull();
  expect(tempUrteil(14.5)).toEqual({ wort: 'kalt', ton: 'warn' });
  expect(tempUrteil(27)).toEqual({ wort: 'heiss', ton: 'warn' });
});

test('die Feuchte gewinnt gegen die Temperatur', () => {
  expect(klimaUrteil(27, 70)?.wort).toBe('Schimmelgefahr');
});

test('ohne Werte kein Urteil', () => {
  expect(klimaUrteil(null, undefined)).toBeNull();
  expect(feuchteUrteil(Number.NaN)).toBeNull();
});

test('der Punkt bleibt auf dem Band', () => {
  expect(bandPosition(20)).toBe(0);
  expect(bandPosition(50)).toBe(0.5);
  expect(bandPosition(95)).toBe(1);
});
