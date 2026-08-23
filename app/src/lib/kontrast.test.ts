/**
 * Lesbarkeits-Untergrenzen der Theme-Palette.
 *
 * Die Schwellen sind bewusst als Untergrenzen gewählt, die die heutige
 * Palette einhält: Der Test soll nicht Perfektion erzwingen, sondern
 * verhindern, dass ein «etwas weicheres Grau» Text unbemerkt unlesbar
 * macht. Wer eine Schwelle senken will, tut es hier – sichtbar, nicht
 * zufällig.
 */
import { darkColors, lightColors, pinkColors } from '../theme';
import { contrast, parseColor, textContrast } from './kontrast';

// Die mittlere Verlaufsfarbe ist das, was hinter den Glaskacheln liegt.
const paletten = [
  { name: 'hell', colors: lightColors, hinter: lightColors.gradient[1] },
  { name: 'dunkel', colors: darkColors, hinter: darkColors.gradient[1] },
  // Pink war bisher nicht geprüft - und genau dort wurde am Grund
  // geschraubt, weil er violett statt pink las.
  { name: 'pink', colors: pinkColors, hinter: pinkColors.gradient[1] },
];

describe.each(paletten)('Palette $name', ({ colors, hinter }) => {
  it('hält Fliesstext gut lesbar (ink)', () => {
    expect(textContrast(colors.ink, colors.surface, hinter)).toBeGreaterThanOrEqual(7);
    expect(textContrast(colors.ink, colors.panel, colors.panel)).toBeGreaterThanOrEqual(7);
  });

  it('hält Nebentext lesbar (inkSoft)', () => {
    expect(textContrast(colors.inkSoft, colors.surface, hinter)).toBeGreaterThanOrEqual(3);
    expect(textContrast(colors.inkSoft, colors.panel, colors.panel)).toBeGreaterThanOrEqual(4);
  });

  it('lässt selbst Beiläufiges nicht verschwinden (inkFaint)', () => {
    expect(textContrast(colors.inkFaint, colors.surface, hinter)).toBeGreaterThanOrEqual(2);
  });

  it('hält die Signalfarben erkennbar (accent, danger)', () => {
    expect(textContrast(colors.accent, colors.surface, hinter)).toBeGreaterThanOrEqual(3);
    expect(textContrast(colors.danger, colors.surface, hinter)).toBeGreaterThanOrEqual(3);
    // warn ist im Hellen bewusst schwach (1.6) - die Farbe steht nie
    // allein, sondern immer an einem Symbol mit eigener Form. Sinkt sie
    // unter das heutige Mass, ist beim Ändern etwas schiefgegangen.
    expect(textContrast(colors.warn, colors.surface, hinter)).toBeGreaterThanOrEqual(1.5);
  });

  it('hält weisse Schrift auf dem Verlauf lesbar (onGradient)', () => {
    expect(
      contrast(parseColor(colors.onGradient), parseColor(hinter))
    ).toBeGreaterThanOrEqual(4);
  });
});

describe('kontrast-Werkzeuge', () => {
  it('rechnet die bekannten WCAG-Eckwerte', () => {
    expect(
      contrast(parseColor('#000000'), parseColor('#FFFFFF'))
    ).toBeCloseTo(21, 0);
    expect(contrast(parseColor('#777777'), parseColor('#777777'))).toBe(1);
  });

  it('weist unlesbare Farben zurück', () => {
    expect(() => parseColor('blau')).toThrow('Unlesbare Farbe');
  });
});


describe('Das pinke Erscheinungsbild ist pink, nicht violett', () => {
  /** Farbton in Grad – 0 rot, 120 grün, 240 blau. */
  const ton = (farbe: string): number => {
    const { r, g, b } = parseColor(farbe);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return 0;
    const spanne = max - min;
    const h =
      max === r
        ? ((g - b) / spanne) % 6
        : max === g
          ? (b - r) / spanne + 2
          : (r - g) / spanne + 4;
    return (h * 60 + 360) % 360;
  };

  it('hält den Grund in derselben Familie wie den Akzent', () => {
    // Genau daran lag es: Der Akzent stand bei 334 Grad - klares Pink -,
    // der Grund bei 313 bis 321, und das ist Violett. Die Fläche
    // entscheidet, nicht der Knopf: Sie füllt den Bildschirm.
    const akzent = ton(pinkColors.accent);
    expect(akzent).toBeGreaterThan(325);
    for (const stufe of pinkColors.gradient) {
      expect(Math.abs(ton(stufe) - akzent)).toBeLessThan(15);
    }
    expect(Math.abs(ton(pinkColors.panel) - akzent)).toBeLessThan(15);
  });

  it('lässt den Grund nicht ins Kastanienbraune kippen', () => {
    // Ein gedämpftes Rosa liest sich in dieser Dunkelheit braun. Die
    // Sattheit muss also mithalten.
    for (const stufe of pinkColors.gradient) {
      const { r, g, b } = parseColor(stufe);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      expect((max - min) / max).toBeGreaterThan(0.5);
    }
  });
});
