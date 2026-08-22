/**
 * Das Rechnen hinter den Familien-Modulen.
 *
 * Vier Module lesen sich gegenseitig – und genau an den Nahtstellen
 * entstehen die Fehler, die man erst bemerkt, wenn es darauf ankommt.
 * Der Auslöser für diese Datei: Die Babysitter-Seite suchte die
 * Telefonnummer unter einem anderen Namen, als die Kontakte sie
 * speicherten, und zeigte deshalb eine Namensliste ohne Nummern.
 */
import {
  BABYSITTER_FEATURES,
  babysitterZugang,
  fuerBabysitter,
  gabenVon,
  genommenMap,
  geprueftVor,
  hakeGabe,
  isoTag,
  kontaktAlter,
  kontaktVeraltet,
  kurFertig,
  kurzDatum,
  medZeile,
  montagVon,
  BERATUNGSNUMMERN,
  NOTFALLNUMMERN,
  notfallText,
  notfallUeberfaellig,
  nummernVon,
  oeffnungsStatus,
  offeneGaben,
  plusWochen,
  schnellwahl,
  rollenVon,
  tageErledigt,
  toggleRolle,
  waehlbar,
} from './familie';

describe('Kontakte', () => {
  const livia = {
    id: '1',
    text: 'Livia',
    phone: '079 123 45 67',
    phone2: '041 970 00 00',
    roles: ['familie'],
  };

  it('führt beide Nummern in der Reihenfolge, in der man sie wählt', () => {
    expect(nummernVon(livia).map((n) => n.nummer)).toEqual([
      '079 123 45 67',
      '041 970 00 00',
    ]);
    expect(nummernVon({ id: '2', text: 'Ohne' })).toEqual([]);
  });

  it('macht aus einer lesbaren Nummer eine wählbare', () => {
    expect(waehlbar('+41 79 123 45 67')).toBe('+41791234567');
    expect(waehlbar('041 970 00 00')).toBe('0419700000');
    expect(waehlbar(undefined)).toBe('');
  });

  it('nimmt nur Rollen an, die es gibt', () => {
    expect(rollenVon({ roles: ['arzt', 'unfug'] })).toEqual(['arzt']);
    expect(rollenVon({})).toEqual([]);
    expect(toggleRolle(['arzt'], 'notfall')).toEqual(['arzt', 'notfall']);
    expect(toggleRolle(['arzt', 'notfall'], 'arzt')).toEqual(['notfall']);
  });

  it('zeigt dem Babysitter die richtigen Nummern – und im Zweifel alle', () => {
    const kontakte = [
      { id: 'a', text: 'Kinderärztin', roles: ['arzt'] },
      { id: 'b', text: 'Gartenbauer', roles: ['handwerk'] },
      { id: 'c', text: 'Oma', roles: ['notfall', 'familie'] },
    ];
    expect(fuerBabysitter(kontakte).map((k) => k.id)).toEqual(['a', 'c']);
    // Wer keine Rollen vergeben hat, bekommt weiterhin alle: Eine leere
    // Nummernliste ist auf dieser Seite der schlechtestmögliche Ausgang.
    const ohne = [{ id: 'x', text: 'Irgendwer' }];
    expect(fuerBabysitter(ohne).map((k) => k.id)).toEqual(['x']);
  });
});

describe('Notfallblatt', () => {
  const heute = new Date('2026-08-21T10:00:00');

  it('rechnet, wie lange die letzte Prüfung her ist', () => {
    expect(geprueftVor('2026-08-01', heute)).toBe(20);
    expect(geprueftVor(null, heute)).toBeNull();
    expect(geprueftVor('irgendwann', heute)).toBeNull();
  });

  it('hält ein Blatt nach einem Jahr für überfällig, ein nie geprüftes sofort', () => {
    expect(notfallUeberfaellig(null, heute)).toBe(true);
    expect(notfallUeberfaellig('2026-08-01', heute)).toBe(false);
    expect(notfallUeberfaellig('2024-01-01', heute)).toBe(true);
  });

  it('schreibt eine Seite, die man weitergeben kann', () => {
    const text = notfallText(
      [{ id: '1', text: 'Lina', blood: 'A+', allergies: 'Nüsse', body: 'Schläft mit Nuggi' }],
      'Zell'
    );
    expect(text).toContain('NOTFALLBLATT – Zell');
    expect(text).toContain('Blutgruppe: A+');
    expect(text).toContain('Allergien: Nüsse');
    expect(text).toContain('Schläft mit Nuggi');
    // Die Notrufnummern stehen immer darauf – sie pflegt niemand.
    expect(text).toContain('Sanität 144');
  });

  it('trennt Notruf- und Beratungsnummern sauber', () => {
    expect(NOTFALLNUMMERN.map((n) => n.nummer)).toContain('144');
    expect(NOTFALLNUMMERN.map((n) => n.nummer)).not.toContain('142');
    expect(BERATUNGSNUMMERN.map((n) => n.nummer)).toEqual(['142']);
    expect(BERATUNGSNUMMERN[0].hinweis).toBeTruthy();
  });

  it('führt die Opferhilfe unter Beratung, nicht unter Notruf', () => {
    // 142 ist ausdrücklich keine Notrufnummer: Wer in akuter Gefahr die
    // Notruf-Zeile liest, soll bei Polizei und Sanität landen.
    const text = notfallText([], 'Zell');
    const notruf = text.split('\n').find((z) => z.startsWith('Notruf:')) ?? '';
    const beratung = text.split('\n').find((z) => z.startsWith('Beratung:')) ?? '';
    expect(notruf).toContain('Polizei 117');
    expect(notruf).not.toContain('142');
    expect(beratung).toContain('Opferhilfe 142');
  });
});

describe('Medikamente', () => {
  it('nimmt ohne Angabe eine Gabe am Morgen an', () => {
    expect(gabenVon({})).toEqual(['morgens']);
    expect(gabenVon({ times: ['abends', 'morgens'] })).toEqual(['morgens', 'abends']);
    expect(gabenVon({ times: ['irgendwann'] })).toEqual(['morgens']);
  });

  it('zählt die alte Form – eine Liste von Tagen – weiter als voll', () => {
    const alt = { taken: ['2026-08-19', '2026-08-20'], days: 3 };
    expect(genommenMap(alt)).toEqual({
      '2026-08-19': ['morgens'],
      '2026-08-20': ['morgens'],
    });
    expect(tageErledigt(alt)).toBe(2);
    expect(kurFertig(alt)).toBe(false);
  });

  it('meldet eine Gabe erst, wenn ihre Tageszeit da ist', () => {
    const drei = { times: ['morgens', 'mittags', 'abends'], days: 2, taken: {} };
    expect(offeneGaben(drei, '2026-08-21', 7)).toEqual([]);
    expect(offeneGaben(drei, '2026-08-21', 13)).toEqual(['morgens', 'mittags']);
    expect(offeneGaben(drei, '2026-08-21', 19)).toEqual([
      'morgens',
      'mittags',
      'abends',
    ]);
  });

  it('hakt eine Gabe an und wieder ab', () => {
    const med = { times: ['morgens', 'abends'], days: 3, taken: {} };
    const eins = hakeGabe(med, '2026-08-21', 'morgens');
    expect(eins.taken['2026-08-21']).toEqual(['morgens']);
    expect(eins.done).toBe(false);
    // Wieder wegnehmen räumt den Tag ganz weg, statt eine leere Liste zu
    // hinterlassen.
    expect(hakeGabe({ ...med, taken: eins.taken }, '2026-08-21', 'morgens').taken).toEqual(
      {}
    );
  });

  it('beendet die Kur nach dem letzten vollständigen Tag', () => {
    const fast = { times: ['morgens'], days: 2, taken: { '2026-08-20': ['morgens'] } };
    expect(hakeGabe(fast, '2026-08-21', 'morgens').done).toBe(true);
    expect(offeneGaben({ ...fast, done: true }, '2026-08-22', 10)).toEqual([]);
  });

  it('schreibt eine Zeile, die die Frage am Abend beantwortet', () => {
    const zeile = medZeile(
      { dose: '5 ml', member: 'Lina', times: ['morgens', 'abends'], days: 5 },
      '2026-08-21'
    );
    expect(zeile).toContain('5 ml');
    expect(zeile).toContain('für Lina');
    expect(zeile).toContain('heute offen: morgens, abends');
  });
});

describe('Wochenplan', () => {
  it('findet den Montag – auch spät am Abend und am Montag selbst', () => {
    expect(isoTag(montagVon(new Date('2026-08-21T23:30:00')))).toBe('2026-08-17');
    expect(isoTag(montagVon(new Date('2026-08-17T00:10:00')))).toBe('2026-08-17');
    expect(isoTag(montagVon(new Date('2026-08-23T18:00:00')))).toBe('2026-08-17');
  });

  it('blättert um ganze Wochen', () => {
    const montag = new Date('2026-08-17T00:00:00');
    expect(isoTag(plusWochen(montag, 1))).toBe('2026-08-24');
    expect(isoTag(plusWochen(montag, -1))).toBe('2026-08-10');
    expect(kurzDatum(new Date('2026-08-21T00:00:00'))).toBe('21.8.');
  });
});

describe('Babysitter-Zugang', () => {
  it('gibt nur frei, was ein Babysitter braucht', () => {
    // Keine Türen, kein Alarm, keine Kameras: Was man nicht freigibt,
    // muss man später nicht bereuen.
    expect(BABYSITTER_FEATURES).toEqual(['licht', 'familie']);
  });

  it('lässt den Zugang am selben Abend enden', () => {
    const jetzt = new Date('2026-08-21T18:30:00');
    expect(babysitterZugang(jetzt, '23:00')).toEqual({
      expires: '2026-08-21',
      hours: { from: '18:30', to: '23:00' },
    });
  });

  it('reicht über Mitternacht bis in den nächsten Tag', () => {
    // Sonst wäre der Zugang genau dann weg, wenn man ihn noch braucht.
    const jetzt = new Date('2026-08-21T19:00:00');
    expect(babysitterZugang(jetzt, '00:30')).toEqual({
      expires: '2026-08-22',
      hours: { from: '19:00', to: '00:30' },
    });
  });
});

describe('Kontakte: geöffnet, gepflegt, Schnellwahl', () => {
  // Mittwoch, 26. August 2026, 10:00.
  const MITTWOCH = new Date('2026-08-26T10:00:00');

  test('sagt, wie lange noch offen ist', () => {
    const status = oeffnungsStatus({ Mi: '08:00-12:00, 14:00-18:30' }, MITTWOCH);
    expect(status).toEqual({ offen: true, text: 'jetzt geöffnet · bis 12:00' });
  });

  test('nennt die nächste Öffnung, wenn gerade zu ist', () => {
    const status = oeffnungsStatus(
      { Mi: '14:00-18:30' },
      new Date('2026-08-26T10:00:00')
    );
    expect(status).toEqual({ offen: false, text: 'öffnet heute 14:00' });
  });

  test('springt über den geschlossenen Tag', () => {
    const status = oeffnungsStatus({ Mo: '08:00-12:00' }, MITTWOCH);
    expect(status).toEqual({ offen: false, text: 'öffnet Mo 08:00' });
  });

  test('ohne Zeiten lieber gar nichts sagen als etwas Falsches', () => {
    expect(oeffnungsStatus(undefined, MITTWOCH)).toBeNull();
    expect(oeffnungsStatus({ Mi: 'geschlossen' }, MITTWOCH)).toBeNull();
  });

  test('ein Anruf hält den Kontakt frisch', () => {
    const heute = new Date('2026-08-22T00:00:00');
    expect(kontaktAlter({ last_used: '2026-08-20' }, heute)).toBe(2);
    expect(kontaktVeraltet({ last_used: '2026-08-20' }, heute)).toBe(false);
    expect(kontaktVeraltet({ last_used: '2023-01-01' }, heute)).toBe(true);
  });

  test('Schnellwahl bevorzugt die Sterne', () => {
    const contacts = [
      { id: '1', text: 'Mama', phone: '079 1', favorite: true },
      { id: '2', text: 'Praxis', phone: '041 2' },
      { id: '3', text: 'ohne Nummer', favorite: true },
    ];
    expect(schnellwahl(contacts).map((c) => c.id)).toEqual(['1']);
  });

  test('ohne Sterne springen die zuletzt Angerufenen ein', () => {
    const contacts = [
      { id: '1', text: 'Mama', phone: '079 1', last_used: '2026-08-01' },
      { id: '2', text: 'Praxis', phone: '041 2', last_used: '2026-08-20' },
    ];
    expect(schnellwahl(contacts).map((c) => c.id)).toEqual(['2', '1']);
  });

  test('die Hausadresse steht zuoberst auf dem Notfallblatt', () => {
    const text = notfallText([{ text: 'Lina' }], 'Familie Gross', 'Musterweg 3, 6144 Zell');
    const zeilen = text.split('\n');
    expect(zeilen[2]).toBe('Wir sind hier: Musterweg 3, 6144 Zell');
    // Ohne Adresse bleibt das Blatt, wie es war.
    expect(notfallText([{ text: 'Lina' }])).not.toContain('Wir sind hier');
  });
});
