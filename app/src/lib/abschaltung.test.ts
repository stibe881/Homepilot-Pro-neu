/** Die Restzeit: «geht in 12 Min aus». */

import {
  abschaltSatz,
  naechsteAbschaltung,
  restSekunden,
  restText,
} from './abschaltung';

const JETZT = 1_000_000_000_000; // Millisekunden
const SEK = JETZT / 1000;

describe('restSekunden', () => {
  it('rechnet die Sekunden bis zum Zeitpunkt', () => {
    expect(restSekunden(SEK + 90, JETZT)).toBe(90);
  });

  it('schweigt, sobald es vorbei ist', () => {
    expect(restSekunden(SEK, JETZT)).toBeNull();
    expect(restSekunden(SEK - 5, JETZT)).toBeNull();
  });

  it('schweigt bei allem, was keine Zahl ist', () => {
    expect(restSekunden(undefined, JETZT)).toBeNull();
    expect(restSekunden(null, JETZT)).toBeNull();
    expect(restSekunden('gleich', JETZT)).toBeNull();
  });
});

describe('restText', () => {
  it('bleibt unter einer Minute bei Sekunden', () => {
    expect(restText(45)).toBe('45 s');
  });

  it('rundet Minuten auf - «noch 0 Min» wäre gelogen', () => {
    expect(restText(61)).toBe('2 Min');
    expect(restText(1800)).toBe('30 Min');
  });

  it('rechnet Stunden aus, statt 92 Minuten zu melden', () => {
    expect(restText(3600)).toBe('1 Std');
    expect(restText(5520)).toBe('1 Std 32 Min');
  });
});

describe('abschaltSatz', () => {
  it('sagt in einem Satz, was los ist', () => {
    expect(abschaltSatz({ off_at: SEK + 720 }, JETZT)).toBe('geht in 12 Min aus');
  });

  it('sagt nichts ohne Frist', () => {
    expect(abschaltSatz({}, JETZT)).toBeNull();
    expect(abschaltSatz(null, JETZT)).toBeNull();
  });
});

describe('naechsteAbschaltung', () => {
  it('nimmt die nächste - sie ist die Auskunft, auf die es ankommt', () => {
    const rest = naechsteAbschaltung(
      [
        { state: { off_at: SEK + 1500 } },
        { state: { off_at: SEK + 180 } },
        { state: {} },
      ],
      JETZT
    );
    expect(rest).toBe(180);
  });

  it('bleibt still, wenn keine läuft', () => {
    expect(naechsteAbschaltung([{ state: {} }], JETZT)).toBeNull();
    expect(naechsteAbschaltung([], JETZT)).toBeNull();
  });
});
