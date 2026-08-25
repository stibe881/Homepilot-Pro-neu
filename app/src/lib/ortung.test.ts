/**
 * «Wer ist da?» und die Frage, ob man dem Orten zusehen kann.
 */
import {
  anwesenheitsListe,
  dauerDa,
  geortet,
  ortungsHinweis,
  quellenText,
  pauseBis,
  pausiert,
  seitText,
  werIstDaHinweis,
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

// ── Das Fenster hinter «jemand da» ───────────────────────────────────────
// Gefragt wird beim Blick auf die Startseite fast immer «wie lange schon»,
// nicht «seit wann».

const UM = (h: number, m: number) => new Date(2026, 7, 23, h, m, 0);
const sekunden = (d: Date) => Math.floor(d.getTime() / 1000);

describe('dauerDa', () => {
  it('nennt bei kurzer Anwesenheit die Dauer', () => {
    expect(dauerDa(sekunden(UM(13, 37)), UM(14, 0))).toBe('seit 23 min');
    expect(dauerDa(sekunden(UM(11, 45)), UM(14, 0))).toBe('seit 2 h 15 min');
  });

  it('sagt bei frischer Ankunft nicht «seit 0 min»', () => {
    expect(dauerDa(sekunden(UM(14, 0)), UM(14, 0))).toBe('gerade angekommen');
  });

  it('wechselt nach einem Tag auf die Uhrzeit', () => {
    // «seit 19 h 12 min» ist keine Auskunft mehr.
    const gestern = new Date(2026, 7, 22, 18, 40, 0);
    expect(dauerDa(sekunden(gestern), UM(14, 0))).toBe('seit gestern, 18:40');
  });

  it('nennt weiter zurück das Datum', () => {
    const vorher = new Date(2026, 7, 19, 9, 5, 0);
    expect(dauerDa(sekunden(vorher), UM(14, 0))).toBe('seit 19.8., 09:05');
  });

  it('bleibt leer, wenn nie etwas gemeldet wurde', () => {
    expect(dauerDa(null, UM(14, 0))).toBe('');
    expect(dauerDa(0, UM(14, 0))).toBe('');
  });

  it('macht aus einer Meldung aus der Zukunft keine Dauer', () => {
    // Uhr verstellt: «seit -20 min» wäre schlimmer als nichts.
    expect(dauerDa(sekunden(UM(14, 20)), UM(14, 0))).toBe('');
  });
});

describe('anwesenheitsListe', () => {
  const leute = [
    { zone: 'a', name: 'Sandra', state: 'away', since: sekunden(UM(9, 0)) },
    { zone: 'b', name: 'Stefan', state: 'home', since: sekunden(UM(11, 45)) },
    { zone: 'c', name: 'Levin', state: 'unknown' },
  ];

  it('stellt die Anwesenden nach vorn', () => {
    // Wer draufdrückt, will wissen, wer im Haus ist.
    expect(anwesenheitsListe(leute, UM(14, 0)).map((z) => z.name)).toEqual([
      'Stefan',
      'Sandra',
      'Levin',
    ]);
  });

  it('schreibt zu jedem Zustand und Dauer', () => {
    const [erster] = anwesenheitsListe(leute, UM(14, 0));
    expect(erster).toMatchObject({
      name: 'Stefan',
      zustand: 'zuhause',
      dauer: 'seit 2 h 15 min',
      zuhause: true,
    });
  });

  it('schreibt hinter «unterwegs» kein «gerade angekommen»', () => {
    // `since` ist der Zeitpunkt des Wechsels. Bei wem der Wechsel ein
    // Weggehen war, las sich «unterwegs · gerade angekommen» wie ein
    // Widerspruch.
    const eben = [{ zone: 'a', name: 'Livia', state: 'away', since: sekunden(UM(14, 0)) }];
    expect(anwesenheitsListe(eben, UM(14, 0))[0].dauer).toBe('gerade eben');
    const heim = [{ zone: 'b', name: 'Stefan', state: 'home', since: sekunden(UM(14, 0)) }];
    expect(anwesenheitsListe(heim, UM(14, 0))[0].dauer).toBe('gerade angekommen');
  });

  it('lässt die Dauer weg, wo sich niemand gemeldet hat', () => {
    const levin = anwesenheitsListe(leute, UM(14, 0))[2];
    expect(levin.dauer).toBe('');
    expect(levin.zustand).toBe('meldet sich nicht');
  });

  it('überspringt Einträge ohne Namen und verträgt eine leere Liste', () => {
    expect(anwesenheitsListe([{ state: 'home' }], UM(14, 0))).toEqual([]);
    expect(anwesenheitsListe([], UM(14, 0))).toEqual([]);
  });

  it('lässt Zugänge ohne Ortung aus der Liste', () => {
    // «Hub-Token» und das Wandtablet sind Benutzer des Hubs, aber keine
    // Personen. Als Zeilen mit «Ortung nicht eingerichtet» sahen sie im
    // Fenster aus wie vermisste Familienmitglieder.
    const gemischt = [
      ...leute,
      { zone: null, name: 'Hub-Token', state: 'unknown', configured: false },
      { zone: null, name: 'Tablet', state: 'unknown', configured: false },
    ];
    expect(anwesenheitsListe(gemischt, UM(14, 0)).map((z) => z.name)).toEqual([
      'Stefan',
      'Sandra',
      'Levin',
    ]);
  });
});

describe('werIstDaHinweis', () => {
  const daheim = [{ name: 'Stefan', state: 'home', configured: true }];
  const weg = [{ name: 'Stefan', state: 'away', configured: true }];
  const stumm = [{ name: 'Stefan', state: 'unknown', configured: true }];
  const nichtEingerichtet = [{ name: 'Hub-Token', state: 'unknown', configured: false }];

  it('schweigt, wenn beide dasselbe sagen', () => {
    expect(werIstDaHinweis(daheim, true)).toBe('');
    expect(werIstDaHinweis(weg, false)).toBe('');
  });

  it('nennt die fehlende Einrichtung, wenn niemand geortet wird', () => {
    // Genau der gemeldete Fall: nur Zugänge, keine Person mit Zone.
    expect(werIstDaHinweis(nichtEingerichtet, true)).toContain(
      'Für niemanden ist die Ortung eingerichtet'
    );
  });

  it('nennt beim Namen, wessen Schweigen das «jemand da» hält', () => {
    // Nichtwissen zählt als «da» – ein leerer Akku ist kein «niemand
    // zuhause». Wer das nicht weiss, hält die Anzeige für kaputt.
    const satz = werIstDaHinweis(stumm, true);
    expect(satz).toContain('Stefan');
    expect(satz).toContain('jemand da');
  });

  it('sagt es deutlich, wenn sich das nicht erklären lässt', () => {
    // Alle ausdrücklich weg, oben trotzdem «jemand da»: Dann stimmt
    // wirklich etwas nicht.
    expect(werIstDaHinweis(weg, true)).toContain('stimmt etwas mit der Ortung nicht');
  });

  it('schweigt, solange es die Sammelfrage nicht gibt', () => {
    // Ohne Geofence gibt es oben keinen Chip und nichts zu erklären.
    expect(werIstDaHinweis(nichtEingerichtet, null)).toBe('');
    expect(werIstDaHinweis(daheim, null)).toBe('');
  });

  it('verträgt eine leere Liste', () => {
    expect(werIstDaHinweis([], true)).toContain('Für niemanden');
    expect(werIstDaHinweis([], false)).toBe('');
  });
});


describe('quellenText', () => {
  it('macht aus den Kürzeln des Hubs lesbare Antworten', () => {
    // «Quelle: none» stand so auf dem Bildschirm – ein Wort aus dem
    // Code, das eine Frage offenlässt statt sie zu beantworten.
    expect(quellenText('none')).toBe('noch keine Meldung');
    expect(quellenText('geofence')).toBe('Telefon');
    expect(quellenText('life360')).toBe('Life360');
  });

  it('behandelt Fehlendes wie «noch nichts gekommen»', () => {
    expect(quellenText(undefined)).toBe('noch keine Meldung');
    expect(quellenText('')).toBe('noch keine Meldung');
    expect(quellenText('unbekannt')).toBe('noch keine Meldung');
  });

  it('nennt eine neue Quelle beim Namen, statt sie zu verstecken', () => {
    // Sonst verschwände die nächste Integration hinter einem «?».
    expect(quellenText('tasker')).toBe('tasker');
  });
});


describe('Gespeicherte Orte von Life360', () => {
  it('nennt den Ort beim Namen statt «unterwegs»', () => {
    // Life360 weiss, dass Maja bei «Tanners Home» steht. Vorher warf der
    // Hub den Namen weg und die Liste sagte bloss «unterwegs».
    expect(
      zustandText({ state: 'tanners_home', place_name: 'Tanners Home' })
    ).toBe('Tanners Home');
  });

  it('fällt auf die Kennung zurück, wenn kein Name mitkam', () => {
    expect(zustandText({ state: 'tanners_home' })).toBe('tanners_home');
  });

  it('lässt «zuhause» und «unterwegs» unangetastet', () => {
    // Der eigene Ort des Hauses schlägt den Namen aus der fremden App –
    // sonst hinge die Alarmanlage daran.
    expect(zustandText({ state: 'home', place_name: 'Tanners Home' })).toBe('zuhause');
    expect(zustandText({ state: 'away' })).toBe('unterwegs');
  });

});


// ── Zugänge sind keine Personen ──────────────────────────────────────────
// Auf der Familienseite stand «Niemand zuhause · 3 unbekannt», darunter
// «Hub-Token Ortung nicht eingerichtet» und «Tablet Ortung nicht
// eingerichtet». Zwei der drei «Unbekannten» waren Zugänge, die
// nirgendwohin gehen.

describe('geortet', () => {
  const leute = [
    { name: 'Stefan', state: 'unknown', configured: true },
    { name: 'Maja', state: 'home', configured: true },
    { name: 'Hub-Token', state: 'unknown', configured: false },
    { name: 'Tablet', state: 'unknown', configured: false },
  ];

  it('lässt Zugänge ohne Ortung weg', () => {
    expect(geortet(leute).map((p) => p.name)).toEqual(['Stefan', 'Maja']);
  });


  it('verträgt Leeres', () => {
    expect(geortet([])).toEqual([]);
    expect(geortet([{ state: 'home' }])).toEqual([]);
  });
});
