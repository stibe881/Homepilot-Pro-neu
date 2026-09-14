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

describe('lichtkachel und der Modus der Lampe (Punkt 651)', () => {
  // Aus dem Haus, mit Bild der Büro-Kachel: «Diese Karten sollen die
  // Farbe des Lichts haben. Wenn es kaltweiss ist, sollen sie kaltweiss
  // sein, wenn das Licht warmweiss eingestellt ist, auch warmweiss, und
  // wenn es z. B. grün ist, soll die Karte dasselbe Grün haben.»
  const rot = (hex: string) => parseInt(hex.slice(1, 3), 16);
  const blau = (hex: string) => parseInt(hex.slice(5, 7), 16);

  it('nimmt den Weisston, wenn die Lampe weiss leuchtet - auch mit Farbe daneben', () => {
    // Eine Hue-Lampe meldet immer beides: den Farbort ihres Weisspunktes
    // *und* den Weisston. Ohne den Modus trüge eine warmweiss brennende
    // Lampe den Farbort - eine fast weisse Fläche, auf der kalt und warm
    // nicht zu unterscheiden sind.
    const warm = lichtkachel({
      state: 'on',
      color: '#fff4e8',
      color_temp: 450,
      color_mode: 'weiss',
    });
    const kalt = lichtkachel({
      state: 'on',
      color: '#fff4e8',
      color_temp: 160,
      color_mode: 'weiss',
    });
    expect(rot(warm!.bis)).toBeGreaterThan(blau(warm!.bis));
    expect(blau(kalt!.bis)).toBeGreaterThan(rot(kalt!.bis));
  });

  it('nimmt die Farbe, wenn die Lampe bunt leuchtet', () => {
    const gruen = lichtkachel({
      state: 'on',
      color: '#2ED573',
      color_temp: 370,
      color_mode: 'farbe',
    });
    // Grün bleibt grün: mehr Grün als Rot und mehr Grün als Blau.
    const g = parseInt(gruen!.bis.slice(3, 5), 16);
    expect(g).toBeGreaterThan(rot(gruen!.bis));
    expect(g).toBeGreaterThan(blau(gruen!.bis));
  });

  it('bleibt ohne Modus bei der alten Reihenfolge', () => {
    // Nicht jede Anbindung meldet ihn - dann gilt weiter: erst die
    // Farbe, dann der Weisston.
    const ohne = lichtkachel({ state: 'on', color: '#FF0000', color_temp: 370 });
    expect(ohne?.von).toBe('#ff6b6b');
  });

  it('nimmt warmes Weiss, wenn «weiss» ohne Weisston kommt', () => {
    // Nicht die alte Farbe: Die Lampe sagt, dass sie *jetzt* weiss
    // leuchtet - dann wäre das gespeicherte Rot von gestern die
    // schlechtere Auskunft als der Normalfall im Haus.
    const halb = lichtkachel({ state: 'on', color: '#FF0000', color_mode: 'weiss' });
    expect(halb?.von).toBe('#FFE3BC');
  });
});
