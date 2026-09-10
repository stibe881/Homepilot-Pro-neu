import { DICHTEN, lesen, masse } from './dichte';
import { FAVORIT_MINDEST, KACHEL_MINDEST } from './raster';
import { space } from '../theme';

describe('lesen', () => {
  it('fällt auf «normal» zurück', () => {
    // Eine kaputte Zeile darf höchstens dazu führen, dass es aussieht
    // wie bisher.
    expect(lesen(undefined)).toBe('normal');
    expect(lesen('unfug')).toBe('normal');
    expect(lesen('LUFTIG')).toBe('luftig');
  });
});

describe('masse', () => {
  it('lässt «normal» genau so, wie es war', () => {
    // Wer nichts einstellt, soll auch nichts merken.
    expect(masse('normal')).toEqual({
      mindest: KACHEL_MINDEST,
      favoritMindest: FAVORIT_MINDEST,
      luecke: space.gap,
    });
  });

  it('hält die Reihenfolge ein', () => {
    expect(masse('eng').mindest).toBeLessThan(masse('normal').mindest);
    expect(masse('normal').mindest).toBeLessThan(masse('luftig').mindest);
  });

  it('lässt bei «eng» den Namen noch stehen', () => {
    // Unter etwa 120 Punkten bricht «Wohnzimmer» um - dann wäre die
    // Dichte kein Gewinn, sondern eine Kürzung.
    expect(masse('eng').mindest).toBeGreaterThanOrEqual(120);
  });

  it('lässt die Lücke schwächer wachsen als die Kachel', () => {
    // Sonst sieht die Seite bei «luftig» leer aus statt grosszügig.
    const luftig = masse('luftig');
    const wuchsKachel = luftig.mindest / KACHEL_MINDEST;
    const wuchsLuecke = luftig.luecke / space.gap;
    expect(wuchsLuecke).toBeLessThan(wuchsKachel);
    expect(wuchsLuecke).toBeGreaterThan(1);
  });
});

describe('DICHTEN', () => {
  it('führt jede Stufe genau einmal und mit einem Wort dazu', () => {
    expect(DICHTEN.map((zeile) => zeile.key)).toEqual(['luftig', 'normal', 'eng']);
    for (const zeile of DICHTEN) {
      expect(zeile.label.length).toBeGreaterThan(0);
      expect(zeile.hinweis.length).toBeGreaterThan(0);
    }
  });
});
