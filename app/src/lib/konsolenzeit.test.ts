import {
  KonsolenLage,
  aufteilung,
  dauerText,
  grundSatz,
  konsoleUmschalten,
  laeuft,
  leererPlan,
  minutenText,
  monatAnteil,
  monatSatz,
  monatSetzen,
  monatsHinweis,
  morgenSatz,
  restNach,
  ringAnteil,
  ringZahl,
  tagAendern,
  tagZeile,
  tempoSatz,
  verstellen,
  warnungUmschalten,
  werktageUebernehmen,
  wochenBalken,
  wochentagIndex,
  zeitText,
} from './konsolenzeit';

function lage(ueberschreibung: Partial<KonsolenLage> = {}): KonsolenLage {
  return {
    kind: 'Maja',
    plan: leererPlan(['ps5']),
    heute: {
      gesamt_s: 25 * 60,
      konsolen: { ps5: 600, switch: 900 },
      bonus: 0,
      frei: false,
      verlauf: [],
      regel: { an: true, von: 960, bis: 1140, minuten: 45 },
    },
    rest_s: 20 * 60,
    grund: '',
    monat: { gespielt_s: (9 * 60 + 5) * 60, limit_min: 1200, tempo: null },
    gesperrt: false,
    sitzung: null,
    tage: [],
    ferien: false,
    ...ueberschreibung,
  };
}

describe('Zeiten und Dauern', () => {
  it('schreibt Minuten wie auf den Bildern', () => {
    expect(minutenText(45)).toBe('45 min');
    expect(minutenText(90)).toBe('1 h 30 min');
    expect(minutenText(120)).toBe('2 h');
    expect(dauerText(30)).toBe('unter 1 min');
    expect(zeitText(960)).toBe('16:00');
    expect(zeitText(545)).toBe('09:05');
  });
});

describe('Plan bearbeiten', () => {
  it('startet ausgeschaltet: Wer nur nachsieht, begrenzt kein Kind', () => {
    expect(leererPlan().aktiv).toBe(false);
  });

  it('hält ein Fenster immer nach seinem Beginn', () => {
    const plan = tagAendern(leererPlan(), 0, { von: 20 * 60, bis: 10 * 60 });
    expect(plan.tage[0].bis).toBeGreaterThan(plan.tage[0].von);
  });

  it('hält Minuten in Grenzen und lässt andere Tage in Ruhe', () => {
    const plan = tagAendern(leererPlan(), 2, { minuten: 99999 });
    expect(plan.tage[2].minuten).toBe(600);
    expect(plan.tage[1].minuten).toBe(45);
  });

  it('übernimmt einen Tag auf Montag bis Freitag, nicht aufs Wochenende', () => {
    const start = tagAendern(leererPlan(), 0, { minuten: 30, von: 17 * 60, bis: 18 * 60 });
    const neu = werktageUebernehmen(start, 0);
    expect(neu.tage.slice(0, 5).every((t) => t.minuten === 30 && t.von === 17 * 60)).toBe(true);
    expect(neu.tage[5].minuten).toBe(120);
    // Eine Kopie: Wer später Dienstag ändert, ändert nicht den Montag.
    expect(neu.tage[1]).not.toBe(neu.tage[0]);
  });

  it('stellt in Viertelstunden und bleibt in den Grenzen', () => {
    expect(verstellen(960, 1, 0, 1425)).toBe(975);
    expect(verstellen(0, -1, 0, 1425)).toBe(0);
  });

  it('nimmt Konsolen und Warnungen ein und aus, Warnungen absteigend', () => {
    let plan = konsoleUmschalten(leererPlan(['ps5']), 'switch');
    expect(plan.konsolen).toEqual(['ps5', 'switch']);
    plan = konsoleUmschalten(plan, 'ps5');
    expect(plan.konsolen).toEqual(['switch']);
    const warn = warnungUmschalten(leererPlan(), 15);
    expect(warn.warnungen).toEqual([15, 10, 5, 1]);
    expect(warnungUmschalten(warn, 10).warnungen).toEqual([15, 5, 1]);
  });

  it('kennt «keine Monatsgrenze»', () => {
    expect(monatSetzen(leererPlan(), null).monat).toBeNull();
    expect(monatSetzen(leererPlan(), 20).monat).toBe(1200);
  });

  it('rechnet vor, ab wann die Monatsgrenze greift (Bild 2)', () => {
    // Mo–Fr 45 min, Sa 120, So 120: 345 min je Woche; 20 h Grenze.
    const hinweis = monatsHinweis(leererPlan());
    expect(hinweis).toContain('Beides gilt');
    expect(hinweis).toMatch(/dem \d+\. Tag/);
    // Eine Grenze über dem Möglichen greift nie.
    expect(monatsHinweis(monatSetzen(leererPlan(), 100))).toContain('greift nie');
    expect(monatsHinweis(monatSetzen(leererPlan(), null))).toBeNull();
  });
});

describe('Zeilen im Plan', () => {
  it('zeigt Fenster und Höchstzeit, oder «Kein Zocken»', () => {
    expect(tagZeile({ an: true, von: 960, bis: 1140, minuten: 45 })).toEqual({
      titel: '16:00 – 19:00',
      unten: 'höchstens 45 min',
    });
    expect(tagZeile({ an: false, von: 960, bis: 1140, minuten: 45 }).titel).toBe('Kein Zocken');
  });
});

describe('Ring', () => {
  it('zählt in Minuten, ab einer Stunde in Stunden', () => {
    expect(ringZahl({ rest_s: 20 * 60 })).toEqual({ zahl: '20', einheit: 'Minuten übrig' });
    expect(ringZahl({ rest_s: 60 })).toEqual({ zahl: '1', einheit: 'Minute übrig' });
    expect(ringZahl({ rest_s: 5400 })).toEqual({ zahl: '1:30', einheit: 'Stunden übrig' });
    expect(ringZahl({ rest_s: 3600 }).zahl).toBe('1 h');
  });

  it('sagt «< 1» statt «0», solange noch Zeit ist', () => {
    expect(ringZahl({ rest_s: 40 }).zahl).toBe('< 1');
    expect(ringZahl({ rest_s: 0 }).zahl).toBe('0');
  });

  it('kennt «keine Grenze»', () => {
    expect(ringZahl({ rest_s: null }).einheit).toBe('keine Grenze');
    expect(ringAnteil(lage({ rest_s: null }))).toBe(1);
  });

  it('füllt den Ring nach dem, was heute erlaubt war (Plan plus Geschenk)', () => {
    expect(ringAnteil(lage())).toBeCloseTo(20 / 45);
    const geschenk = lage({ heute: { ...lage().heute, bonus: 15 }, rest_s: 30 * 60 });
    expect(ringAnteil(geschenk)).toBeCloseTo(30 / 60);
  });

  it('bleibt in 0 bis 1', () => {
    expect(ringAnteil(lage({ rest_s: 999 * 60 }))).toBe(1);
    expect(ringAnteil(lage({ rest_s: 0 }))).toBe(0);
  });
});

describe('Lage lesen', () => {
  it('nennt den Grund in einem Satz für das Kind', () => {
    expect(grundSatz(lage({ grund: 'gesperrt' }))).toContain('gesperrt');
    expect(grundSatz(lage({ grund: 'monat' }))).toContain('Monat');
    expect(grundSatz(lage({ grund: 'fenster' }))).toBe('Erlaubt ist 16:00 – 19:00.');
    expect(grundSatz(lage({ grund: '' }))).toBe('');
  });

  it('teilt die Zeit auf die Konsolen auf und lässt Sekundenbruchteile weg', () => {
    expect(aufteilung({ ps5: 600, switch: 900 }, { ps5: 'PS5', switch: 'Switch' })).toBe(
      'PS5 10 min, Switch 15 min'
    );
    expect(aufteilung({ ps5: 600, switch: 12 }, { ps5: 'PS5' })).toBe('PS5 10 min');
  });

  it('rechnet den Monat wie Bild 1', () => {
    expect(monatSatz(lage())).toBe('Noch 10 h 55 min');
    expect(monatAnteil(lage())).toBeCloseTo(0.454, 2);
    expect(monatSatz(lage({ monat: { gespielt_s: 0, limit_min: null, tempo: null } }))).toBeNull();
  });

  it('sagt zum Tempo nur etwas, wenn es nötig ist', () => {
    expect(tempoSatz(null)).toBeNull();
    expect(tempoSatz({ strich: 0.3, genutzt: 0.2, urteil: 'im_plan' })).toBeNull();
    expect(tempoSatz({ strich: 0.3, genutzt: 0.45, urteil: 'schneller' })).toContain('schneller');
  });
});

describe('Blick nach vorn', () => {
  it('nennt den nächsten Konsolentag, wenn morgen keiner ist', () => {
    const plan = tagAendern(leererPlan(), 2, { an: false });
    expect(morgenSatz(plan, 1)).toBe('Morgen ist kein Zocken. Am Donnerstag wieder ab 16:00.');
  });

  it('sagt für morgen die Zeiten, wenn gespielt werden darf', () => {
    expect(morgenSatz(leererPlan(), 1)).toBe('Morgen ab 16:00, höchstens 45 min.');
  });

  it('schweigt, wenn nie gespielt werden darf', () => {
    const plan = { ...leererPlan(), tage: leererPlan().tage.map((t) => ({ ...t, an: false })) };
    expect(morgenSatz(plan, 1)).toBeNull();
  });

  it('rechnet den Wochentag mit Montag als Null', () => {
    expect(wochentagIndex(new Date(2026, 10, 9))).toBe(0); // Montag
    expect(wochentagIndex(new Date(2026, 10, 15))).toBe(6); // Sonntag
  });

  it('ordnet die Balken den Tagen dieser Woche zu', () => {
    const heute = new Date(2026, 10, 10); // Dienstag
    const balken = wochenBalken(
      leererPlan(),
      1,
      25 * 60,
      [{ tag: '2026-11-09', gesamt_s: 45 * 60 }],
      heute
    );
    expect(balken[0]).toMatchObject({ tag: 'Mo', gespielt: 45, erlaubt: 45, heute: false });
    expect(balken[1]).toMatchObject({ tag: 'Di', gespielt: 25, heute: true });
    expect(balken[2].gespielt).toBe(0);
  });
});

describe('Zwischen zwei Abrufen weiterzählen', () => {
  it('zählt nur, solange eine Sitzung läuft', () => {
    const laufend = lage({ sitzung: { konsole: 'ps5', seit: 0 } });
    expect(laeuft(laufend)).toBe(true);
    expect(restNach(laufend, 60)).toBe(19 * 60);
    expect(restNach(lage(), 60)).toBe(20 * 60);
  });

  it('geht nie unter null und kennt «unbegrenzt»', () => {
    const laufend = lage({ sitzung: { konsole: 'ps5', seit: 0 } });
    expect(restNach(laufend, 99999)).toBe(0);
    expect(restNach(lage({ rest_s: null }), 60)).toBeNull();
  });
});
