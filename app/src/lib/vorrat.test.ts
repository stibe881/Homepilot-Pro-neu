/**
 * Standardartikel mit Takt.
 *
 * Der Anlass: Kaffee und Waschmittel fallen erst auf, wenn die Packung
 * leer ist – und dann steht man in der Küche und nicht im Laden.
 */
import {
  MAX_TAGE,
  naechsteWahl,
  naechster,
  schritt,
  takt,
  taktLabel,
  vorratSatz,
} from './vorrat';

const TAG = 86_400_000;
const JETZT = Date.UTC(2026, 7, 28, 12);

describe('takt', () => {
  it('nimmt einen gültigen Abstand', () => {
    expect(takt({ days: 21 })).toBe(21);
  });

  it('lässt einen Artikel ohne Takt ein blosser Knopf sein', () => {
    expect(takt({ text: 'Brot' })).toBeNull();
    expect(takt(null)).toBeNull();
  });

  it('weist Unsinn ab, statt daran zu scheitern', () => {
    expect(takt({ days: 0 })).toBeNull();
    expect(takt({ days: 'bald' })).toBeNull();
    expect(takt({ days: MAX_TAGE + 1 })).toBeNull();
  });
});

describe('taktLabel', () => {
  it('nennt die üblichen Takte beim Namen', () => {
    expect(taktLabel(30)).toBe('monatlich');
  });

  it('sagt bei krummen Werten die Tage', () => {
    expect(taktLabel(21)).toBe('alle 21 Tage');
  });
});

describe('naechster', () => {
  it('ist ohne bekannten Einkauf sofort', () => {
    // Wer einen Takt einstellt, will nicht erst einen Durchgang lang
    // zusehen.
    expect(naechster({ days: 30 }, JETZT)).toBe(JETZT);
  });

  it('zählt ab dem Einkauf', () => {
    expect(naechster({ days: 30, last: JETZT / 1000 }, JETZT)).toBe(JETZT + 30 * TAG);
  });
});

describe('vorratSatz', () => {
  it('nennt Takt und nächsten Termin', () => {
    const artikel = { days: 30, last: JETZT / 1000 };
    expect(vorratSatz(artikel, JETZT + 26 * TAG)).toBe('Monatlich · in 4 Tagen');
    expect(vorratSatz(artikel, JETZT + 29 * TAG)).toBe('Monatlich · morgen');
    expect(vorratSatz(artikel, JETZT + 31 * TAG)).toBe('Monatlich · jetzt fällig');
  });

  it('schweigt ohne Takt', () => {
    expect(vorratSatz({ text: 'Brot' }, JETZT)).toBeNull();
  });
});

describe('naechsteWahl', () => {
  it('setzt einen Takt', () => {
    expect(naechsteWahl({ days: 7 }, 30)).toBe(30);
  });

  it('hebt ihn beim zweiten Antippen wieder auf', () => {
    // Sonst käme man aus einem einmal gesetzten Takt nicht mehr heraus,
    // ohne den Artikel zu löschen.
    expect(naechsteWahl({ days: 30 }, 30)).toBeNull();
  });
});

describe('schritt', () => {
  it('stellt feiner', () => {
    expect(schritt({ days: 21 }, 1)).toBe(22);
    expect(schritt({ days: 21 }, -1)).toBe(20);
  });

  it('fängt ohne Takt bei einer Woche an', () => {
    expect(schritt({ text: 'Brot' }, 1)).toBe(8);
  });

  it('bleibt in den Grenzen', () => {
    expect(schritt({ days: 1 }, -1)).toBe(1);
    expect(schritt({ days: MAX_TAGE }, 1)).toBe(MAX_TAGE);
  });
});
