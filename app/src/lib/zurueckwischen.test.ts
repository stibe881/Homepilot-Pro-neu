/**
 * Zurück von der linken Kante.
 *
 * Einen Raum verliess man nur über «‹ Räume» oben links - also genau
 * dort, wo der Daumen auf einem grossen Telefon nicht hinkommt.
 */
import { KANTE, WEG, anDerKante, istZurueck } from './zurueckwischen';

describe('anDerKante', () => {
  it('nimmt den schmalen Streifen am Rand', () => {
    expect(anDerKante(0)).toBe(true);
    expect(anDerKante(KANTE)).toBe(true);
  });

  it('lässt die Kacheln in Ruhe', () => {
    // Der Seitenrand ist 22 Punkte breit; ab dort beginnen die Kacheln,
    // und dort gehört das Wischen dem Dimmen und dem Ziehen.
    expect(anDerKante(KANTE + 1)).toBe(false);
    expect(anDerKante(200)).toBe(false);
  });

  it('verträgt Unsinn', () => {
    expect(anDerKante(NaN)).toBe(false);
    expect(anDerKante(-5)).toBe(false);
  });
});

describe('istZurueck', () => {
  it('braucht ein Stück Weg', () => {
    // Ein Zucken am Rand ist kein Zurück.
    expect(istZurueck(WEG - 1, 0)).toBe(false);
    expect(istZurueck(WEG, 0)).toBe(true);
  });

  it('lässt das Scrollen scrollen', () => {
    expect(istZurueck(60, 90)).toBe(false);
  });

  it('gilt nur nach rechts', () => {
    // Nach links zieht man nichts zurück - und ein beidseitiges
    // Erkennen nähme dem Scrollen die Diagonale.
    expect(istZurueck(-90, 0)).toBe(false);
  });
});
