/**
 * Die Verlaufskurve und ihre eigentliche Frage.
 *
 * Sie war eine Linie auf einem leeren Feld: Man sah, dass es auf und ab
 * ging, aber nicht, ob das viel ist.
 */
import {
  MIN_ABWEICHUNG,
  Punkt,
  flaeche,
  mittel,
  spanne,
  teile,
  vergleich,
  verschiebe,
  wovon,
} from './verlaufkurve';

const STUNDE = 3600_000;
const JETZT = 1_700_000_000_000;

const reihe = (werte: number[], abVor: number): Punkt[] =>
  werte.map((value, index) => ({ at: JETZT - abVor * STUNDE + index * STUNDE, value }));

describe('teile', () => {
  it('schneidet am gerechneten Zeitpunkt, nicht in der Mitte der Liste', () => {
    // Messwerte kommen nicht gleichmässig - eine Nacht ohne Bewegung
    // verschöbe einen Schnitt nach Anzahl um Stunden.
    const punkte: Punkt[] = [
      { at: JETZT - 40 * STUNDE, value: 1 },
      { at: JETZT - 30 * STUNDE, value: 2 },
      { at: JETZT - 2 * STUNDE, value: 3 },
      { at: JETZT - 1 * STUNDE, value: 4 },
      { at: JETZT, value: 5 },
    ];
    const geteilt = teile(punkte, 24, JETZT);
    expect(geteilt.davor.map((p) => p.value)).toEqual([1, 2]);
    expect(geteilt.jetzt.map((p) => p.value)).toEqual([3, 4, 5]);
  });
});

describe('verschiebe', () => {
  it('legt die frühere Hälfte über die jetzige', () => {
    // Damit man Montag mit Montag vergleicht statt Anfang mit Ende.
    const [punkt] = verschiebe([{ at: JETZT - 48 * STUNDE, value: 7 }], 24);
    expect(punkt.at).toBe(JETZT - 24 * STUNDE);
    expect(punkt.value).toBe(7);
  });
});

describe('spanne', () => {
  it('nimmt beide Kurven zusammen', () => {
    // Zwei Massstäbe lägen übereinander und behaupteten Gleichheit, wo
    // keine ist.
    expect(spanne([reihe([10, 20], 4), reihe([5, 40], 8)])).toEqual({ min: 5, max: 40 });
  });

  it('verträgt eine flache Kurve', () => {
    expect(spanne([reihe([21, 21, 21], 3)])).toEqual({ min: 21, max: 22 });
  });

  it('verträgt gar keine Werte', () => {
    expect(spanne([[], []])).toEqual({ min: 0, max: 1 });
  });
});

describe('vergleich', () => {
  it('sagt, wie viel mehr es geworden ist', () => {
    const jetzt = reihe([110, 110, 110], 3);
    const davor = reihe([100, 100, 100], 30);
    expect(vergleich(jetzt, davor, 'in der Woche davor')).toBe(
      '10 % mehr als in der Woche davor'
    );
  });

  it('sagt auch, wenn es weniger geworden ist', () => {
    expect(vergleich(reihe([80, 80, 80], 3), reihe([100, 100, 100], 30), 'am Vortag')).toBe(
      '20 % weniger als am Vortag'
    );
  });

  it('nennt kleine Unterschiede gleich', () => {
    // Unter der Rauschschwelle wäre jede Zahl eine, die bei jedem
    // Öffnen anders lautet.
    const knapp = 100 + (MIN_ABWEICHUNG - 2);
    expect(vergleich(reihe([knapp, knapp, knapp], 3), reihe([100, 100, 100], 30), 'sonst')).toBe(
      'gleich wie sonst'
    );
  });

  it('schweigt bei zu wenig Verlauf', () => {
    expect(vergleich(reihe([10], 1), reihe([10, 10, 10], 30), 'sonst')).toBeNull();
  });

  it('schweigt, wo vorher null stand', () => {
    // Ein Prozentwert von null wäre unendlich.
    expect(vergleich(reihe([5, 5, 5], 3), reihe([0, 0, 0], 30), 'sonst')).toBeNull();
  });
});

describe('wovon', () => {
  it('nennt den Zeitraum beim Namen', () => {
    expect(wovon(24)).toBe('am Vortag');
    expect(wovon(24 * 7)).toBe('in der Woche davor');
    expect(wovon(24 * 30)).toBe('im Monat davor');
  });
});

describe('flaeche', () => {
  it('schliesst die Linie zum Boden', () => {
    expect(flaeche('M 0 10 L 100 20', 0, 100, 50)).toBe('M 0 10 L 100 20 L 100 50 L 0 50 Z');
  });

  it('macht aus nichts nichts', () => {
    expect(flaeche('', 0, 100, 50)).toBe('');
  });
});

describe('mittel', () => {
  it('rechnet erst ab genug Werten', () => {
    expect(mittel(reihe([2, 4], 2))).toBeNull();
    expect(mittel(reihe([2, 4, 6], 3))).toBe(4);
  });
});
