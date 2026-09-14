/**
 * Wann das Wandpanel zur Startseite zurückkehrt (Punkt 582 der Werkbank).
 *
 * Drei Minuten ohne Berührung, dann steht wieder die Startseite - damit
 * im Flur keine offene Einkaufsliste hängen bleibt. Die Regel stand als
 * ein Vergleich im Takt der Startseite; sie steht jetzt hier, weil sie
 * eine Ausnahme bekommen hat: Ein Blatt, das «wach hält» (Kochmodus,
 * laufende Klingel, Grillblatt), setzt die Rückkehr aus. Wer mit Teig
 * an den Händen im Rezept blättert, tippt drei Minuten nichts - und
 * fand dann die Startseite vor, das Rezept weg.
 */

/** So lange ohne Berührung, dann zurück (Millisekunden). */
export const RUECKKEHR_NACH = 180_000;

/** Ist es Zeit für die Rückkehr? (rein, testbar) */
export function darfZurueck(jetzt: number, letzteBeruehrung: number, haeltWach: boolean): boolean {
  if (haeltWach) return false;
  return jetzt - letzteBeruehrung > RUECKKEHR_NACH;
}
