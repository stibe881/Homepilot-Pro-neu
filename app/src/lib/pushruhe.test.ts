import {
  RUHE_AUS,
  ruhesatz,
  stillsatz,
  tageOrdnen,
  tageSatz,
  uhr,
  verpasstsatz,
} from './pushruhe';

describe('ruhesatz', () => {
  it('sagt, wie gross das Loch ist', () => {
    // «22 bis 7» liest sich harmlos; neun Stunden sagt einem, wie lange
    // die Batteriewarnung wartet.
    expect(ruhesatz({ enabled: true, from: 22, to: 7 })).toContain('9 Stunden');
  });

  it('rechnet auch am Tag richtig', () => {
    expect(ruhesatz({ enabled: true, from: 8, to: 15 })).toContain('7 Stunden');
  });

  it('nennt die ausgeschaltete Ruhezeit ausgeschaltet', () => {
    expect(ruhesatz(RUHE_AUS)).toMatch(/Aus/);
  });

  it('gleiche Zahlen sind keine Ruhezeit', () => {
    // Dieselbe Regel wie im Hub: ein Fenster von null Stunden, nicht
    // eines von vierundzwanzig.
    expect(ruhesatz({ enabled: true, from: 22, to: 22 })).toMatch(/Aus/);
  });
});

describe('stillsatz', () => {
  it('schweigt, wenn nichts stillsteht', () => {
    expect(stillsatz(null, 1000)).toBeNull();
    expect(stillsatz(500, 1000)).toBeNull();
  });

  it('zählt in Minuten, solange es welche sind', () => {
    expect(stillsatz(1000 + 20 * 60, 1000)).toBe('noch 20 Min still');
  });

  it('und danach in Stunden', () => {
    expect(stillsatz(1000 + 3 * 3600, 1000)).toBe('noch 3 Std still');
  });
});

describe('uhr', () => {
  it('bleibt im Tag', () => {
    expect(uhr(25)).toBe('1 Uhr');
    expect(uhr(-1)).toBe('23 Uhr');
  });
});

describe('verpasstsatz', () => {
  it('macht aus dem Grund einen Satz', () => {
    // Ein nacktes «Ruhezeit» neben einer Uhrzeit liest sich wie ein
    // Fehlercode.
    expect(verpasstsatz('Ruhezeit')).toMatch(/Ruhezeit/);
    expect(verpasstsatz('Ruhezeit')).not.toBe('Ruhezeit');
  });

  it('reicht Unbekanntes durch, statt es zu verschlucken', () => {
    expect(verpasstsatz('etwas Neues')).toBe('etwas Neues');
  });
});

// ── Wochentage (Punkt 479) ─────────────────────────────────────────────────

describe('Die Ruhezeit kennt Wochentage', () => {
  it('ordnet die Tage und macht aus allen sieben «egal»', () => {
    expect(tageOrdnen([3, 1, 1])).toEqual([1, 3]);
    expect(tageOrdnen([0, 1, 2, 3, 4, 5, 6])).toEqual([]);
    expect(tageOrdnen(undefined)).toEqual([]);
  });

  it('liest eine zusammenhängende Woche als Spanne', () => {
    expect(tageSatz([0, 1, 2, 3, 4])).toBe('Mo–Fr');
    expect(tageSatz([5, 6])).toBe('Sa, So');
    expect(tageSatz([0, 6])).toBe('Mo, So');
    expect(tageSatz([])).toBe('jeden Tag');
  });

  it('nennt die Tage im Satz nur, wenn sie etwas einschränken', () => {
    expect(ruhesatz({ enabled: true, from: 22, to: 7, days: [] })).toBe(
      'Still von 22 Uhr bis 7 Uhr – 9 Stunden.'
    );
    expect(ruhesatz({ enabled: true, from: 22, to: 7, days: [0, 1, 2, 3, 4] })).toBe(
      'Still von 22 Uhr bis 7 Uhr (Mo–Fr) – 9 Stunden.'
    );
  });
});
