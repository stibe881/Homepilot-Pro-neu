import { Person } from './personen';
import {
  AKKU_KNAPP,
  akku,
  kopfzeile,
  lage,
  ortText,
  reihenfolge,
  unterZeile,
  uhrzeit,
} from './anwesenheitskarte';

const JETZT = new Date(2026, 7, 25, 22, 30);
const um = (h: number, m: number) => new Date(2026, 7, 25, h, m).getTime() / 1000;

const p = (over: Partial<Person>): Person => ({
  name: 'Stefan',
  zone: 'stefan',
  where: 'zuhause',
  source: 'geofence',
  ...over,
});

describe('Die Karte «Wer ist wo»', () => {
  it('kennt drei Lagen, nicht zwei', () => {
    // «unklar» ist keine Abwesenheit. Ein leeres Telefon meldet nichts,
    // und daraus «nicht zuhause» zu machen ist der Fehler, an dem ein
    // «alles aus» hängen kann.
    expect(lage(p({}))).toBe('da');
    expect(lage(p({ where: 'bei Tanners Home' }))).toBe('weg');
    expect(lage(p({ where: 'unterwegs' }))).toBe('weg');
    expect(lage(p({ where: 'unbekannt' }))).toBe('unklar');
    expect(lage(p({ where: null }))).toBe('unklar');
  });

  it('schreibt neben den Namen nur den Ort', () => {
    // Das «bei» gehört in einen Satz, nicht in eine Spalte.
    expect(ortText(p({ where: 'bei Tanners Home' }))).toBe('Tanners Home');
    expect(ortText(p({}))).toBe('zuhause');
    expect(ortText(p({ where: 'unbekannt' }))).toBe('unbekannt');
  });

  it('sagt darunter seit wann und woher – ohne Wiederholung', () => {
    // Vorher stand «Meldet sich regelmässig (über Life360). · Quelle:
    // Life360» – zweimal dasselbe in einer ohnehin zu langen Zeile.
    expect(unterZeile(p({ since: um(20, 7) }), JETZT)).toBe('seit 20:07 · Telefon');
    expect(unterZeile(p({ since: um(20, 7), source: 'life360' }), JETZT)).toBe(
      'seit 20:07 · Life360'
    );
    expect(unterZeile(p({ source: 'none' }), JETZT)).toBe('noch keine Meldung');
    expect(unterZeile(p({ zone: null, source: null }), JETZT)).toBe('keine Ortung');
  });

  it('nennt die Uhrzeit, nicht die Rechenaufgabe', () => {
    // Bei sieben Personen untereinander liest sich «seit 20:07» als
    // Spalte, «seit 3 Std. 12 Min.» als Rechenaufgabe.
    expect(uhrzeit(um(20, 7), JETZT)).toBe('seit 20:07');
    expect(uhrzeit(um(8, 5), JETZT)).toBe('seit 08:05');
    const gestern = new Date(2026, 7, 24, 22, 14).getTime() / 1000;
    expect(uhrzeit(gestern, JETZT)).toBe('seit gestern, 22:14');
    const vorwoche = new Date(2026, 7, 18, 9, 0).getTime() / 1000;
    expect(uhrzeit(vorwoche, JETZT)).toBe('seit 18.8.');
    // Nichts, Unsinn und Zukunft ergeben keine Zeile.
    expect(uhrzeit(null, JETZT)).toBe('');
    expect(uhrzeit(0, JETZT)).toBe('');
    expect(uhrzeit(um(23, 59), JETZT)).toBe('');
  });

  it('hebt einen knappen Akku hervor', () => {
    // Vorher stand «Akku 20 %» so grau da wie «Akku 90 %» - dabei ist
    // der leere Akku die häufigste Ursache für eine tote Ortung.
    expect(akku(p({ battery: 90 }))).toEqual({ prozent: 90, knapp: false });
    expect(akku(p({ battery: 20 }))).toEqual({ prozent: 20, knapp: true });
    expect(akku(p({ battery: AKKU_KNAPP }))?.knapp).toBe(true);
    // Kein Wert heisst kein Wert - nicht «0 %».
    expect(akku(p({ battery: null }))).toBeNull();
    expect(akku(p({}))).toBeNull();
  });

  it('gibt eine Antwort statt einer Zählung', () => {
    const alle = [p({}), p({ name: 'Bine', zone: 'bine' })];
    expect(kopfzeile(alle)).toBe('Alle zuhause');
    expect(
      kopfzeile([p({}), p({ name: 'Bine', zone: 'bine', where: 'unterwegs' })])
    ).toBe('Stefan zuhause');
    expect(
      kopfzeile([
        p({}),
        p({ name: 'Bine', zone: 'bine' }),
        p({ name: 'Maja', zone: 'maja', where: 'bei Tanners Home' }),
      ])
    ).toBe('Stefan und Bine zuhause');
    // Ab drei wird die Aufzählung länger als die Karte breit ist.
    expect(
      kopfzeile([
        p({}),
        p({ name: 'Bine', zone: 'bine' }),
        p({ name: 'Maja', zone: 'maja' }),
        p({ name: 'Pia', zone: 'pia', where: 'unterwegs' }),
      ])
    ).toBe('3 von 4 zuhause');
    expect(kopfzeile([p({ where: 'unterwegs' })])).toBe('Niemand zuhause');
    expect(kopfzeile([p({ where: 'unbekannt' })])).toBe('Niemand meldet sich');
    // Ein Wandtablet hat keine Zone und zählt nirgends mit.
    expect(kopfzeile([p({ zone: null })])).toBe('Niemand wird geortet');
    expect(kopfzeile([])).toBe('Niemand wird geortet');
  });

  it('stellt die nach vorn, die da sind – und die Stummen ans Ende', () => {
    const leute = [
      p({ name: 'Maja', zone: 'maja', where: 'unbekannt' }),
      p({ name: 'Pia', zone: 'pia', where: 'unterwegs' }),
      p({ name: 'Stefan', zone: 'stefan' }),
      // Ohne Zone gibt es nichts zu orten - die Zeile gehört nicht hierher.
      p({ name: 'Wandtablet', zone: null }),
    ];
    expect(reihenfolge(leute).map((x) => x.name)).toEqual(['Stefan', 'Pia', 'Maja']);
  });
});
