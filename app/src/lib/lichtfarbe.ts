/**
 * Welche Farbe die Lichtkachel trägt, solange sie brennt.
 *
 * Die Kachel ist neu selbst der Schalter, und wenn Licht brennt, trägt
 * sie dessen Farbe - man sieht am Bild, was im Zimmer los ist, statt es
 * aus «An» zu erschliessen. Vorher stand dafür eine leere Vorschaufläche
 * da, die genau dann nichts zeigte, wenn es nichts zu zeigen gab.
 *
 * Drei Quellen, in dieser Reihenfolge:
 *
 * 1. `color` - eine echte Farbe (Hex), wie sie Zigbee und Tuya melden.
 * 2. `color_temp` - Mirek, wie es Hue meldet: 153 ist kaltes Tageslicht,
 *    500 ist Kerzenschein. Daraus wird warm oder kühl.
 * 3. Nichts davon: warmes Weiss. Eine Lampe ohne Farbmeldung leuchtet
 *    im Haus fast immer warm, und Weiss auf Weiss sähe man nicht.
 *
 * Die Töne sind bewusst gedämpft: Eine Wand voller Kacheln in voller
 * Sättigung wäre ein Jahrmarkt, und die Schrift darauf unlesbar.
 */

/** Zwei Töne für den Verlauf, plus die Tinte, die darauf lesbar ist. */
export interface Lichtfarbe {
  von: string;
  bis: string;
  tinte: string;
}

/** Dunkle Tinte: Alle Kachelfarben hier sind hell genug dafür. Eine
 *  gedämpfte Fläche mit weisser Schrift wäre der schlechtere Handel -
 *  sie liest sich bei Sonne auf dem Balkon nicht mehr. */
const TINTE = '#2A2016';

/** Mireks, zwischen denen gemischt wird. Ausserhalb wird geklemmt. */
const KALT = 153;
const WARM = 500;

function zuRgb(wert: unknown): [number, number, number] | null {
  if (typeof wert !== 'string') return null;
  let text = wert.trim().replace(/^#/, '');
  if (text.length === 3) {
    text = text
      .split('')
      .map((zeichen) => zeichen + zeichen)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return null;
  return [
    parseInt(text.slice(0, 2), 16),
    parseInt(text.slice(2, 4), 16),
    parseInt(text.slice(4, 6), 16),
  ];
}

const zuHex = (rgb: [number, number, number]) =>
  `#${rgb.map((teil) => Math.max(0, Math.min(255, Math.round(teil))).toString(16).padStart(2, '0')).join('')}`;

/** Eine Farbe zum Weiss hin aufhellen (0 = unverändert, 1 = weiss). */
function heller(rgb: [number, number, number], anteil: number): [number, number, number] {
  return [
    rgb[0] + (255 - rgb[0]) * anteil,
    rgb[1] + (255 - rgb[1]) * anteil,
    rgb[2] + (255 - rgb[2]) * anteil,
  ];
}

/** Zwei Farben mischen (0 = ganz a, 1 = ganz b). */
function mischen(
  a: [number, number, number],
  b: [number, number, number],
  anteil: number
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * anteil,
    a[1] + (b[1] - a[1]) * anteil,
    a[2] + (b[2] - a[2]) * anteil,
  ];
}

/** Kaltes Tageslicht und Kerzenschein - dazwischen wird gemischt. */
const KALTWEISS: [number, number, number] = [214, 233, 255];
const WARMWEISS: [number, number, number] = [255, 205, 138];

/**
 * Die Kachelfarbe einer brennenden Lampe (rein, testbar).
 *
 * `null` heisst: nichts einfärben. Das gilt für ausgeschaltete Lampen -
 * eine dunkle Kachel ist die ehrlichste Anzeige für «aus».
 */
export function lichtkachel(state: Record<string, unknown>): Lichtfarbe | null {
  if (String(state?.state ?? '') !== 'on') return null;
  const rgb = zuRgb(state?.color);
  if (rgb) {
    // Gesättigte Gerätefarben (reines Rot, reines Blau) wären als Fläche
    // zu laut - aufgehellt bleiben sie erkennbar und tragen Schrift.
    return {
      von: zuHex(heller(rgb, 0.42)),
      bis: zuHex(heller(rgb, 0.14)),
      tinte: TINTE,
    };
  }
  const mirek = Number(state?.color_temp);
  if (Number.isFinite(mirek) && mirek > 0) {
    const anteil = Math.max(0, Math.min(1, (mirek - KALT) / (WARM - KALT)));
    const ton = mischen(KALTWEISS, WARMWEISS, anteil);
    return { von: zuHex(heller(ton, 0.18)), bis: zuHex(ton), tinte: TINTE };
  }
  return { von: '#FFE3BC', bis: '#FFC98A', tinte: TINTE };
}
