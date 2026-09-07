/**
 * «Zuletzt gefeuert: vor 4 Monaten» - die Zeile am verwaisten Ablauf.
 */
import { verwaistZeile, zuletztGefeuert } from './verwaist';

const JETZT = 1_760_000_000_000;
const TAG = 86_400;
const vor = (tage: number) => JETZT / 1000 - tage * TAG;

describe('zuletztGefeuert', () => {
  it('sagt «noch nie», wenn der Hub kein Feuern kennt', () => {
    expect(zuletztGefeuert(null, JETZT)).toBe('noch nie');
    expect(zuletztGefeuert(undefined, JETZT)).toBe('noch nie');
    // 0 wäre 1970 - das ist kein Zeitpunkt, sondern «nie».
    expect(zuletztGefeuert(0, JETZT)).toBe('noch nie');
  });

  it('zählt unterhalb von zwei Monaten in Tagen', () => {
    expect(zuletztGefeuert(vor(45), JETZT)).toBe('vor 45 Tagen');
    expect(zuletztGefeuert(vor(1), JETZT)).toBe('vor einem Tag');
    expect(zuletztGefeuert(vor(0), JETZT)).toBe('heute');
  });

  it('zählt ab zwei Monaten in Monaten', () => {
    // Der Normalfall der Verwaisten-Zeile: Die 90-Tage-Grenze des Hubs
    // liegt bei drei Monaten - Tage müsste man erst ausrechnen.
    expect(zuletztGefeuert(vor(122), JETZT)).toBe('vor 4 Monaten');
    expect(zuletztGefeuert(vor(65), JETZT)).toBe('vor 2 Monaten');
  });

  it('zählt ab einem Jahr in Jahren', () => {
    expect(zuletztGefeuert(vor(400), JETZT)).toBe('vor einem Jahr');
    expect(zuletztGefeuert(vor(800), JETZT)).toBe('vor 2 Jahren');
  });

  it('lässt sich von Unsinn nicht beirren', () => {
    expect(zuletztGefeuert(Number.NaN, JETZT)).toBe('noch nie');
    // Eine falsch gestellte Uhr (Zeitpunkt in der Zukunft) heisst
    // «heute», nicht «vor -3 Tagen».
    expect(zuletztGefeuert(JETZT / 1000 + 3 * TAG, JETZT)).toBe('heute');
  });
});

describe('verwaistZeile', () => {
  it('baut die ganze Zeile', () => {
    expect(verwaistZeile(vor(122), JETZT)).toBe('Zuletzt gefeuert: vor 4 Monaten');
    expect(verwaistZeile(null, JETZT)).toBe('Zuletzt gefeuert: noch nie');
  });
});
