import { bandReihenfolge, bandZeile } from './tagesband';

const JETZT = new Date('2026-03-14T23:18:00').getTime();
const um = (stunde: number, minute = 0) =>
  new Date(2026, 2, 14, stunde, minute).getTime() / 1000;

const eintrag = (alias: string, at: number, art = 'time') => ({
  automation_id: alias,
  alias,
  at,
  art,
});

describe('bandReihenfolge', () => {
  it('stellt das Kommende vor das Gelaufene', () => {
    const band = bandReihenfolge(
      [eintrag('Morgens', um(7)), eintrag('Nachtruhe', um(23, 45)), eintrag('Mittags', um(10))],
      JETZT
    );
    expect(band.map((k) => k.alias)).toEqual(['Nachtruhe', 'Mittags', 'Morgens']);
  });

  it('sortiert das Kommende aufsteigend – der nächste Termin zuerst', () => {
    const band = bandReihenfolge(
      [eintrag('Spaet', um(23, 50)), eintrag('Gleich', um(23, 20))],
      JETZT
    );
    expect(band.map((k) => k.alias)).toEqual(['Gleich', 'Spaet']);
  });

  it('sortiert das Gelaufene absteigend – zuletzt Geschehenes zuerst', () => {
    const band = bandReihenfolge(
      [eintrag('Frueh', um(7)), eintrag('Abends', um(18))],
      JETZT
    );
    expect(band.map((k) => k.alias)).toEqual(['Abends', 'Frueh']);
  });

  it('merkt jedem Eintrag an, ob er vorbei ist', () => {
    const band = bandReihenfolge([eintrag('Frueh', um(7)), eintrag('Spaet', um(23, 50))], JETZT);
    expect(band.map((k) => k.vorbei)).toEqual([false, true]);
  });

  it('verträgt eine fehlende Agenda und kaputte Zeitangaben', () => {
    expect(bandReihenfolge(undefined, JETZT)).toEqual([]);
    expect(bandReihenfolge([eintrag('Kaputt', Number.NaN)], JETZT)).toEqual([]);
  });
});

describe('bandZeile', () => {
  it('zählt, was heute noch kommt', () => {
    const band = bandReihenfolge(
      [eintrag('Frueh', um(7)), eintrag('A', um(23, 30)), eintrag('B', um(23, 50))],
      JETZT
    );
    expect(bandZeile(band)).toBe('Heute noch 2 Abläufe · 1 gelaufen');
  });

  it('sagt es im Singular', () => {
    const band = bandReihenfolge([eintrag('A', um(23, 30))], JETZT);
    expect(bandZeile(band)).toBe('Heute noch 1 Ablauf');
  });

  it('sagt spät abends, dass nichts mehr kommt', () => {
    const band = bandReihenfolge([eintrag('Frueh', um(7))], JETZT);
    expect(bandZeile(band)).toBe('Heute kommt nichts mehr · 1 gelaufen');
  });

  it('bleibt leer, wenn das Band leer ist', () => {
    expect(bandZeile([])).toBe('');
  });
});
