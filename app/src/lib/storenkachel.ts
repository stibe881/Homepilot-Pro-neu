/**
 * Masse der Storen-Kachel, abhängig von ihrer Breite (rein, testbar).
 *
 * Auf dem Telefon stehen zwei Kacheln nebeneinander, und die halbe
 * Breite hat zwei Probleme gezeigt: «Beschattung» brach mitten im Wort
 * («Beschattun g»), und das Fenster in voller Höhe machte die Kachel
 * fast doppelt so hoch wie ihre Nachbarn. Die Grenze von 210 liegt
 * bewusst über der iPhone-Halbkachel (~170) und unter der
 * iPad-Kachel (~240).
 */

/** Höhe der Fenstergrafik. 0 heisst: noch nicht gemessen - dann die volle. */
export function fensterHoehe(breite: number): number {
  if (breite <= 0) return 128;
  return breite < 210 ? 92 : 128;
}

/** Schriftgrösse der Stellungs-Chips - kleiner, wo «Beschattung» sonst bricht. */
export function chipSchrift(breite: number): number {
  if (breite <= 0) return 12;
  return breite < 210 ? 11 : 12;
}
