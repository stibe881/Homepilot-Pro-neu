/**
 * Wie viele Kameras nebeneinander passen.
 *
 * Reines Rechnen, getrennt von der Wand selbst: Zwei Kameras
 * nebeneinander auf einem Telefon sind zwei Briefmarken, sechs auf einem
 * Tablet in einer Spalte sind eine Liste. Wo die Grenze liegt, ist
 * entscheidbar – und lässt sich nur prüfen, wenn es für sich steht.
 */

/** Wie viele Kacheln nebeneinander passen (rein, testbar). */
export function spalten(breite: number, anzahl: number): number {
  if (anzahl <= 1) return 1;
  if (breite < 700) return anzahl <= 2 ? 1 : 2;
  if (breite < 1100) return 2;
  return anzahl <= 4 ? 2 : 3;
}
