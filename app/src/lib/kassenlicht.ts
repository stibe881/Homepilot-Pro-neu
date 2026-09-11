/**
 * Die Kassenansicht: hell und wach (Punkt 443) - das Rechnen dazu.
 *
 * Ein Scanner misst den Unterschied zwischen hell und dunkel; ein
 * Telefon, das auf 30 % Helligkeit steht und nach zwanzig Sekunden
 * dunkel wird, ist an der Kasse das Problem, nicht der Code. Deshalb
 * dreht die Ansicht die Helligkeit hoch und hält den Bildschirm wach -
 * und stellt beides beim Schliessen zurück.
 */

/** So hell wird der Bildschirm an der Kasse. */
export const KASSEN_HELLIGKEIT = 1;

/** Ob der gemerkte Wert beim Schliessen zurückgestellt werden soll
 *  (rein, testbar). Nur ein brauchbarer Wert unter dem Kassenwert: Wer
 *  ohnehin auf voll stand, bekommt nichts zurückgedreht - und ein
 *  Fehlwert (Web, Lesefehler) darf den Bildschirm nicht auf 0 stellen. */
export function zurueckstellen(vorher: number | null | undefined): number | null {
  if (typeof vorher !== 'number' || !Number.isFinite(vorher)) return null;
  if (vorher < 0 || vorher >= KASSEN_HELLIGKEIT) return null;
  return vorher;
}
