/**
 * Ist das Klima im Zimmer in Ordnung – als Wort, nicht als Zahl.
 *
 * «47 %» muss man deuten können, «21.3 °C» auch. Die Deutung ist aber
 * keine Geschmacksfrage: Unter 40 % Feuchte trocknen Schleimhäute aus
 * (der Winterfall, den niemand an der Zahl erkennt), über 65 % wächst
 * an kalten Aussenwänden Schimmel. Genau diese zwei Fälle sollen ein
 * Wort bekommen; dazwischen schweigt die Zeile – ein «gut» hinter
 * jedem Raum wäre Lärm, vor dem man das eine «zu trocken» übersieht.
 */

export type Ton = 'ok' | 'warn' | 'danger';

export interface Urteil {
  wort: string;
  ton: Ton;
}

/** Das Feuchte-Band: darunter zu trocken, darüber Schimmelgefahr. */
export const FEUCHTE_MIN = 40;
export const FEUCHTE_MAX = 60;

/** Was die Feuchte bedeutet – null im grünen Bereich (rein, testbar). */
export function feuchteUrteil(prozent: number | null | undefined): Urteil | null {
  if (prozent == null || !Number.isFinite(prozent)) return null;
  if (prozent < 30) return { wort: 'sehr trocken', ton: 'danger' };
  if (prozent < FEUCHTE_MIN) return { wort: 'zu trocken', ton: 'warn' };
  if (prozent > 65) return { wort: 'Schimmelgefahr', ton: 'danger' };
  if (prozent > FEUCHTE_MAX) return { wort: 'feucht', ton: 'warn' };
  return null;
}

/** Was die Temperatur bedeutet – null im grünen Bereich (rein, testbar).
 *
 * Die Grenzen sind bewusst weit: 17 Grad im Schlafzimmer sind kein
 * Fall für ein Wort, 15 schon. Wer es genauer will, liest die Zahl –
 * sie steht daneben.
 */
export function tempUrteil(grad: number | null | undefined): Urteil | null {
  if (grad == null || !Number.isFinite(grad)) return null;
  if (grad < 15) return { wort: 'kalt', ton: 'warn' };
  if (grad > 26.5) return { wort: 'heiss', ton: 'warn' };
  return null;
}

/**
 * Das eine Wort für die Zeile (rein, testbar).
 *
 * Die Feuchte gewinnt: «Schimmelgefahr» ist wichtiger als «warm», und
 * zwei Wörter je Zeile liest niemand mehr.
 */
export function klimaUrteil(
  grad: number | null | undefined,
  feuchte: number | null | undefined
): Urteil | null {
  return feuchteUrteil(feuchte) ?? tempUrteil(grad);
}

/** Position eines Werts auf dem Band 20–80 %, für den Punkt (rein). */
export function bandPosition(prozent: number): number {
  return Math.max(0, Math.min(1, (prozent - 20) / 60));
}
