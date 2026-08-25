/**
 * Lesbarkeits-Untergrenzen der Theme-Palette.
 *
 * Die Schwellen sind bewusst als Untergrenzen gewählt, die die heutige
 * Palette einhält: Der Test soll nicht Perfektion erzwingen, sondern
 * verhindern, dass ein «etwas weicheres Grau» Text unbemerkt unlesbar
 * macht. Wer eine Schwelle senken will, tut es hier – sichtbar, nicht
 * zufällig.
 */
import { darkColors, lightColors, mitternachtColors, pinkColors, sandColors } from '../theme';
import { contrast, parseColor, textContrast } from './kontrast';

// Die mittlere Verlaufsfarbe ist das, was hinter den Glaskacheln liegt.
const paletten = [
  { name: 'hell', colors: lightColors, hinter: lightColors.gradient[1] },
  { name: 'dunkel', colors: darkColors, hinter: darkColors.gradient[1] },
  // Pink war bisher nicht geprüft - und genau dort wurde am Grund
  // geschraubt, weil er violett statt pink las.
  { name: 'pink', colors: pinkColors, hinter: pinkColors.gradient[1] },
  { name: 'mitternacht', colors: mitternachtColors, hinter: mitternachtColors.gradient[1] },
  { name: 'sand', colors: sandColors, hinter: sandColors.gradient[1] },
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

  it('hält die Beschriftung auf einem ink-gefüllten Knopf lesbar', () => {
    // «Speichern & verbinden» und die Primärknöpfe unter System sind mit
    // `ink` gefüllt. In den dunklen Erscheinungsbildern ist ink fast
    // weiss – weisse Schrift darauf war schlicht unsichtbar (Kontrast
    // 1,1). `panel` ist in jeder Palette die deckende Gegenfarbe dazu.
    expect(
      contrast(parseColor(colors.panel), parseColor(colors.ink))
    ).toBeGreaterThanOrEqual(7);
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


describe('Das pinke Erscheinungsbild ist schwarz und neonpink', () => {
  /** Farbton in Grad – 0 rot, 120 grün, 240 blau. null bei Grau/Schwarz. */
  const ton = (farbe: string): number | null => {
    const { r, g, b } = parseColor(farbe);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return null;
    const spanne = max - min;
    const h =
      max === r
        ? ((g - b) / spanne) % 6
        : max === g
          ? (b - r) / spanne + 2
          : (r - g) / spanne + 4;
    return (h * 60 + 360) % 360;
  };

  /** Wie bunt, von 0 (grau) bis 1 (voll). */
  const sattheit = (farbe: string): number => {
    const { r, g, b } = parseColor(farbe);
    const max = Math.max(r, g, b);
    return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
  };

  /** Der hellste Kanal – das Mass dafür, wie dunkel eine Farbe ist. */
  const hellster = (farbe: string): number => {
    const { r, g, b } = parseColor(farbe);
    return Math.max(r, g, b);
  };

  it('hält den Akzent im Neonpink', () => {
    // Unter 320 Grad wird es Violett, über 340 Rot. Neon heisst
    // ausserdem: voll ausgesteuert und satt – ein gedämpftes Pink
    // leuchtet nicht.
    const akzent = ton(pinkColors.accent);
    expect(akzent).not.toBeNull();
    expect(akzent as number).toBeGreaterThan(320);
    expect(akzent as number).toBeLessThan(340);
    expect(sattheit(pinkColors.accent)).toBeGreaterThan(0.9);
    expect(hellster(pinkColors.accent)).toBe(255);
  });

  it('hält den Grund schwarz', () => {
    // Zweimal lag dieses Erscheinungsbild daneben, weil der Grund eine
    // Farbe hatte: erst Aubergine, dann Weinrot. Beides liest sich nicht
    // als Pink, sondern als Violett bzw. Kastanie. Der Grund ist
    // schwarz; das Pink kommt von dem, was darauf liegt.
    for (const stufe of [...pinkColors.gradient, pinkColors.panel]) {
      expect(hellster(stufe)).toBeLessThanOrEqual(40);
    }
  });

  it('lässt den Rest Farbe in derselben Familie wie den Akzent', () => {
    // Der oberste Verlaufsschritt trägt noch einen Hauch Pink, damit der
    // Verlauf eine Richtung hat. Wo überhaupt Farbe ist, muss es die
    // richtige sein – sonst schimmert wieder Violett durch.
    const akzent = ton(pinkColors.accent) as number;
    for (const stufe of [...pinkColors.gradient, pinkColors.panel]) {
      const stufenTon = ton(stufe);
      if (stufenTon === null) continue; // reines Schwarz hat keinen Ton
      expect(Math.abs(stufenTon - akzent)).toBeLessThan(15);
    }
  });

  it('trägt das Neon an der Kante der Kacheln', () => {
    // Dort sitzt das Erscheinungsbild: eine schmale, helle Linie im
    // Dunkeln. Wird sie farblos, ist von «neonpink» nichts mehr übrig –
    // dann wäre es schlicht ein schwarzes Erscheinungsbild.
    const kante = ton(pinkColors.surfaceBorder) as number;
    expect(kante).not.toBeNull();
    expect(Math.abs(kante - (ton(pinkColors.accent) as number))).toBeLessThan(15);
    expect(sattheit(pinkColors.surfaceBorder)).toBeGreaterThan(0.7);
  });
});
