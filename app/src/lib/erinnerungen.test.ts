import { anzuzeigende, bestaetigung, faellige, monatsSprung, monatsraster, naechsteAt, naechsteFaelligkeit, offene, wiederholungVon, zeitpunkt } from './erinnerungen';

describe('zeitpunkt', () => {
  it('liest Schweizer Datum und Uhrzeit', () => {
    const ms = zeitpunkt('26.08.2026', '18:30');
    expect(ms).not.toBeNull();
    const d = new Date(ms!);
    expect([d.getDate(), d.getMonth() + 1, d.getFullYear()]).toEqual([26, 8, 2026]);
    expect([d.getHours(), d.getMinutes()]).toEqual([18, 30]);
  });

  it('nimmt auch 7.1.2027 und 7.05', () => {
    expect(zeitpunkt('7.1.2027', '7.05')).not.toBeNull();
  });

  it('weist Unlesbares ab', () => {
    expect(zeitpunkt('', '18:30')).toBeNull();
    expect(zeitpunkt('26.08.2026', '')).toBeNull();
    expect(zeitpunkt('morgen', '18:30')).toBeNull();
    expect(zeitpunkt('26.08.2026', '25:00')).toBeNull();
    expect(zeitpunkt('26.08.2026', '18:75')).toBeNull();
  });

  it('kennt den Kalender: den 31.02. gibt es nicht', () => {
    // JavaScript schöbe ihn stumm in den März - die Erinnerung käme
    // dann irgendwann, nur nicht dann, wann sie sollte.
    expect(zeitpunkt('31.02.2027', '10:00')).toBeNull();
  });
});

describe('faellige und offene', () => {
  const liste = [
    { id: 'a', text: 'Zahnarzt', at: 1000 },
    { id: 'b', text: 'Ofen aus', at: 500 },
    { id: 'c', text: 'Erledigt', at: 100, done: true },
    { id: 'd', text: 'Kaputt', at: 'keine Zahl' },
  ];

  it('offene: unbestätigt, lesbar, nach Zeit sortiert', () => {
    expect(offene(liste).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('fällig ist, was erreicht und nicht bestätigt ist', () => {
    expect(faellige(liste, 600).map((e) => e.id)).toEqual(['b']);
    expect(faellige(liste, 2000).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('eine Erinnerung verfällt nicht von selbst', () => {
    // Wer das Display erst abends sieht, soll die Erinnerung von
    // mittags noch vorfinden - dafür ist das Bestätigen da.
    expect(faellige(liste, 1e15).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('naechsteAt sagt, ob sich das Ticken lohnt', () => {
    expect(naechsteAt(liste)).toBe(500);
    expect(naechsteAt([])).toBeNull();
    expect(naechsteAt(undefined)).toBeNull();
  });
});

describe('monatsraster', () => {
  it('beginnt beim Montag und füllt Ränder mit null', () => {
    // August 2026: der 1. ist ein Samstag → fünf leere Plätze davor.
    const raster = monatsraster(2026, 8);
    expect(raster[0]).toEqual([null, null, null, null, null, 1, 2]);
    // Der 31. ist ein Montag → sechs leere danach.
    expect(raster[raster.length - 1]).toEqual([31, null, null, null, null, null, null]);
    expect(raster.every((woche) => woche.length === 7)).toBe(true);
  });

  it('kennt den Schaltfebruar', () => {
    const tage = monatsraster(2028, 2).flat().filter((t) => t !== null);
    expect(tage).toHaveLength(29);
  });

  it('blättert über den Jahresrand', () => {
    expect(monatsSprung(2026, 12, 1)).toEqual({ jahr: 2027, monat: 1 });
    expect(monatsSprung(2026, 1, -1)).toEqual({ jahr: 2025, monat: 12 });
  });
});

describe('anzuzeigende', () => {
  it('nur-Push-Eintraege bleiben dem Vollbild fern', () => {
    const liste = [
      { id: 'a', at: 100, anzeigen: false, push: true },
      { id: 'b', at: 100 },
      { id: 'c', at: 100, anzeigen: true },
    ];
    expect(anzuzeigende(liste, 200).map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('wer für sich quittiert hat, sieht sie nicht mehr - die anderen schon', () => {
    // Der Fall: Stefan drückt «Erledigt» (nur für sich). Auf seinem
    // Telefon verschwindet das Vollbild, am Wandpanel und bei Bine
    // bleibt es stehen, bis jemand «Für alle erledigt» drückt.
    const liste = [{ id: 'a', at: 100, quittiert: ['Stefan'] }];
    expect(anzuzeigende(liste, 200, 'Stefan')).toEqual([]);
    expect(anzuzeigende(liste, 200, 'Bine').map((e) => e.id)).toEqual(['a']);
    // Ohne bekannten Benutzer (Anmeldung noch unterwegs) lieber zeigen
    // als verschlucken.
    expect(anzuzeigende(liste, 200).map((e) => e.id)).toEqual(['a']);
  });

  it('quittiert verkraftet Unlesbares', () => {
    const liste = [{ id: 'a', at: 100, quittiert: 'Stefan' }];
    expect(anzuzeigende(liste, 200, 'Stefan').map((e) => e.id)).toEqual(['a']);
  });
});

describe('naechsteFaelligkeit', () => {
  const um = (j: number, m: number, t: number, h = 7, min = 0) =>
    new Date(j, m - 1, t, h, min).getTime();

  it('springt über verpasste Termine hinweg', () => {
    // Dienstag 7:00, bestätigt erst am Freitag: der nächste Termin ist
    // Samstag 7:00 - nicht drei nachgeholte auf einmal.
    const start = um(2026, 8, 25);
    expect(naechsteFaelligkeit(start, 'daily', um(2026, 8, 28, 12))).toBe(
      um(2026, 8, 29)
    );
    expect(naechsteFaelligkeit(start, 'weekly', um(2026, 8, 28, 12))).toBe(
      um(2026, 9, 1)
    );
  });

  it('der 31. rutscht im kurzen Monat und kehrt danach zurück', () => {
    const start = um(2026, 1, 31);
    expect(naechsteFaelligkeit(start, 'monthly', start)).toBe(um(2026, 2, 28));
    // Vom Februar aus weitergestellt: wieder der 31., nicht für immer der 28.
    expect(naechsteFaelligkeit(start, 'monthly', um(2026, 2, 28, 8))).toBe(
      um(2026, 3, 31)
    );
  });

  it('jährlich kennt den 29. Februar', () => {
    const start = um(2028, 2, 29);
    expect(naechsteFaelligkeit(start, 'yearly', start)).toBe(um(2029, 2, 28));
  });

  it('7 Uhr bleibt 7 Uhr - auch über die Zeitumstellung', () => {
    // Ende Oktober 2026 endet die Sommerzeit. In Millisekunden gerechnet
    // stünde die Erinnerung danach um 6 Uhr da.
    const start = um(2026, 10, 24, 7);
    const danach = naechsteFaelligkeit(start, 'weekly', start);
    expect(new Date(danach!).getHours()).toBe(7);
  });

  it('wiederholungVon liest nur Bekanntes', () => {
    expect(wiederholungVon({ id: 'a', repeat: 'weekly' })).toBe('weekly');
    expect(wiederholungVon({ id: 'a', repeat: 'none' })).toBeNull();
    expect(wiederholungVon({ id: 'a' })).toBeNull();
    expect(wiederholungVon({ id: 'a', repeat: 42 })).toBeNull();
  });

  it('ein kaputter Zeitpunkt ergibt keinen Termin', () => {
    expect(naechsteFaelligkeit(Number.NaN, 'daily', 0)).toBeNull();
  });

  it('bestaetigung: einmalig erledigt, wiederkehrend stellt frisch weiter', () => {
    expect(bestaetigung({ id: 'a', at: um(2026, 8, 25) }, um(2026, 8, 25, 8))).toEqual({
      done: true,
    });
    const weiter = bestaetigung(
      { id: 'b', at: um(2026, 8, 25), repeat: 'daily', quittiert: ['Stefan'], pushed: true },
      um(2026, 8, 25, 8)
    );
    // Frisch: die neue Ausgabe hat niemand weggedrückt, kein Push ist raus.
    expect(weiter).toEqual({ at: um(2026, 8, 26), quittiert: [], pushed: false });
    // Kaputter Zeitpunkt: lieber erledigen als für immer offen stehen.
    expect(bestaetigung({ id: 'c', at: 'quatsch', repeat: 'daily' }, 0)).toEqual({
      done: true,
    });
  });
});
