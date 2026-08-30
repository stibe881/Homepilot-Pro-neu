import { chipSchrift, fensterHoehe } from './storenkachel';

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
