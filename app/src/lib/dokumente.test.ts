/**
 * Der Dokumentsafe kennt ein Ablaufdatum (Punkt 623): Der abgelaufene
 * Kinderpass fiel am Flughafen auf.
 */
import {
  ablaufSatz,
  ablaufTage,
  baldAblaufend,
  datumNormal,
  dokumenteVon,
  erneuert,
  gueltigBis,
  kachelSatz,
} from './dokumente';

const HEUTE = new Date(2026, 8, 13, 10, 0);

describe('dokumente', () => {
  it('versteht drei Schreibweisen des Datums', () => {
    expect(datumNormal('2027-03-15')).toBe('2027-03-15');
    expect(datumNormal('15.03.2027')).toBe('2027-03-15');
    // Auf den Monat genau: gilt bis Monatsende.
    expect(datumNormal('02.2028')).toBe('2028-02-29');
    expect(datumNormal('31.02.2027')).toBeNull();
    expect(datumNormal('13.2027')).toBeNull();
    expect(datumNormal('irgendwann')).toBeNull();
    expect(datumNormal('')).toBeNull();
  });

  it('rechnet die Tage und sagt sie wie ein Mensch', () => {
    expect(ablaufTage({ expires: '2026-09-25' }, HEUTE)).toBe(12);
    expect(ablaufTage({ expires: '2026-09-10' }, HEUTE)).toBe(-3);
    expect(ablaufTage({ text: 'Police' }, HEUTE)).toBeNull();
    expect(ablaufSatz({ expires: '2026-09-25' }, HEUTE)).toBe('läuft in 12 Tagen ab');
    expect(ablaufSatz({ expires: '2026-09-13' }, HEUTE)).toBe('läuft heute ab');
    expect(ablaufSatz({ expires: '2026-09-14' }, HEUTE)).toBe('läuft morgen ab');
    expect(ablaufSatz({ expires: '2026-09-12' }, HEUTE)).toBe('seit gestern abgelaufen');
    expect(ablaufSatz({ expires: '2026-09-10' }, HEUTE)).toBe('seit 3 Tagen abgelaufen');
    // Noch weit hin: nichts zu sagen.
    expect(ablaufSatz({ expires: '2027-09-10' }, HEUTE)).toBeNull();
  });

  it('schreibt «gültig bis», wie es eingetragen wurde', () => {
    expect(gueltigBis({ expires: '2027-03-15' })).toBe('gültig bis 15.03.2027');
    expect(gueltigBis({ expires: '3.2027' })).toBe('gültig bis 03.2027');
    expect(gueltigBis({})).toBeNull();
  });

  it('zählt für die Kachel, was bald abläuft - Dringendstes zuerst', () => {
    const docs = [
      { id: 'a', text: 'Pass', expires: '2026-10-20' },
      { id: 'b', text: 'Halbtax', expires: '2026-09-01' },
      { id: 'c', text: 'ID', expires: '2027-09-01' },
      { id: 'd', text: 'Police' },
    ];
    expect(baldAblaufend(docs, HEUTE).map((doc) => doc.id)).toEqual(['b', 'a']);
    expect(kachelSatz(docs, HEUTE)).toBe('2 laufen bald ab');
    expect(kachelSatz(docs.slice(0, 1), HEUTE)).toBe('1 läuft bald ab');
    expect(kachelSatz([], HEUTE)).toBeNull();
  });

  it('behält beim Erneuern den Verlauf', () => {
    const doc = { id: 'a', text: 'Pass', expires: '2026-10-20' };
    const patch = erneuert(doc, '2031-10-20', HEUTE, 'Stefan');
    expect(patch).toEqual({
      expires: '2031-10-20',
      log: [{ at: '2026-09-13', by: 'Stefan', expired: '2026-10-20' }],
    });
    const nochmal = erneuert({ ...doc, ...patch }, '2036-10-20', new Date(2031, 9, 1));
    expect(nochmal.log.map((eintrag) => eintrag.expired)).toEqual(['2031-10-20', '2026-10-20']);
    expect(nochmal.log[0].by).toBeNull();
  });

  it('findet die Dokumente eines Kindes mit Datum', () => {
    const docs = [
      { id: 'a', text: 'Pass Levin', member: 'Levin', expires: '03.2027' },
      { id: 'b', text: 'Impfausweis', member: 'Levin' },
      { id: 'c', text: 'ID Lina', member: 'Lina', expires: '2028-01-01' },
    ];
    expect(dokumenteVon(docs, 'Levin').map((doc) => doc.id)).toEqual(['a']);
    expect(dokumenteVon(null, 'Levin')).toEqual([]);
  });
});
