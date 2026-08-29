import { spalten } from './kamerawand';

describe('spalten', () => {
  it('gibt einer einzelnen Kamera die ganze Breite', () => {
    expect(spalten(390, 1)).toBe(1);
    expect(spalten(1200, 1)).toBe(1);
  });

  it('stapelt zwei auf dem Telefon untereinander', () => {
    // Zwei nebeneinander auf 390 Punkten sind zwei Briefmarken.
    expect(spalten(390, 2)).toBe(1);
  });

  it('nimmt auf dem Telefon ab drei Kameras zwei Spalten', () => {
    expect(spalten(390, 4)).toBe(2);
  });

  it('nutzt das Tablet aus', () => {
    expect(spalten(900, 4)).toBe(2);
    expect(spalten(1400, 4)).toBe(2);
    expect(spalten(1400, 6)).toBe(3);
  });
});
