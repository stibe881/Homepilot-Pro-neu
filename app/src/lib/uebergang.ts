/**
 * Wie lange ein Zustandswechsel dauert (Punkt 292/443 der Werkbank).
 *
 * Eine Kachel sprang von aus auf an. Was dazwischen fehlt, ist nicht
 * Zierrat: Der Sprung ist der Grund, warum man zweimal tippt - man hat
 * nicht gesehen, dass beim ersten Mal schon etwas geschah. Ein kurzer
 * Übergang beantwortet die Frage «hat es genommen?», bevor der Hub
 * antwortet.
 *
 * Die Zahlen sind entscheidbar, also stehen sie hier und nicht in einer
 * Komponente: Was zu lang ist, fühlt sich träge an; was zu kurz ist,
 * sieht man nicht. Beides lässt sich nur festhalten, wenn es an einer
 * Stelle steht.
 */

/**
 * Der Übergang, wenn *ich* getippt habe.
 *
 * Kurz: Ich weiss ja, dass ich getippt habe - der Übergang bestätigt es
 * nur. Alles über 200 ms fühlt sich an, als hinge die App.
 */
export const EIGEN_MS = 140;

/**
 * Der Übergang, wenn etwas *von selbst* geschah.
 *
 * Länger: Hier sagt die Bewegung nicht «angekommen», sondern «sieh
 * her, da ändert sich etwas» - und das braucht mehr als einen
 * Wimpernschlag, sonst hat man es verpasst, während man woanders
 * hinsah. Ein Ablauf, der zwanzig Lichter schaltet, malt damit eine
 * Welle statt eines Blitzes.
 */
export const FREMD_MS = 320;

/**
 * Wie lange dieser Wechsel dauern soll (rein, testbar).
 *
 * ``seit`` ist der Zeitpunkt des letzten eigenen Tippens auf dieses
 * Gerät; ``jetzt`` die Uhr. Liegt das Tippen keine Sekunde zurück, war
 * ich es - alles andere kam von aussen.
 *
 * Eine Sekunde, weil so lange ein Befehl bis zum Gerät und zurück
 * braucht: Hue antwortet in 150 ms, Homematic über Funk auch mal in
 * 700. Kürzer gefasst wäre das eigene Schalten am langsamen Gerät
 * plötzlich «von selbst», und die Kachel bewegte sich anders als die
 * daneben.
 */
export const EIGEN_FENSTER_MS = 1000;

export function dauerMs(seit: number | null | undefined, jetzt: number): number {
  if (seit == null) return FREMD_MS;
  return jetzt - seit <= EIGEN_FENSTER_MS ? EIGEN_MS : FREMD_MS;
}

/**
 * Soll dieser Wechsel überhaupt animiert werden? (rein, testbar)
 *
 * Zwei Fälle bleiben aussen vor, und beide aus demselben Grund - eine
 * Bewegung, die nichts bedeutet, nutzt die ab, die etwas bedeutet:
 *
 * - **Der erste Aufbau.** Beim Öffnen der App wären sonst dreissig
 *   Kacheln gleichzeitig in Bewegung; das sieht nach Ladebalken aus,
 *   nicht nach Zustand.
 * - **Kein Wechsel.** Der Hub meldet auch dann, wenn nur ein Stern
 *   oder ein Name gesetzt wurde (siehe describe() in hooks/useHub.ts).
 */
export function bewegtSich(vorher: unknown, nachher: unknown): boolean {
  if (vorher === undefined) return false;
  return vorher !== nachher;
}
