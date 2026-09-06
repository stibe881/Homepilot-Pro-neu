import {
  anlassName,
  clipAbschnitte,
  clipLeerbild,
  clipUrl,
  fristText,
  groesseText,
} from './cliparchiv';

describe('clipUrl', () => {
  it('haengt das Token an, weil Videoplayer keine Kopfzeilen schicken', () => {
    expect(clipUrl('http://hub:8123', 'geheim', '20260905-120000-abcd1234')).toBe(
      'http://hub:8123/api/clips/20260905-120000-abcd1234?token=geheim'
    );
  });

  it('schuetzt Sonderzeichen im Token', () => {
    expect(clipUrl('http://hub', 'a&b', 'x')).toContain('token=a%26b');
  });
});

describe('anlassName', () => {
  it('uebersetzt die bekannten Anlaesse', () => {
    expect(anlassName('alarm')).toBe('Alarm');
  });

  it('macht Unbekanntes lesbar statt es zu verstecken', () => {
    expect(anlassName('doorbell')).toBe('Doorbell');
    expect(anlassName('')).toBe('Aufnahme');
  });
});

describe('groesseText', () => {
  it('nennt Megabyte mit einer Stelle, grosse ohne', () => {
    expect(groesseText(2.44 * 1024 * 1024)).toBe('2.4 MB');
    expect(groesseText(12.6 * 1024 * 1024)).toBe('13 MB');
  });

  it('faellt unter einem Megabyte auf Kilobyte zurueck', () => {
    expect(groesseText(340 * 1024)).toBe('340 KB');
  });

  it('schweigt bei Unsinn statt «NaN MB» zu zeigen', () => {
    expect(groesseText(0)).toBe('');
    expect(groesseText(Number.NaN)).toBe('');
  });
});

describe('clipAbschnitte', () => {
  it('gruppiert nach Tagen wie der Rueckblick', () => {
    const jetzt = Date.parse('2026-09-05T12:00:00');
    const clip = (id: string, at: number) => ({
      id,
      camera: 'cam.tuer',
      name: 'Haustüre',
      anlass: 'alarm',
      at,
      bytes: 1000,
    });
    const heute = jetzt / 1000 - 3600;
    const gestern = jetzt / 1000 - 86400;
    const abschnitte = clipAbschnitte(
      [clip('a', heute), clip('b', heute - 60), clip('c', gestern)],
      jetzt
    );
    expect(abschnitte.map((abschnitt) => abschnitt.titel)).toEqual(['Heute', 'Gestern']);
    expect(abschnitte[0].clips).toHaveLength(2);
  });

  it('bleibt bei einer leeren Liste leer', () => {
    expect(clipAbschnitte([])).toEqual([]);
  });
});

describe('fristText', () => {
  it('beugt den Tag richtig', () => {
    expect(fristText(1)).toBe('1 Tag');
    expect(fristText(14)).toBe('14 Tage');
  });
});

describe('clipLeerbild', () => {
  it('erklaert, wie hier etwas hinkommt', () => {
    const bild = clipLeerbild();
    expect(bild.titel).toBe('Noch keine Aufnahmen');
    expect(bild.satz).toContain('Alarm');
  });
});
