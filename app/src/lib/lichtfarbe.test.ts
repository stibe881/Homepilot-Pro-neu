import { lichtkachel } from './lichtfarbe';

describe('lichtkachel', () => {
  it('faerbt nur, was brennt', () => {
    expect(lichtkachel({ state: 'off', color: '#FF0000' })).toBeNull();
    expect(lichtkachel({})).toBeNull();
    expect(lichtkachel({ state: 'on' })).not.toBeNull();
  });

  it('nimmt die gemeldete Farbe, aber gedaempft', () => {
    const farbe = lichtkachel({ state: 'on', color: '#FF0000' });
    // Aufgehellt: Reines Rot als Kachelflaeche waere zu laut, und die
    // Schrift darauf unlesbar.
    expect(farbe?.von).toBe('#ff6b6b');
    expect(farbe?.bis).toBe('#ff2424');
  });

  it('macht aus Mirek warm oder kuehl', () => {
    const warm = lichtkachel({ state: 'on', color_temp: 500 });
    const kalt = lichtkachel({ state: 'on', color_temp: 153 });
    expect(warm).not.toEqual(kalt);
    // Warm hat mehr Rot als Blau, kalt umgekehrt - das ist die ganze
    // Aussage der Farbtemperatur.
    const rot = (hex: string) => parseInt(hex.slice(1, 3), 16);
    const blau = (hex: string) => parseInt(hex.slice(5, 7), 16);
    expect(rot(warm!.bis)).toBeGreaterThan(blau(warm!.bis));
    expect(blau(kalt!.bis)).toBeGreaterThan(rot(kalt!.bis));
  });

  it('ohne Farbmeldung warmes Weiss', () => {
    // Der Normalfall im Haus: eine Lampe, die nur an/aus meldet.
    expect(lichtkachel({ state: 'on' })?.von).toBe('#FFE3BC');
  });

  it('unbrauchbare Farbwerte fallen auf die Temperatur oder Warmweiss zurueck', () => {
    expect(lichtkachel({ state: 'on', color: 'blau' })?.von).toBe('#FFE3BC');
    expect(lichtkachel({ state: 'on', color: 42, color_temp: 500 })?.bis).not.toBe(
      '#FFC98A'
    );
  });
});
