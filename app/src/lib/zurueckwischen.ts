/**
 * Von der linken Kante zurück.
 *
 * Einen Raum verliess man nur über «‹ Räume» oben links – also genau
 * dort, wo der Daumen auf einem grossen Telefon nicht hinkommt. Man
 * greift dafür um oder nimmt die zweite Hand, und beides für einen
 * Griff, den jede andere App auf dem Gerät mit einem Wischen erledigt.
 *
 * Die Geste beginnt an der Kante und nicht irgendwo: Ein Wischen mitten
 * auf der Seite gehört den Kacheln (dem Dimmen, dem Ziehen), und wer
 * eine Liste seitlich schiebt, meint selten «zurück». Die Kante ist der
 * eine Streifen, auf dem sonst nichts liegt – auf der Startseite ist es
 * der Seitenrand.
 */

/** Wie breit der Streifen an der Kante ist, in Punkten. Schmal genug,
 *  dass er neben dem Seitenrand (22 Punkte) keine Kachel berührt. */
export const KANTE = 24;

/** So weit muss der Finger nach rechts, bevor es «zurück» heisst. */
export const WEG = 56;

/** So viel steiler muss die Bewegung waagrecht als senkrecht sein.
 *  Sonst nimmt die Kante jedes Scrollen an, das am Rand beginnt. */
export const WAAGRECHT = 1.6;

/**
 * Fängt diese Berührung an der linken Kante an? (rein, testbar)
 *
 * Wird beim Aufsetzen gefragt, nicht während der Bewegung: Wer in der
 * Mitte aufsetzt und nach links fährt, hat die Kante nie berührt.
 */
export function anDerKante(x: number, kante: number = KANTE): boolean {
  return Number.isFinite(x) && x >= 0 && x <= kante;
}

/**
 * Ist das ein Zurück-Wischen? (rein, testbar)
 *
 * Nur nach rechts – nach links zieht man nichts zurück, und ein
 * beidseitiges Erkennen nähme dem Scrollen die Diagonale.
 */
export function istZurueck(dx: number, dy: number): boolean {
  return dx >= WEG && dx > Math.abs(dy) * WAAGRECHT;
}
