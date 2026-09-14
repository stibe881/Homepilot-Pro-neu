import { chipSchrift, fensterHoehe, lattenZahl } from './storenkachel';

describe('fensterHoehe', () => {
  it('verkleinert das Fenster auf der halben Telefonbreite', () => {
    expect(fensterHoehe(170)).toBe(92);
  });

  it('lässt es auf iPad-Kacheln in voller Höhe', () => {
    expect(fensterHoehe(240)).toBe(128);
  });

  it('nimmt vor der ersten Messung die volle Höhe', () => {
    expect(fensterHoehe(0)).toBe(128);
  });
});

describe('chipSchrift', () => {
  it('wird auf schmalen Kacheln kleiner, damit «Beschattung» ganz bleibt', () => {
    expect(chipSchrift(170)).toBe(11);
    expect(chipSchrift(240)).toBe(12);
  });
});

describe('lattenZahl', () => {
  it('nimmt nur ganze Latten, die ins Fenster passen', () => {
    // Punkt 576: Eine Latte zu viel ragte über das Bild hinaus und blieb
    // beim ganz offenen Store als Streifen oben stehen.
    expect(lattenZahl(128, 15)).toBe(8);
    expect(lattenZahl(150, 15)).toBe(10);
    expect(lattenZahl(10, 15)).toBe(1);
  });
});
