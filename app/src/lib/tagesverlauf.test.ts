/**
 * Der Hintergrund, der dem Tag folgt.
 *
 * Er sah morgens um sieben aus wie um Mitternacht. Geprüft wird hier
 * vor allem, dass die Bewegung leise bleibt: Nur der oberste Farbstopp
 * wandert, und mittags passiert gar nichts.
 */
import {
  FENSTER,
  MAX_ANTEIL,
  beimischung,
  stundeVon,
  tagesverlauf,
} from './tagesverlauf';

const SONNE = { sunrise: 6.5, sunset: 20.5 };
const BASIS = ['#8B9AB0', '#6C7C94', '#556579'];

describe('beimischung', () => {
  it('färbt am stärksten genau zum Sonnenaufgang', () => {
    expect(beimischung(6.5, SONNE)?.anteil).toBeCloseTo(MAX_ANTEIL);
  });

  it('lässt die Mittagsstunden in Ruhe', () => {
    // Zwischen den Ereignissen soll der Verlauf schlicht der sein, den
    // jemand einmal gewählt hat.
    expect(beimischung(13, SONNE)).toBeNull();
  });

  it('unterscheidet Morgenrot und Abendrot', () => {
    const morgen = beimischung(6.5, SONNE)!.farbe;
    const abend = beimischung(20.5, SONNE)!.farbe;
    expect(morgen).not.toEqual(abend);
  });

  it('wird tief in der Nacht kühl', () => {
    const nacht = beimischung(2, SONNE);
    expect(nacht).not.toBeNull();
    // Blaustich: mehr Blau als Rot - anders als bei den beiden Röten.
    expect(nacht!.farbe[2]).toBeGreaterThan(nacht!.farbe[0]);
  });

  it('lässt zwischen Dämmerung und Nacht keine Kante', () => {
    // Direkt am Rand des Dämmerungsfensters ist die Nacht noch bei null
    // und wächst erst danach - sonst spränge die Farbe.
    expect(beimischung(SONNE.sunset + FENSTER + 0.01, SONNE)?.anteil ?? 0).toBeLessThan(
      0.02
    );
  });

  it('färbt ohne Sonnenstand gar nicht', () => {
    // Polartag und Polarnacht: Eine geratene Dämmerung wäre schlimmer
    // als keine.
    expect(beimischung(12, null)).toBeNull();
  });
});

describe('tagesverlauf', () => {
  it('rührt nur den obersten Farbstopp an', () => {
    // Die beiden unteren tragen den Kontrast für die weisse Schrift der
    // Kopfzeile - färbte man sie mit, müsste man die Lesbarkeit zu jeder
    // Tageszeit neu prüfen.
    const verlauf = tagesverlauf(BASIS, 6.5, SONNE);
    expect(verlauf[0]).not.toBe(BASIS[0]);
    expect(verlauf[1]).toBe(BASIS[1]);
    expect(verlauf[2]).toBe(BASIS[2]);
  });

  it('gibt mittags genau den Verlauf zurück, der hineinging', () => {
    expect(tagesverlauf(BASIS, 13, SONNE)).toEqual(BASIS);
  });

  it('verträgt Farben, die kein einfaches Hex sind', () => {
    const mitRgba = ['rgba(10, 20, 30, 0.5)', '#6C7C94'];
    expect(tagesverlauf(mitRgba, 6.5, SONNE)).toEqual(mitRgba);
  });

  it('verträgt zu kurze Listen', () => {
    expect(tagesverlauf(['#8B9AB0'], 6.5, SONNE)).toEqual(['#8B9AB0']);
  });
});

describe('stundeVon', () => {
  it('macht aus halb acht 7,5', () => {
    expect(stundeVon(new Date(2026, 7, 30, 7, 30))).toBe(7.5);
  });
});
