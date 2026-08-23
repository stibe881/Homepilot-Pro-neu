/**
 * «Wer ist da?» und die Frage, ob man dem Orten zusehen kann.
 */
import {
  anwesenheitKurz,
  anwesenheitsZeile,
  ortungsHinweis,
  pauseBis,
  pausiert,
  seitText,
  zustandText,
} from './ortung';

const JETZT = new Date('2026-08-22T16:00:00');
const vorMinuten = (m: number) => (JETZT.getTime() - m * 60000) / 1000;

describe('zustandText', () => {
  test('nennt die drei Grundzustände beim Namen', () => {
    expect(zustandText({ state: 'home' })).toBe('zuhause');
    expect(zustandText({ state: 'away' })).toBe('unterwegs');
    expect(zustandText({ state: 'unknown' })).toBe('meldet sich nicht');
  });

  test('eine zweite Zone wird zum Ortsnamen', () => {
    expect(zustandText({ state: 'schule', place_name: 'Schule' })).toBe('Schule');
  });
});

describe('seitText', () => {
  test('rechnet in Minuten, Uhrzeit und Tagen', () => {
    expect(seitText(vorMinuten(1), JETZT)).toBe('gerade eben');
    expect(seitText(vorMinuten(20), JETZT)).toBe('seit 20 min');
    expect(seitText(vorMinuten(100), JETZT)).toBe('seit 14:20');
    expect(seitText(vorMinuten(30 * 60), JETZT)).toBe('seit gestern');
  });

  test('ohne Zeitpunkt keine Behauptung', () => {
    expect(seitText(null, JETZT)).toBe('');
  });
});

test('anwesenheitsZeile liest sich wie ein Satz', () => {
  expect(
    anwesenheitsZeile({ name: 'Stefan', state: 'away', since: vorMinuten(100) }, JETZT)
  ).toBe('Stefan unterwegs seit 14:20');
});

describe('anwesenheitKurz', () => {
  test('alle da ist eine Antwort', () => {
    expect(anwesenheitKurz([{ name: 'A', state: 'home' }, { name: 'B', state: 'home' }])).toBe(
      'Alle zuhause'
    );
  });

  test('niemand da ebenso', () => {
    expect(anwesenheitKurz([{ name: 'A', state: 'away' }])).toBe('Niemand zuhause');
  });

  test('Unbekanntes wird nicht als «weg» verkauft', () => {
    expect(
      anwesenheitKurz([
        { name: 'Sandra', state: 'home' },
        { name: 'Livia', state: 'unknown' },
      ])
    ).toBe('Sandra zuhause · 1 unbekannt');
  });
});

describe('Pause', () => {
  test('«bis morgen» heisst morgen früh, nicht in 24 Stunden', () => {
    const bis = pauseBis('morgen', JETZT);
    expect(bis.getDate()).toBe(23);
    expect(bis.getHours()).toBe(6);
  });

  test('zwei Stunden sind zwei Stunden', () => {
    expect(pauseBis('2h', JETZT).getHours()).toBe(18);
  });

  test('pausiert gilt nur, solange sie läuft', () => {
    expect(pausiert(JETZT.getTime() + 60000, JETZT)).toBe(true);
    expect(pausiert(JETZT.getTime() - 60000, JETZT)).toBe(false);
    expect(pausiert(undefined, JETZT)).toBe(false);
  });
});

describe('ortungsHinweis', () => {
  test('sagt, dass es läuft und wer es sieht', () => {
    expect(ortungsHinweis(true, null, JETZT, ['Sandra', 'Stefan'])).toBe(
      'Deine Ortung läuft. Sichtbar für: Sandra, Stefan.'
    );
  });

  test('eine Pause ist eine Pause, kein Verstecken', () => {
    expect(ortungsHinweis(true, JETZT.getTime() + 7200000, JETZT, [])).toBe(
      'Ortung pausiert bis 18:00.'
    );
  });

  test('aus ist aus', () => {
    expect(ortungsHinweis(false, null, JETZT, [])).toContain('ist aus');
  });
});

// ── Ortung nie eingerichtet vs. Telefon schweigt ─────────────────────────
// Die Liste steht für die Benutzer des Hubs. Wer keine Geofence-Zone hat,
// kann sich gar nicht melden – das ist keine Störung, sondern eine offene
// Aufgabe, und wer darauf wartet, wartet ewig.

it('says plainly when a user has no zone at all', () => {
  expect(zustandText({ state: 'unknown', configured: false })).toBe(
    'Ortung nicht eingerichtet'
  );
});

it('keeps the old wording when the zone exists but stays quiet', () => {
  expect(zustandText({ state: 'unknown', configured: true })).toBe('meldet sich nicht');
  // Ältere Hub-Fassungen schicken das Feld nicht mit.
  expect(zustandText({ state: 'unknown' })).toBe('meldet sich nicht');
});

it('does not mention the setup once someone is actually home', () => {
  expect(zustandText({ state: 'home', configured: false })).toBe('zuhause');
});
