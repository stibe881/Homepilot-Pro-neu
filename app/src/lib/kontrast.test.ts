/**
 * Lesbarkeits-Untergrenzen der Theme-Palette.
 *
 * Die Schwellen sind bewusst als Untergrenzen gewählt, die die heutige
 * Palette einhält: Der Test soll nicht Perfektion erzwingen, sondern
 * verhindern, dass ein «etwas weicheres Grau» Text unbemerkt unlesbar
 * macht. Wer eine Schwelle senken will, tut es hier – sichtbar, nicht
 * zufällig.
 */
import { darkColors, lightColors } from '../theme';
import { contrast, parseColor, textContrast } from './kontrast';

// Die mittlere Verlaufsfarbe ist das, was hinter den Glaskacheln liegt.
const paletten = [
  { name: 'hell', colors: lightColors, hinter: lightColors.gradient[1] },
  { name: 'dunkel', colors: darkColors, hinter: darkColors.gradient[1] },
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
