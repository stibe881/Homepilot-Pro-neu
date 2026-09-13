/**
 * Die Kinderseite – und die zwei Stellen, an denen sie danebengreifen kann.
 *
 * Der Name im Termin ist die eine: «Lina» steckt in «Carolina». Die
 * andere ist der Wochentag, der schon vorbei ist – «heute, 17:30» am
 * Dienstagabend stimmt und nützt nichts.
 */
import {
  aemtliAbgeben,
  aktivitaetZeile,
  aktivitaetenAm,
  fahrtSatz,
  fahrtUnbesetzt,
  ferienSatz,
  ferienpause,
  geburtstagInTagen,
  geburtstagSatz,
  heute,
  heuteSatz,
  kinderHeute,
  ferienAm,
  schulzeileAm,
  morgenPackSatz,
  istKind,
  kindTermine,
  krankBis,
  krankSatz,
  minuten,
  naechstesMal,
  nenntPerson,
  blockHoehe,
  fuerWoche,
  kalenderwoche,
  naechsteWocheFach,
  nachmittagFrei,
  rasterLage,
  tagesplanMitPausen,
  zeitraster,
  MINUTE_PUNKTE,
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
  it('nimmt die eingetragenen Kinder', () => {
    expect(istKind({ role: 'kind', ohneZugang: true })).toBe(true);
    expect(istKind({ role: 'erwachsen', ohneZugang: true })).toBe(false);
    // Das Wandtablet in der Küche steht mit «bewohner» im selben Raster.
    expect(istKind({ role: 'bewohner' })).toBe(false);
  });

  it('nimmt auch das Kind mit eigenem Zugang', () => {
    // Gemeldet als «Weshalb kann Levin keine Sterne sammeln?»: Er hat
    // ein Konto mit der Hub-Rolle «kind» und stand deshalb nicht in den
    // Familienlisten - er zählte nirgends als Kind, während seine
    // Schwester ohne Konto Sterne und eine eigene Seite hatte.
    expect(istKind({ role: 'kind' })).toBe(true);
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

  it('lässt in den Ferien die Schule weg und nur das stehen, was dann gilt', () => {
    // Punkt 620: «Schule 08:20–15:05» stand direkt über «Gerade sind
    // Herbstferien - keine Schule!» - zwei Sätze, die sich widersprachen.
    const ferien = { state: 'ferien', name: 'Herbstferien' };
    expect(heuteSatz(lektionen, termine, 'Levin', DIENSTAG, { ferien })).toBe(
      'Ferien - heute steht nichts an.'
    );
    const laeuftWeiter = [{ ...termine[0], holidays: true }];
    expect(heuteSatz(lektionen, laeuftWeiter, 'Levin', DIENSTAG, { ferien })).toBe(
      'Fussball 17:30'
    );
    // Ausserhalb der Ferien ändert der Schalter nichts.
    expect(heuteSatz(lektionen, laeuftWeiter, 'Levin', DIENSTAG, { ferien: { state: 'schultag' } })).toBe(
      'Schule 08:20–15:05 · Fussball 17:30'
    );
    expect(ferienpause(termine[0], ferien)).toBe(true);
    expect(ferienpause(laeuftWeiter[0], ferien)).toBe(false);
    expect(ferienpause(termine[0], null)).toBe(false);
  });

  it('packt in den Ferien nur, was auch dann mitmuss', () => {
    const gear = [
      { member: 'Levin', day: 'Mi', text: 'Turnsack' },
      { member: 'Levin', day: 'Mi', text: 'Fussballschuhe', holidays: true },
    ];
    expect(morgenPackSatz(gear, 'Levin', DIENSTAG)).toBe(
      'Morgen mitnehmen: Turnsack, Fussballschuhe'
    );
    expect(morgenPackSatz(gear, 'Levin', DIENSTAG, { ferien: { state: 'ferien' } })).toBe(
      'Morgen mitnehmen: Fussballschuhe'
    );
    // Beginnen die Ferien morgen, bleibt der Turnsack schon heute Abend zuhause.
    expect(
      morgenPackSatz(gear.slice(0, 1), 'Levin', DIENSTAG, {
        ferien: { state: 'schultag', next: 'Herbstferien', next_in_days: 1 },
      })
    ).toBeNull();
  });
});

describe('krank (Punkt 622)', () => {
  it('kennt die Krankmeldung bis Mitternacht nach dem letzten Tag', () => {
    expect(krankBis({ sick_until: '2026-09-01' }, DIENSTAG)).toBe('2026-09-01');
    expect(krankBis({ sick_until: '2026-08-31' }, DIENSTAG)).toBeNull();
    expect(krankBis({}, DIENSTAG)).toBeNull();
    expect(krankBis({ sick_until: 'gestern' }, DIENSTAG)).toBeNull();
    expect(krankSatz('2026-09-01', DIENSTAG)).toBe('Krank gemeldet bis heute');
    expect(krankSatz('2026-09-02', DIENSTAG)).toBe('Krank gemeldet bis morgen');
    expect(krankSatz('2026-09-15', DIENSTAG)).toBe('Krank gemeldet bis 15.09.');
  });

  it('lässt Schul-Satz und Packliste schweigen', () => {
    const lektionen = [{ member: 'Levin', day: 'Di', from: '08:20', to: '15:05' }];
    expect(heuteSatz(lektionen, [], 'Levin', DIENSTAG, { krank: true })).toBe(
      'Heute krank - gute Besserung!'
    );
    const gear = [{ member: 'Levin', day: 'Mi', text: 'Turnsack' }];
    // Krank bis morgen: kein Thek. Krank nur bis heute: morgen wieder Schule.
    expect(
      morgenPackSatz(gear, 'Levin', DIENSTAG, { krank: true, krankBis: '2026-09-02' })
    ).toBeNull();
    expect(
      morgenPackSatz(gear, 'Levin', DIENSTAG, { krank: true, krankBis: '2026-09-01' })
    ).toBe('Morgen mitnehmen: Turnsack');
  });

  it('gibt fällige Ämtli an den Nächsten in der Reihe', () => {
    const chores = [
      { id: 'a', member: 'Levin', members: ['Levin', 'Lina', 'Stefan'], due: '2026-09-01' },
      { id: 'b', member: 'Levin', members: ['Levin', 'Lina'], due: '2026-08-30' },
      // Übermorgen darf warten - vielleicht ist er bis dann gesund.
      { id: 'c', member: 'Levin', members: ['Levin', 'Lina'], due: '2026-09-03' },
      // Nicht seins, schon erledigt, oder allein in der Reihe.
      { id: 'd', member: 'Lina', members: ['Levin', 'Lina'], due: '2026-09-01' },
      { id: 'e', member: 'Levin', members: ['Levin', 'Lina'], due: '2026-09-01', done: true },
      { id: 'f', member: 'Levin', members: ['Levin'], due: '2026-09-01' },
    ];
    expect(aemtliAbgeben(chores, 'Levin', DIENSTAG)).toEqual([
      { id: 'a', member: 'Lina' },
      { id: 'b', member: 'Lina' },
    ]);
    expect(aemtliAbgeben(null, 'Levin', DIENSTAG)).toEqual([]);
  });
});

describe('wer fährt (Punkt 621)', () => {
  it('sagt in einem Satz, wer bringt und wer holt', () => {
    expect(fahrtSatz({ bringt: 'Stefan', holt: 'Stefan' })).toBe('Stefan fährt');
    expect(fahrtSatz({ bringt: 'Stefan', holt: 'Anna' })).toBe('Stefan bringt · Anna holt');
    expect(fahrtSatz({ holt: 'Anna' })).toBe('Anna holt');
    expect(fahrtSatz({})).toBeNull();
    // Mit Ort, aber ohne Person: die offene Frage.
    expect(fahrtUnbesetzt({ ort: 'Sursee' })).toBe(true);
    expect(fahrtUnbesetzt({ ort: 'Sursee', bringt: 'Stefan' })).toBe(false);
    expect(fahrtUnbesetzt({})).toBe(false);
  });

  it('stellt die Wöchentlichen eines Tages in den Wochenplan', () => {
    const activities = [
      { id: '1', member: 'Levin', day: 'Di', from: '17:30', text: 'Fussball', bringt: 'Stefan', holt: 'Stefan' },
      { id: '2', member: 'Lina', day: 'Di', from: '16:00', text: 'Ballett', ort: 'Zell' },
      { id: '3', member: 'Levin', day: 'Fr', from: '18:00', text: 'Jugi' },
      { id: '4', member: 'Lina', day: 'Di', from: '15:00', text: 'Flöte', week: 'B' },
    ];
    // Alle: nach Zeit, nur die laufende Woche (A).
    expect(aktivitaetenAm(activities, 'Di', null, 'A').map((z) => z.id)).toEqual(['2', '1']);
    // Der Filter kennt das Kind - und den, der fährt.
    expect(aktivitaetenAm(activities, 'Di', 'Levin', 'A').map((z) => z.id)).toEqual(['1']);
    expect(aktivitaetenAm(activities, 'Di', 'Stefan', 'A').map((z) => z.id)).toEqual(['1']);
    expect(aktivitaetenAm(activities, 'Di', 'Anna', 'A')).toEqual([]);
    expect(aktivitaetZeile(activities[0])).toBe('Levin: Fussball 17:30 · Stefan fährt');
    expect(aktivitaetZeile(activities[1])).toBe('Lina: Ballett 16:00');
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

describe('Zeitraster - der Tag als Stundenplan-Blatt', () => {
  const zeilen = [
    { text: 'Mathe', from: '08:20', to: '09:05' },
    { text: 'Deutsch', from: '09:05', to: '09:50' },
    { text: 'Sport', from: '13:30', to: '15:05' },
  ];

  it('reicht von der vollen Stunde vor der ersten bis zur vollen nach der letzten Lektion', () => {
    const raster = zeitraster(zeilen);
    expect(raster?.von).toBe(8 * 60);
    expect(raster?.bis).toBe(16 * 60);
    expect(raster?.stunden).toEqual([480, 540, 600, 660, 720, 780, 840, 900, 960]);
    expect(raster?.hoehe).toBe((16 - 8) * 60 * MINUTE_PUNKTE);
  });

  it('gibt es ohne lesbare Zeiten nicht', () => {
    expect(zeitraster([])).toBeNull();
    expect(zeitraster([{ text: 'Mathe', from: 'bald' }])).toBeNull();
  });

  it('rechnet eine Lektion ohne Ende mit der üblichen Dauer', () => {
    const raster = zeitraster([{ text: 'Chor', from: '15:30' }]);
    // 15:30 + 45 Minuten = 16:15, aufgerundet auf 17:00.
    expect(raster?.bis).toBe(17 * 60);
  });

  it('setzt jeden Block an seine wahre Stelle, die Doppellektion doppelt so hoch', () => {
    const raster = zeitraster(zeilen)!;
    const mathe = rasterLage('08:20', '09:05', raster)!;
    expect(mathe.oben).toBe(20 * MINUTE_PUNKTE);
    expect(mathe.hoehe).toBe(45 * MINUTE_PUNKTE);
    const sport = rasterLage('13:30', '15:05', raster)!;
    expect(sport.hoehe).toBeCloseTo(95 * MINUTE_PUNKTE);
  });

  it('lässt eine Zeile ohne lesbaren Anfang aus dem Raster fallen', () => {
    const raster = zeitraster(zeilen)!;
    expect(rasterLage('irgendwann', '09:05', raster)).toBeNull();
    // Ohne Ende gilt die übliche Lektion.
    expect(rasterLage('08:20', '', raster)?.hoehe).toBe(45 * MINUTE_PUNKTE);
  });
});

// ── Zum Vorfreuen: Ferien- und Geburtstags-Countdown ─────────────────────

describe('ferienSatz', () => {
  it('zaehlt die tage bis zu den naechsten ferien', () => {
    expect(
      ferienSatz({ state: 'schultag', next: 'Herbstferien', next_in_days: 12 })
    ).toBe('Noch 12 Tage bis zu den Herbstferien');
    expect(
      ferienSatz({ state: 'schultag', next: 'Herbstferien', next_in_days: 1 })
    ).toBe('Morgen beginnen die Herbstferien!');
    expect(
      ferienSatz({ state: 'wochenende', next: 'Sportferien', next_in_days: 0 })
    ).toBe('Heute beginnen die Sportferien!');
  });

  it('feiert die laufenden ferien statt zu zaehlen', () => {
    expect(ferienSatz({ state: 'ferien', name: 'Sommerferien' })).toBe(
      'Gerade sind Sommerferien - keine Schule!'
    );
    expect(ferienSatz({ state: 'ferien', name: 'Feiertag' })).toBe(
      'Heute ist ein Feiertag - keine Schule!'
    );
  });

  it('schweigt ohne daten - keine karte statt einer leeren', () => {
    expect(ferienSatz(null)).toBeNull();
    expect(ferienSatz({ state: 'schultag' })).toBeNull();
  });
});

describe('geburtstagSatz', () => {
  const heute = new Date(2026, 8, 6); // 6. September 2026

  it('versteht die schreibweisen der kontaktliste', () => {
    expect(geburtstagInTagen('25.09.2015', heute)).toBe(19);
    expect(geburtstagInTagen('25.09.', heute)).toBe(19);
    expect(geburtstagInTagen('2015-09-25', heute)).toBe(19);
    expect(geburtstagInTagen('06.09.2015', heute)).toBe(0);
    // Schon vorbei dieses Jahr: gezählt wird bis zum nächsten.
    expect(geburtstagInTagen('01.01.2015', heute)).toBe(117);
    expect(geburtstagInTagen('irgendwann', heute)).toBeNull();
  });

  it('findet das kind in den kontakten und zaehlt', () => {
    const kontakte = [{ text: 'Livia', birthday: '25.09.2015' }];
    expect(geburtstagSatz(kontakte, 'Livia', heute)).toBe(
      'Noch 19 Tage bis zu deinem Geburtstag'
    );
    expect(geburtstagSatz(kontakte, 'livia ', heute)).toBe(
      'Noch 19 Tage bis zu deinem Geburtstag'
    );
    expect(
      geburtstagSatz([{ text: 'Livia', birthday: '06.09.2015' }], 'Livia', heute)
    ).toBe('Heute hast du Geburtstag - alles Gute!');
  });

  it('faengt erst bei 99 tagen an - ein countdown ab 320 ist keiner', () => {
    expect(
      geburtstagSatz([{ text: 'Livia', birthday: '01.01.2015' }], 'Livia', heute)
    ).toBeNull();
    expect(geburtstagSatz([], 'Livia', heute)).toBeNull();
  });
});

// ── Die Packliste: was morgen in den Thek gehört ─────────────────────────

describe('morgenPackSatz', () => {
  const gear = [
    { member: 'Levin', text: 'Turnsack', day: 'Di' },
    { member: 'Levin', text: 'Flöte', day: 'Di', week: 'A' },
    { member: 'Lina', text: 'Malschürze', day: 'Di' },
    { member: 'Levin', text: 'Fussballschuhe', day: 'Mi' },
  ];
  // Montag, 7. September 2026 - KW 37, also Woche A; morgen ist Dienstag.
  const montagA = new Date(2026, 8, 7, 19, 0);
  // Montag der KW 38 - Woche B.
  const montagB = new Date(2026, 8, 14, 19, 0);

  it('zaehlt auf, was morgen mitmuss - nur fuer dieses kind', () => {
    expect(morgenPackSatz(gear, 'Levin', montagA)).toBe(
      'Morgen mitnehmen: Turnsack, Flöte'
    );
    expect(morgenPackSatz(gear, 'Lina', montagA)).toBe('Morgen mitnehmen: Malschürze');
  });

  it('die floete bleibt in der b-woche zuhause', () => {
    expect(morgenPackSatz(gear, 'Levin', montagB)).toBe('Morgen mitnehmen: Turnsack');
  });

  it('ohne eintraege fuer morgen kommt keine zeile', () => {
    // Am Dienstagabend ist morgen Mittwoch - für Lina steht nichts an.
    const dienstag = new Date(2026, 8, 8, 19, 0);
    expect(morgenPackSatz(gear, 'Lina', dienstag)).toBeNull();
    expect(morgenPackSatz([], 'Levin', montagA)).toBeNull();
  });
});

describe('die Kinderwoche überall (Punkt 619)', () => {
  const lektionen = [
    { member: 'Levin', day: 'Di', from: '08:20', to: '11:30' },
    { member: 'Levin', day: 'Di', from: '13:30', to: '15:05' },
    { member: 'Levin', day: 'Mi', from: '08:20', to: '11:30' },
    { member: 'Levin', day: 'Do', from: '08:20', to: '11:30', week: 'B' },
  ];
  const termine = [
    { member: 'Levin', day: 'Di', from: '17:30', to: '19:00', text: 'Fussball', ort: 'Sursee', holt: 'Stefan' },
    { member: 'Lina', day: 'Di', from: '16:00', text: 'Ballett' },
  ];

  it('sagt im Wochenplan, wann die Schule aus ist - und ob der Nachmittag frei ist', () => {
    expect(schulzeileAm(lektionen, 'Levin', 'Di', 'A')).toBe('Schule bis 15:05');
    expect(schulzeileAm(lektionen, 'Levin', 'Mi', 'A')).toBe('Schule bis 11:30 · Nachmittag frei');
    // Ein Zweiwochen-Fach nur in seiner Woche; sonst kein Schultag.
    expect(schulzeileAm(lektionen, 'Levin', 'Do', 'B')).toBe('Schule bis 11:30 · Nachmittag frei');
    expect(schulzeileAm(lektionen, 'Levin', 'Do', 'A')).toBeNull();
    expect(schulzeileAm(lektionen, 'Lina', 'Di', 'A')).toBeNull();
    // In den Ferien und krank keine Schule.
    expect(schulzeileAm(lektionen, 'Levin', 'Di', 'A', { ferien: { state: 'ferien' } })).toBeNull();
    expect(schulzeileAm(lektionen, 'Levin', 'Di', 'A', { krank: true })).toBeNull();
  });

  it('weiss für jeden Tag der Woche, ob Ferien sind', () => {
    // Die Entität beschreibt heute; mit «until» und «next_until» reicht
    // das für die sieben Tage des Wochenplans.
    const heute = new Date(2026, 9, 1); // Donnerstag in den Herbstferien
    const inFerienStand = { state: 'ferien', name: 'Herbstferien', until: '2026-10-11', next: 'Weihnachtsferien', next_in_days: 79, next_until: '2027-01-03' };
    expect(ferienAm(inFerienStand, heute, heute)).toBe(inFerienStand);
    expect(ferienAm(inFerienStand, new Date(2026, 9, 6), heute)?.state).toBe('ferien');
    expect(ferienAm(inFerienStand, new Date(2026, 9, 12), heute)?.state).toBe('schultag');
    // Ein Schultag vor den Ferien: Ab Samstag Ferien, ab dem 12. wieder Schule.
    const vorher = new Date(2026, 8, 24);
    const schulStand = { state: 'schultag', next: 'Herbstferien', next_in_days: 2, next_until: '2026-10-11' };
    expect(ferienAm(schulStand, new Date(2026, 8, 25), vorher)?.state).toBe('schultag');
    expect(ferienAm(schulStand, new Date(2026, 8, 28), vorher)).toEqual({ state: 'ferien', name: 'Herbstferien' });
    expect(ferienAm(schulStand, new Date(2026, 9, 12), vorher)?.state).toBe('schultag');
    // Ein alter Hub ohne Ende: Nur heute ist sicher.
    expect(ferienAm({ state: 'ferien' }, new Date(2026, 9, 6), heute)?.state).toBe('schultag');
    expect(ferienAm(null, heute, heute)).toBeNull();
  });

  it('gibt dem Babysitter den ausführlichen Satz mit Ort und wer holt', () => {
    expect(heuteSatz(lektionen, termine, 'Levin', DIENSTAG, {}, true)).toBe(
      'Schule bis 15:05 · Fussball 17:30 in Sursee, Stefan holt'
    );
    // Die kurze Fassung der Kinderseite bleibt, wie sie war.
    expect(heuteSatz(lektionen, termine, 'Levin', DIENSTAG)).toBe(
      'Schule 08:20–15:05 · Fussball 17:30'
    );
  });

  it('stellt am Wandpanel jedes eingetragene Kind hin - auch an einem leeren Tag', () => {
    const zeilen = kinderHeute(lektionen, termine, ['Levin', 'Lina', 'Pia'], DIENSTAG, (name) =>
      name === 'Lina' ? { krank: true } : {}
    );
    expect(zeilen).toEqual([
      { name: 'Levin', satz: 'Schule 08:20–15:05 · Fussball 17:30' },
      { name: 'Lina', satz: 'Heute krank - gute Besserung!' },
    ]);
    // Am Mittwoch hat Lina nichts - sie steht trotzdem da, Pia (ohne
    // Einträge) nicht.
    const mittwoch = new Date(DIENSTAG.getTime() + 86_400_000);
    expect(kinderHeute(lektionen, termine, ['Levin', 'Lina', 'Pia'], mittwoch).map((z) => z.satz)).toEqual([
      'Schule 08:20–11:30',
      'Heute steht nichts an.',
    ]);
  });
});
