import { balkenHoehen, regenSatz, regendauer } from './regen';

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

describe('regenSatz mit Stunden', () => {
  test('ohne Regen in zwei Stunden sagt die Karte, wie lange man noch hat', () => {
    // Bisher schwieg sie hier ganz - und die Wochenzeile mit ihren
    // Prozenten beantwortet die Frage am Fenster nicht.
    expect(regenSatz({ now: false, minutes: null, hours: 6 })).toBe(
      'Regen in etwa 6 Std.'
    );
  });

  test('die Minuten gehen vor - sie sind die genauere Auskunft', () => {
    expect(regenSatz({ now: false, minutes: 45, hours: 1 })).toBe(
      'Regen in etwa 45 Min.'
    );
  });

  test('regnet es schon, zaehlt das Ende und nicht der naechste Guss', () => {
    expect(regenSatz({ now: true, minutes: 20, hours: 8 })).toBe(
      'Es regnet noch etwa 20 Min.'
    );
  });

  test('trocken bleibt trocken', () => {
    // Kein Regen in Sicht: kein Satz. Eine Zeile «kein Regen» stünde
    // dort an den meisten Tagen und würde bald nicht mehr gelesen.
    expect(regenSatz({ now: false, minutes: null, hours: null })).toBeNull();
    expect(regenSatz({ now: false, minutes: null })).toBeNull();
  });
});

describe('lange Dauern stehen in Stunden', () => {
  test('«120 Min.» war eine Rechenaufgabe - jetzt sind es zwei Stunden', () => {
    // Genau so gemeldet, mit rotem Kreis um die Zahl: «Es regnet noch
    // etwa 120 Min.» Wer das liest, teilt zuerst durch sechzig.
    expect(regenSatz({ now: true, minutes: 120 })).toBe('Es regnet noch etwa 2 Std.');
  });

  test('angebrochene Stunden behalten ihre Minuten', () => {
    expect(regenSatz({ now: true, minutes: 125 })).toBe(
      'Es regnet noch etwa 2 Std. 5 Min.'
    );
    expect(regenSatz({ now: false, minutes: 95 })).toBe('Regen in etwa 1 Std. 35 Min.');
  });

  test('unter einer Stunde bleibt es bei den Minuten', () => {
    // Dort ist die Minute die Auskunft, die man wirklich will.
    expect(regendauer(45)).toBe('45 Min.');
    expect(regendauer(59)).toBe('59 Min.');
    expect(regendauer(60)).toBe('1 Std.');
  });
});
