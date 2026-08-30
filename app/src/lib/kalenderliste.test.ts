/**
 * Die zwei Listen hinter den Kacheln «Nächster Termin» und «Nächster
 * Geburtstag».
 */
import {
  alsZeitpunkt,
  geburtstagsName,
  gruppenTitel,
  terminGruppen,
  geburtstagsListe,
  istGeburtstag,
  tageBis,
  tageBisText,
  terminListe,
  terminWann,
} from './kalenderliste';

// Ein Dienstag, damit die Wochentage prüfbar sind.
const JETZT = new Date('2026-08-25T09:00:00');

describe('istGeburtstag', () => {
  it('glaubt dem Kalender, wenn er es selbst sagt', () => {
    expect(istGeburtstag({ birthday: true, summary: 'Levin' })).toBe(true);
  });

  it('erkennt es sonst am Titel', () => {
    // Viele Kalender kennen kein eigenes Feld dafür.
    expect(istGeburtstag({ summary: 'Geburtstag Lina' })).toBe(true);
    expect(istGeburtstag({ summary: 'Birthday Levin' })).toBe(true);
  });

  it('hält einen Zahnarzttermin nicht dafür', () => {
    expect(istGeburtstag({ summary: 'Zahnarzt' })).toBe(false);
    expect(istGeburtstag({})).toBe(false);
  });
});

describe('alsZeitpunkt', () => {
  it('setzt ein reines Datum auf Mittag', () => {
    // Sonst schöbe die Zeitzone die Tageszahl um einen Tag.
    expect(alsZeitpunkt('2026-08-20')?.getHours()).toBe(12);
  });

  it('lässt einen vollen Zeitstempel in Ruhe', () => {
    expect(alsZeitpunkt('2026-08-20T14:30:00')?.getHours()).toBe(14);
  });

  it('antwortet auf Unsinn mit null statt mit einem kaputten Datum', () => {
    expect(alsZeitpunkt('irgendwas')).toBeNull();
    expect(alsZeitpunkt('')).toBeNull();
    expect(alsZeitpunkt(null)).toBeNull();
  });
});

describe('tageBisText', () => {
  it('zählt in ganzen Tagen, nicht in Stunden', () => {
    // 09:00 heute bis 08:00 morgen ist «morgen», nicht «heute».
    expect(tageBisText('2026-08-26T08:00:00', JETZT)).toBe('morgen');
  });

  it('feiert den heutigen Tag', () => {
    expect(tageBisText('2026-08-25', JETZT)).toBe('heute! 🎉');
  });

  it('nennt alles Weitere in Tagen', () => {
    expect(tageBisText('2026-09-06', JETZT)).toBe('in 12 Tagen');
  });

  it('behandelt Vergangenes wie heute, statt negativ zu zählen', () => {
    expect(tageBisText('2026-08-01', JETZT)).toBe('heute! 🎉');
    expect(tageBis('2026-08-01', JETZT)).toBe(-24);
  });
});

describe('terminWann', () => {
  it('lässt heute und morgen ohne Datum stehen', () => {
    expect(terminWann({ start: '2026-08-25T14:30:00' }, JETZT)).toBe('heute, 14:30');
    expect(terminWann({ start: '2026-08-26T09:15:00' }, JETZT)).toBe('morgen, 09:15');
  });

  it('nennt in dieser Woche nur den Wochentag', () => {
    // Freitag – in einer langen Liste ist das der Unterschied zwischen
    // Lesen und Suchen.
    expect(terminWann({ start: '2026-08-28T18:00:00' }, JETZT)).toBe('Fr, 18:00');
  });

  it('nennt weiter weg das Datum', () => {
    expect(terminWann({ start: '2026-09-15T08:00:00' }, JETZT)).toContain('15.');
  });

  it('schreibt bei ganztägigen Terminen keine Uhrzeit hin', () => {
    expect(terminWann({ start: '2026-08-26', all_day: true }, JETZT)).toBe(
      'morgen · ganztägig'
    );
  });

  it('bleibt bei einem kaputten Datum leer', () => {
    expect(terminWann({ start: 'kaputt' }, JETZT)).toBe('');
  });
});

describe('terminListe', () => {
  const events = [
    { uid: 'a', summary: 'Zahnarzt', start: '2026-08-25T14:30:00', location: 'Zell' },
    { uid: 'b', summary: 'Geburtstag Lina', start: '2026-09-06', birthday: true },
    { uid: 'c', summary: 'Elternabend', start: '2026-08-28T19:00:00' },
  ];

  it('lässt die Geburtstage weg – die haben ihre eigene Liste', () => {
    expect(terminListe(events, JETZT).map((z) => z.titel)).toEqual([
      'Zahnarzt',
      'Elternabend',
    ]);
  });

  it('nimmt den Ort mit, wo einer steht', () => {
    const [erster, zweiter] = terminListe(events, JETZT);
    expect(erster.ort).toBe('Zell');
    expect(zweiter.ort).toBeNull();
  });

  it('gibt einem Termin ohne Titel trotzdem eine lesbare Zeile', () => {
    expect(terminListe([{ start: '2026-08-25T10:00:00' }], JETZT)[0].titel).toBe(
      'Ohne Titel'
    );
  });

  it('verträgt eine fehlende Liste', () => {
    expect(terminListe(null, JETZT)).toEqual([]);
  });
});

describe('geburtstagsListe', () => {
  it('stellt den nächsten nach vorn, egal wie der Kalender sortiert', () => {
    // Wer nachsieht, wann Levin Geburtstag hat, will nicht scrollen.
    const events = [
      { uid: 'a', summary: 'Geburtstag Lina', start: '2026-12-24' },
      { uid: 'b', summary: 'Geburtstag Levin', start: '2026-08-30' },
      { uid: 'c', summary: 'Zahnarzt', start: '2026-08-26T09:00:00' },
    ];
    expect(geburtstagsListe(events, JETZT).map((z) => z.titel)).toEqual([
      'Geburtstag Levin',
      'Geburtstag Lina',
    ]);
  });

  it('schreibt den Abstand in Tagen dazu', () => {
    expect(
      geburtstagsListe([{ summary: 'Geburtstag Levin', start: '2026-08-30' }], JETZT)[0].wann
    ).toBe('in 5 Tagen');
  });

  it('schiebt einen ohne lesbares Datum ans Ende statt ihn zu verlieren', () => {
    const zeilen = geburtstagsListe(
      [
        { uid: 'x', summary: 'Geburtstag Ohne Datum', start: null },
        { uid: 'y', summary: 'Geburtstag Levin', start: '2026-08-30' },
      ],
      JETZT
    );
    expect(zeilen.map((z) => z.titel)).toEqual([
      'Geburtstag Levin',
      'Geburtstag Ohne Datum',
    ]);
    expect(zeilen[1].wann).toBe('');
  });
});

describe('gruppenTitel', () => {
  const jetzt = new Date('2026-08-30T12:00:00'); // Sonntag

  it('sagt Heute und Morgen statt eines Datums', () => {
    expect(gruppenTitel('2026-08-30T18:00:00', jetzt)).toBe('Heute');
    expect(gruppenTitel('2026-08-31T09:00:00', jetzt)).toBe('Morgen');
  });

  it('bleibt in der Woche beim Wochentag und hängt danach das Datum an', () => {
    expect(gruppenTitel('2026-09-02T10:00:00', jetzt)).toBe('Mittwoch');
    expect(gruppenTitel('2026-09-06T08:00:00', jetzt)).toBe('Sonntag, 6. September');
  });
});

describe('terminGruppen', () => {
  it('bündelt die Termine nach Tagen, in Kalender-Reihenfolge', () => {
    const jetzt = new Date('2026-08-30T12:00:00');
    const gruppen = terminGruppen(
      [
        { summary: 'Jugi', start: '2026-08-31T18:00:00' },
        { summary: 'Elternabend', start: '2026-09-01', all_day: true },
        { summary: 'Pro Senectute', start: '2026-09-01T10:00:00' },
      ],
      jetzt
    );
    expect(gruppen.map((gruppe) => gruppe.titel)).toEqual(['Morgen', 'Dienstag']);
    expect(gruppen[1].zeilen.map((zeile) => zeile.zeit)).toEqual([null, '10:00']);
  });

  it('lässt Geburtstage draussen - die haben ihre eigene Liste', () => {
    const jetzt = new Date('2026-08-30T12:00:00');
    expect(
      terminGruppen([{ summary: 'Levin Geburtstag', start: '2026-09-01' }], jetzt)
    ).toEqual([]);
  });
});

describe('geburtstagsName', () => {
  it('löst den Namen aus den üblichen Satzformen', () => {
    expect(geburtstagsName('Flo hat Geburtstag')).toBe('Flo');
    expect(geburtstagsName('Geburtstag von Flo')).toBe('Flo');
    expect(geburtstagsName("Flo's birthday")).toBe('Flo');
    expect(geburtstagsName('Flo – Geburtstag')).toBe('Flo');
  });

  it('lässt einen Titel ohne Muster, wie er ist', () => {
    expect(geburtstagsName('Oma Grosstante')).toBe('Oma Grosstante');
    expect(geburtstagsName('')).toBe('Ohne Titel');
  });
});

describe('geburtstagsListe', () => {
  it('zeigt höchstens zehn, den nächsten zuerst, mit Datumzeile', () => {
    const jetzt = new Date('2026-08-30T12:00:00');
    const events = Array.from({ length: 14 }, (_, i) => ({
      summary: `Person ${i} hat Geburtstag`,
      start: `2026-09-${String(i + 1).padStart(2, '0')}`,
      birthday: true,
    }));
    const liste = geburtstagsListe(events, jetzt);
    expect(liste).toHaveLength(10);
    expect(liste[0].titel).toBe('Person 0');
    expect(liste[0].datum).toContain('September');
  });
});

