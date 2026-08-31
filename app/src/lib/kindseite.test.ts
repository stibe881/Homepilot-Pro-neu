/**
 * Die Kinderseite – und die zwei Stellen, an denen sie danebengreifen kann.
 *
 * Der Name im Termin ist die eine: «Lina» steckt in «Carolina». Die
 * andere ist der Wochentag, der schon vorbei ist – «heute, 17:30» am
 * Dienstagabend stimmt und nützt nichts.
 */
import {
  heute,
  heuteSatz,
  istKind,
  kindTermine,
  minuten,
  naechstesMal,
  nenntPerson,
  blockHoehe,
  fuerWoche,
  kalenderwoche,
  naechsteWocheFach,
  nachmittagFrei,
  tagesplanMitPausen,
  wocheVon,
  zuUebernehmen,
  schulzeit,
  verschmelze,
  wochenliste,
  wochenplan,
  zeitNormal,
  zeitraum,
} from './kindseite';

// Ein Dienstag, 16:00.
const DIENSTAG = new Date('2026-09-01T16:00:00');

describe('istKind', () => {
  it('nimmt nur die eingetragenen Kinder', () => {
    expect(istKind({ role: 'kind', ohneZugang: true })).toBe(true);
    expect(istKind({ role: 'erwachsen', ohneZugang: true })).toBe(false);
    // Das Wandtablet in der Küche steht mit «bewohner» im selben Raster.
    expect(istKind({ role: 'bewohner' })).toBe(false);
  });
});

describe('nenntPerson', () => {
  it('findet den Namen als Wort', () => {
    expect(nenntPerson('Zahnarzt Levin', 'Levin')).toBe(true);
    expect(nenntPerson('Levin, Zahnarzt', 'Levin')).toBe(true);
  });

  it('versteht den Genitiv', () => {
    expect(nenntPerson('Levins Fussballmatch', 'Levin')).toBe(true);
    expect(nenntPerson("Levin's birthday", 'Levin')).toBe(true);
  });

  it('greift nicht in fremde Namen hinein', () => {
    // Ein Zahnarzttermin im falschen Kind ist schlimmer als keiner.
    expect(nenntPerson('Carolina Geburtstag', 'Lina')).toBe(false);
    // Dieselbe Regel kostet das zusammengeschriebene Wort: «Levinturnier»
    // findet niemand. Auf Deutsch schreibt man «Levins Turnier», und der
    // Fall ist billiger als der falsche Treffer.
    expect(nenntPerson('Linaturnen', 'Lina')).toBe(false);
  });

  it('schweigt ohne Namen', () => {
    expect(nenntPerson('Irgendwas', '  ')).toBe(false);
  });
});

describe('kindTermine', () => {
  const events = [
    { id: 'a', summary: 'Zahnarzt Levin', start: '2026-09-03T09:00:00' },
    { id: 'b', summary: 'Elternabend', start: '2026-09-02T19:00:00' },
    { id: 'c', summary: 'Levins Turnier', start: '2026-09-02T08:00:00' },
    { id: 'd', summary: 'Levin beim Kieferorthopäden', start: '2026-08-01T08:00:00' },
  ];

  it('nimmt nur die eigenen und stellt sie der Reihe nach', () => {
    expect(kindTermine(events, 'Levin', DIENSTAG).map((e) => e.id)).toEqual(['c', 'a']);
  });

  it('lässt Vergangenes weg, den heutigen Morgen aber stehen', () => {
    const heutefrueh = [{ id: 'e', summary: 'Levin Turnen', start: '2026-09-01T08:00:00' }];
    expect(kindTermine(heutefrueh, 'Levin', DIENSTAG).map((e) => e.id)).toEqual(['e']);
  });

  it('verträgt gar keine Termine', () => {
    expect(kindTermine(null, 'Levin', DIENSTAG)).toEqual([]);
  });
});

describe('minuten und zeitNormal', () => {
  it('nimmt den Punkt wie den Doppelpunkt', () => {
    expect(minuten('8.20')).toBe(500);
    expect(zeitNormal('8.20')).toBe('08:20');
  });

  it('weist Unsinn ab', () => {
    expect(minuten('25:00')).toBeNull();
    expect(minuten('halb neun')).toBeNull();
    expect(zeitNormal('')).toBeNull();
  });

  it('schreibt einen Zeitraum', () => {
    expect(zeitraum('8:20', '9:05')).toBe('08:20–09:05');
    expect(zeitraum('8:20', '')).toBe('08:20');
    expect(zeitraum('', '9:05')).toBe('');
  });
});

describe('wochenplan', () => {
  const lektionen = [
    { member: 'Levin', day: 'Mo', from: '09:15', text: 'Deutsch' },
    { member: 'Levin', day: 'Mo', from: '08:20', text: 'Mathematik' },
    { member: 'Lina', day: 'Mo', from: '08:20', text: 'Turnen' },
    { member: 'Levin', day: 'Mi', from: '08:20', text: 'Werken' },
  ];

  it('ordnet nach Tag und Zeit und lässt leere Tage weg', () => {
    const plan = wochenplan(lektionen, 'Levin');
    expect(plan.map((block) => block.name)).toEqual(['Montag', 'Mittwoch']);
    expect(plan[0].zeilen.map((zeile) => zeile.text)).toEqual(['Mathematik', 'Deutsch']);
  });
});

describe('schulzeit', () => {
  const lektionen = [
    { member: 'Levin', day: 'Di', from: '08:20', to: '09:05', text: 'Mathematik' },
    { member: 'Levin', day: 'Di', from: '13:30', to: '15:05', text: 'Sport' },
  ];

  it('spannt vom ersten Anfang bis zum letzten Ende', () => {
    expect(schulzeit(lektionen, 'Levin', DIENSTAG)).toBe('08:20–15:05');
  });

  it('schweigt am schulfreien Tag', () => {
    const mittwoch = new Date('2026-09-02T07:00:00');
    expect(schulzeit(lektionen, 'Levin', mittwoch)).toBeNull();
  });
});

describe('naechstesMal', () => {
  it('sagt heute, solange es noch kommt', () => {
    expect(naechstesMal({ day: 'Di', from: '17:30' }, DIENSTAG)).toBe('heute, 17:30');
  });

  it('zählt weiter, wenn es heute schon war', () => {
    // Am Dienstagabend nützt «heute, 15:00» niemandem mehr.
    expect(naechstesMal({ day: 'Di', from: '15:00' }, DIENSTAG)).toBe('Dienstag, 15:00');
  });

  it('nennt morgen beim Namen', () => {
    expect(naechstesMal({ day: 'Mi', from: '17:00' }, DIENSTAG)).toBe('morgen, 17:00');
  });

  it('verträgt einen Eintrag ohne Tag', () => {
    expect(naechstesMal({ from: '17:00' }, DIENSTAG)).toBe('17:00');
  });
});

describe('heute und wochenliste', () => {
  const termine = [
    { member: 'Levin', day: 'Fr', from: '18:00', text: 'Jugi' },
    { member: 'Levin', day: 'Di', from: '17:30', text: 'Fussball' },
    { member: 'Lina', day: 'Di', from: '16:00', text: 'Ballett' },
  ];

  it('nimmt für heute nur den heutigen Tag', () => {
    expect(heute(termine, 'Levin', DIENSTAG).map((z) => z.text)).toEqual(['Fussball']);
  });

  it('stellt die Woche in ihre Reihenfolge', () => {
    expect(wochenliste(termine, 'Levin').map((z) => z.text)).toEqual(['Fussball', 'Jugi']);
  });
});

describe('heuteSatz', () => {
  const lektionen = [{ member: 'Levin', day: 'Di', from: '08:20', to: '15:05' }];
  const termine = [{ member: 'Levin', day: 'Di', from: '17:30', text: 'Fussball' }];

  it('fasst den Tag in eine Zeile', () => {
    expect(heuteSatz(lektionen, termine, 'Levin', DIENSTAG)).toBe(
      'Schule 08:20–15:05 · Fussball 17:30'
    );
  });

  it('sagt auch, wenn nichts ist', () => {
    // Eine leere Zeile sähe aus, als wäre etwas nicht geladen.
    expect(heuteSatz([], [], 'Levin', DIENSTAG)).toBe('Heute steht nichts an.');
  });
});

describe('verschmelze', () => {
  it('nimmt denselben Termin nur einmal', () => {
    // Entität und Monatsabruf überschneiden sich – zweimal derselbe
    // Termin sieht aus wie ein Fehler in der Kalender-Anbindung.
    const a = [{ id: '1', summary: 'Turnen' }];
    const b = [{ id: '1', summary: 'Turnen' }, { id: '2', summary: 'Zahnarzt' }];
    expect(verschmelze(a, b).map((e) => e.id)).toEqual(['1', '2']);
  });

  it('unterscheidet ohne Kennung nach Titel und Beginn', () => {
    const a = [{ summary: 'Turnen', start: 'x' }];
    const b = [{ summary: 'Turnen', start: 'y' }];
    expect(verschmelze(a, b, null)).toHaveLength(2);
  });
});

// ── Tagesplan mit Pausen und laufender Stunde ────────────────────────────

describe('tagesplanMitPausen', () => {
  const lektion = (from: string, to: string, text = 'Alle') => ({
    id: `${from}`,
    member: 'Levin',
    day: 'Mo',
    text,
    from,
    to,
  });
  // Der Plan aus dem Bild: 5 Minuten Zimmerwechsel, 20 Minuten grosse
  // Pause, und zwischen 11:30 und 13:25 der Mittag.
  const plan = [
    lektion('08:00', '08:45'),
    lektion('08:50', '09:35'),
    lektion('09:55', '10:40'),
    lektion('10:45', '11:30'),
    lektion('13:25', '14:10'),
  ];

  it('legt die grosse Pause und den Mittag zwischen die Lektionen', () => {
    const arten = tagesplanMitPausen(plan, null).map((zeile) =>
      zeile.art === 'pause' ? zeile.titel : 'Lektion'
    );
    // 5 Minuten Zimmerwechsel erscheinen nicht; 20 Minuten sind die
    // grosse Pause, 70 Minuten der Mittag.
    expect(arten).toEqual([
      'Lektion',
      'Lektion',
      'Grosse Pause',
      'Lektion',
      'Lektion',
      'Mittag',
      'Lektion',
    ]);
    const mittag = tagesplanMitPausen(plan, null).find(
      (zeile) => zeile.art === 'pause' && zeile.titel === 'Mittag'
    );
    expect(mittag && mittag.art === 'pause' ? mittag.von : '').toBe('11:30');
  });

  it('markiert die laufende Lektion - und die laufende Pause', () => {
    const um = (zeit: string) => {
      const wert = minuten(zeit) as number;
      return tagesplanMitPausen(plan, wert).filter((zeile) => zeile.laeuft);
    };
    const inStunde = um('08:10');
    expect(inStunde).toHaveLength(1);
    expect(inStunde[0].art).toBe('lektion');
    const inPause = um('09:45');
    expect(inPause).toHaveLength(1);
    expect(inPause[0].art === 'pause' && inPause[0].titel).toBe('Grosse Pause');
    // Nicht heute (null): nichts läuft.
    expect(tagesplanMitPausen(plan, null).some((zeile) => zeile.laeuft)).toBe(false);
  });

  it('nimmt für eine Lektion ohne Ende 45 Minuten an', () => {
    const offen = [{ member: 'Levin', day: 'Mo', text: 'Turnen', from: '08:00', to: '' }];
    expect(tagesplanMitPausen(offen, minuten('08:30') as number)[0].laeuft).toBe(true);
    expect(tagesplanMitPausen(offen, minuten('08:50') as number)[0].laeuft).toBe(false);
  });
});

describe('zuUebernehmen', () => {
  it('übernimmt nur, was am Zieltag noch fehlt', () => {
    const montag = [
      { text: 'Mathematik', from: '08:00', to: '08:45' },
      { text: 'Deutsch', from: '08:50', to: '09:35' },
    ];
    const dienstag = [{ text: 'Mathematik', from: '08:00', to: '08:45' }];
    const neu = zuUebernehmen(montag, dienstag);
    expect(neu).toHaveLength(1);
    expect(neu[0].text).toBe('Deutsch');
    expect(zuUebernehmen(montag, [])).toHaveLength(2);
  });
});

describe('nachmittagFrei und blockHoehe', () => {
  it('meldet den freien Nachmittag mit der Uhrzeit ab wann', () => {
    const morgen = [
      { text: 'Mathe', from: '08:00', to: '08:45' },
      { text: 'Deutsch', from: '10:45', to: '11:30' },
    ];
    expect(nachmittagFrei(morgen)).toBe('11:30');
    // Mit einer Nachmittagslektion ist nichts frei.
    expect(
      nachmittagFrei([...morgen, { text: 'Turnen', from: '13:25', to: '14:10' }])
    ).toBeNull();
    // Ohne Lektionen ist der ganze Tag frei - das sagt schon der leere
    // Plan, kein zusätzlicher Balken nötig.
    expect(nachmittagFrei([])).toBeNull();
  });

  it('macht Blöcke proportional, aber lesbar', () => {
    expect(blockHoehe('08:00', '08:45', 44, 96)).toBe(50);
    expect(blockHoehe('08:00', '09:30', 44, 96)).toBe(96); // Doppellektion, gedeckelt
    expect(blockHoehe('09:35', '09:40', 26, 54)).toBe(26); // Zimmerwechsel, Mindestmass
    expect(blockHoehe('kaputt', '', 44, 96)).toBe(50); // 45 Minuten angenommen
  });
});

// ── A/B-Wochen ───────────────────────────────────────────────────────────

describe('Zweiwochen-Fächer', () => {
  it('kennt die Kalenderwoche nach ISO', () => {
    expect(kalenderwoche(new Date(2026, 0, 1))).toBe(1); // Do, 1.1.2026
    expect(kalenderwoche(new Date(2026, 7, 30))).toBe(35); // So, 30.8.
    expect(kalenderwoche(new Date(2026, 7, 31))).toBe(36); // Mo, 31.8.
    // Silvesterwoche gehört zum neuen Jahr, wenn ihr Donnerstag dort liegt.
    expect(kalenderwoche(new Date(2024, 11, 30))).toBe(1); // Mo, 30.12.2024 → KW 1/2025
  });

  it('macht aus ungeraden Wochen «A» und geraden «B»', () => {
    expect(wocheVon(new Date(2026, 7, 30))).toBe('A'); // KW 35
    expect(wocheVon(new Date(2026, 7, 31))).toBe('B'); // KW 36
  });

  it('zeigt in Woche A nur, was jede Woche oder in A stattfindet', () => {
    const zeilen = [
      { text: 'Mathe', from: '08:00' },
      { text: 'Handarbeit', from: '10:00', week: 'A' },
      { text: 'Werken', from: '10:00', week: 'B' },
    ];
    expect(fuerWoche(zeilen, 'A').map((zeile) => zeile.text)).toEqual([
      'Mathe',
      'Handarbeit',
    ]);
    expect(fuerWoche(zeilen, 'B').map((zeile) => zeile.text)).toEqual([
      'Mathe',
      'Werken',
    ]);
  });

  it('nennt das Fach der anderen Woche an derselben Stelle', () => {
    const tag = [
      { text: 'Handarbeit', from: '10:00', week: 'A' },
      { text: 'Werken', from: '10:00', week: 'B' },
      { text: 'Mathe', from: '08:00' },
    ];
    expect(naechsteWocheFach(tag[0], tag)).toBe('Werken');
    // Ohne Gegenstück ist nächste Woche schlicht frei.
    expect(naechsteWocheFach({ text: 'Chor', from: '12:00', week: 'A' }, tag)).toBeNull();
    // Ein Jede-Woche-Fach hat keine «andere Woche».
    expect(naechsteWocheFach(tag[2], tag)).toBeNull();
  });

  it('übernimmt A- und B-Zeilen getrennt', () => {
    const quelle = [
      { text: 'Handarbeit', from: '10:00', week: 'A' },
      { text: 'Werken', from: '10:00', week: 'B' },
    ];
    expect(zuUebernehmen(quelle, [{ text: 'Handarbeit', from: '10:00', week: 'A' }])).toHaveLength(1);
  });
});
