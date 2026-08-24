/**
 * Das Kachelraster auf echten Gerätebreiten.
 *
 * Die Zahlen sind keine Erfindung: Es sind die Innenbreiten, die in
 * dieser Wohnung vorkommen – Fensterbreite minus 2 × 22 Punkte Rand.
 */
import { KACHEL_MINDEST, KAMERA_MINDEST, kachelBreite, spalten } from './raster';
import { space } from '../theme';

// Gerät → Innenbreite des Kachelbereichs (hochkant).
const GERAETE = {
  'iPhone SE (320)': 276,
  'iPhone SE / 13 mini (375)': 331,
  'iPhone 15 (390)': 346,
  'iPhone 15 Pro (393)': 349,
  'iPhone 15 Pro Max (430)': 386,
  'iPad mini quer (1133)': 1089,
};

describe('spalten', () => {
  it('gibt kleinen iPhones zwei Spalten – genau daran brach es', () => {
    // Vorher fielen 375 und 390 durch: die Startseite an 48 % plus
    // Lücke, die Geräteseite an der Schwelle 380.
    expect(spalten(GERAETE['iPhone SE / 13 mini (375)'])).toBe(2);
    expect(spalten(GERAETE['iPhone 15 (390)'])).toBe(2);
    expect(spalten(GERAETE['iPhone 15 Pro Max (430)'])).toBe(2);
  });

  it('lässt dem alten 320er eine Spalte', () => {
    // Zwei Kacheln à 131 Punkte wären schmaler als lesbar.
    expect(spalten(GERAETE['iPhone SE (320)'])).toBe(1);
  });

  it('deckelt breite Schirme bei drei', () => {
    expect(spalten(GERAETE['iPad mini quer (1133)'])).toBe(3);
    expect(spalten(4000)).toBe(3);
  });

  it('gibt Kameras mehr Fläche und dafür weniger Spalten', () => {
    const kamera = { mindest: KAMERA_MINDEST, hoechstens: 2 };
    expect(spalten(GERAETE['iPhone 15 Pro Max (430)'], kamera)).toBe(1);
    expect(spalten(GERAETE['iPad mini quer (1133)'], kamera)).toBe(2);
  });

  it('nimmt vor der Messung eine Spalte an', () => {
    // Zwei zu raten und dann umzubrechen sähe schlechter aus.
    expect(spalten(0)).toBe(1);
    expect(spalten(-10)).toBe(1);
    expect(spalten(Number.NaN)).toBe(1);
  });
});

describe('kachelBreite', () => {
  it('rechnet die Lücken heraus', () => {
    // 331 = 2 × 158 + 14 (eine Lücke), Rest fällt der Rundung zum Opfer.
    expect(kachelBreite(331, 2)).toBe(158);
    expect(kachelBreite(331, 1)).toBe(331);
  });

  it('verträgt Unfug', () => {
    expect(kachelBreite(0, 2)).toBe(0);
    expect(kachelBreite(300, 0)).toBe(0);
  });
});

describe('Die Kacheln passen wirklich nebeneinander', () => {
  // Das ist der Kern: Vorher ergaben zwei Kacheln à 48 % plus 14 Punkte
  // Lücke mehr als die Behälterbreite – und Flexbox brach um. Diese
  // Prüfung schlägt an, sobald das wieder passiert.
  it.each(Object.entries(GERAETE))('%s', (_name, breite) => {
    for (const mindest of [KACHEL_MINDEST, KAMERA_MINDEST]) {
      const anzahl = spalten(breite, { mindest });
      const kachel = kachelBreite(breite, anzahl);
      const gebraucht = kachel * anzahl + space.gap * (anzahl - 1);
      expect(gebraucht).toBeLessThanOrEqual(breite);
      // Und nicht unnötig schmal: Was übrig bleibt, reicht für keine
      // weitere Kachel.
      expect(breite - gebraucht).toBeLessThan(mindest);
    }
  });
});
