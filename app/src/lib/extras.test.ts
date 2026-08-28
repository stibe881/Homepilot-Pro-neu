/**
 * Was der Hub kann – und was ihm dafür fehlt.
 *
 * Der Anlass: Der Durchsage-Knopf tat nichts, weil dem Hub gTTS fehlte.
 * Erfahren hat man das erst beim Scheitern.
 */
import { Extra, geordnet, luecken, zustand } from './extras';

const ZEILEN: Extra[] = [
  { key: 'cast', title: 'Chromecast', detail: '', installed: true, needed: true },
  { key: 'speech', title: 'Sprachausgabe', detail: '', installed: false, needed: true },
  { key: 'pitboss', title: 'Pelletgrill', detail: '', installed: false, needed: false },
  { key: 'ring', title: 'Ring-Türklingel', detail: '', installed: true, needed: false },
];

describe('zustand', () => {
  it('unterscheidet fehlend, vorhanden und ungenutzt', () => {
    expect(zustand(ZEILEN[0])).toBe('da');
    expect(zustand(ZEILEN[1])).toBe('fehlt');
    expect(zustand(ZEILEN[2])).toBe('ungenutzt');
  });

  it('nennt Installiertes ungenutzt, wenn es hier niemand braucht', () => {
    // Sonst stünde neben der Ring-Klingel ein Haken, obwohl gar keine
    // angebunden ist.
    expect(zustand(ZEILEN[3])).toBe('ungenutzt');
  });
});

describe('geordnet', () => {
  it('stellt die Lücken nach oben und das Ungenutzte nach unten', () => {
    expect(geordnet(ZEILEN).map((zeile) => zeile.key)).toEqual([
      'speech',
      'cast',
      'pitboss',
      'ring',
    ]);
  });

  it('lässt die Vorlage in Ruhe', () => {
    const kopie = [...ZEILEN];
    geordnet(ZEILEN);
    expect(ZEILEN).toEqual(kopie);
  });
});

describe('luecken', () => {
  it('zählt nur, was hier gebraucht wird', () => {
    expect(luecken(ZEILEN)).toBe(1);
    expect(luecken([])).toBe(0);
  });
});
