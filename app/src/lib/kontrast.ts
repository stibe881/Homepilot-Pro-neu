/**
 * WCAG-Kontrast für die Theme-Farben (rein, testbar).
 *
 * Die Palette in theme.tsx wird nach Gefühl gepflegt – und ein «etwas
 * weicheres Grau» kann Text unlesbar machen, ohne dass es beim Bauen
 * auffällt (auf dem hellen Monitor des Bauenden sieht alles gut aus).
 * Diese Funktionen rechnen nach, und der Test dazu hält die Untergrenzen
 * fest: Wer eine Farbe ändert, sieht im Testlauf, ob Text darauf noch
 * lesbar ist.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** «#RRGGBB» oder «rgba(r, g, b, a)» einlesen; wirft bei allem anderen. */
export function parseColor(text: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(text.trim());
  if (hex) {
    const value = parseInt(hex[1], 16);
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255, a: 1 };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
    text.trim()
  );
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  throw new Error(`Unlesbare Farbe: ${text}`);
}

/** Eine (halbtransparente) Farbe über einem deckenden Grund. */
export function composite(top: Rgba, base: Rgba): Rgba {
  const a = top.a + base.a * (1 - top.a);
  const mix = (t: number, b: number) => (t * top.a + b * base.a * (1 - top.a)) / a;
  return { r: mix(top.r, base.r), g: mix(top.g, base.g), b: mix(top.b, base.b), a };
}

/** Relative Leuchtdichte nach WCAG 2.x. */
export function luminance(color: Rgba): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** Kontrastverhältnis zweier deckender Farben (1 … 21). */
export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hell, dunkel] = la > lb ? [la, lb] : [lb, la];
  return (hell + 0.05) / (dunkel + 0.05);
}

/** Kontrast von Text über einem – womöglich halbtransparenten – Grund,
 *  der seinerseits auf einem deckenden Hintergrund liegt. */
export function textContrast(text: string, ground: string, behind: string): number {
  const hinter = parseColor(behind);
  const grund = composite(parseColor(ground), hinter);
  const schrift = composite(parseColor(text), grund);
  return contrast(schrift, grund);
}
