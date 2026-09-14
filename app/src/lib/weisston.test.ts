import { WEISSTOENE, weissWort } from './weisston';

/**
 * Die drei Weisstöne - und dass sie die Spanne wirklich ausschöpfen.
 *
 * Aus dem Haus: «Wenn man auf Tageslicht stellt, ist es nicht das
 * Maximum an Kaltweiss.» Das stimmte: Tageslicht stand auf 200 Mirek
 * (5000 K), während eine Hue-Lampe bis 153 (6500 K) kann - 1500 Kelvin
 * verschenkt.
 */

const kelvin = (mirek: number) => Math.round(1_000_000 / mirek);

describe('WEISSTOENE', () => {
  it('reicht bis ans kalte Ende dessen, was eine Lampe kann', () => {
    const kalt = WEISSTOENE.find((ton) => ton.key === 'kalt');
    expect(kalt?.mirek).toBe(153);
    expect(kelvin(kalt!.mirek)).toBe(6536);
  });

  it('trifft die Wörter von der Lampenpackung', () => {
    // warmweiss unter 3300 K, neutralweiss dazwischen,
    // tageslichtweiss über 5300 K - das ist die Norm, nach der jeder
    // eine Glühbirne kauft.
    const [warm, neutral, kalt] = WEISSTOENE;
    expect(kelvin(warm.mirek)).toBeLessThan(3300);
    expect(kelvin(neutral.mirek)).toBeGreaterThan(3300);
    expect(kelvin(neutral.mirek)).toBeLessThan(5300);
    expect(kelvin(kalt.mirek)).toBeGreaterThan(5300);
  });

  it('steht von warm nach kalt', () => {
    // Die Reihenfolge ist die der Punkte im Raster - und warm zuerst,
    // weil es die häufigste Antwort ist.
    const mireks = WEISSTOENE.map((ton) => ton.mirek);
    expect(mireks).toEqual([...mireks].sort((a, b) => b - a));
  });
});

describe('weissWort', () => {
  it('nennt die drei beim Namen', () => {
    expect(weissWort(370)).toBe('warmweiss');
    expect(weissWort(250)).toBe('neutralweiss');
    expect(weissWort(153)).toBe('tageslichtweiss');
  });

  it('gibt allem anderen seine Kelvinzahl', () => {
    // Was aus einer von Hand geschriebenen config.yaml kommt oder aus
    // einem Ablauf von vor der Umstellung: Kelvin ist die Zahl, die auf
    // der Packung steht - Mirek kennt ausserhalb der Bridge niemand.
    expect(weissWort(200)).toBe('5000 K');
    expect(weissWort(286)).toBe('3497 K');
  });
});
