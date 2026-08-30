/**
 * Dimmen mit einem Streichen über die Kachel.
 *
 * Der Fall: Eine ausgeschaltete Lampe auf 30 % zu bringen kostete drei
 * Griffe, und der erste blendet.
 */
import {
  SCHRITT,
  helligkeitAus,
  istWischen,
  lohntSenden,
} from './wischdimmen';

describe('istWischen', () => {
  it('lässt den Tipp einen Tipp bleiben', () => {
    expect(istWischen(3, 1)).toBe(false);
  });

  it('lässt das Scrollen scrollen', () => {
    // Senkrecht ist senkrecht, auch wenn der Finger leicht schräg
    // startet - sonst klebt die Seite an der ersten Lichtkachel.
    expect(istWischen(14, 40)).toBe(false);
  });

  it('erkennt das waagrechte Streichen', () => {
    expect(istWischen(30, 4)).toBe(true);
    expect(istWischen(-30, 4)).toBe(true);
  });
});

describe('helligkeitAus', () => {
  it('fängt beim jetzigen Wert an', () => {
    // Relativ und nicht absolut: Sonst spränge die Lampe beim Aufsetzen
    // des Fingers dorthin, wo man zufällig hingegriffen hat.
    expect(helligkeitAus(40, 0, 200)).toBe(40);
  });

  it('nimmt eine Kachelbreite als ganzen Bereich', () => {
    expect(helligkeitAus(40, 100, 200)).toBe(90);
    expect(helligkeitAus(40, -100, 200)).toBe(1);
  });

  it('geht nie auf null', () => {
    // Auf 0 zu streichen hiesse ausschalten, und dafür gibt es den Tipp.
    expect(helligkeitAus(20, -500, 200)).toBe(1);
  });

  it('bleibt bei 100 stehen', () => {
    expect(helligkeitAus(90, 500, 200)).toBe(100);
  });

  it('verträgt eine Kachel ohne gemessene Breite', () => {
    expect(helligkeitAus(55, 80, 0)).toBe(55);
  });
});

describe('lohntSenden', () => {
  it('schickt den ersten Wert immer', () => {
    expect(lohntSenden(null, 42)).toBe(true);
  });

  it('schweigt bei winzigen Schritten', () => {
    // Jeder Punkt Bewegung wäre ein Befehl je Bild, und die Bridge kommt
    // nicht nach.
    expect(lohntSenden(42, 43)).toBe(false);
    expect(lohntSenden(42, 42 + SCHRITT)).toBe(true);
  });

  it('erreicht die Enden sicher', () => {
    expect(lohntSenden(99, 100)).toBe(true);
    expect(lohntSenden(2, 1)).toBe(true);
    expect(lohntSenden(100, 100)).toBe(false);
  });
});
