/**
 * Der Ein/Aus-Knopf auf einer Lautsprecher-Kachel.
 *
 * Jede andere Kachel hat ihn unten rechts; die Musikkachel hatte nur
 * Play/Pause. Das ist nicht dasselbe: Pause hält die Sitzung auf der
 * Box fest – der Empfänger bleibt besetzt, und vom Telefon aus weckt
 * ihn jeder Handgriff wieder auf. «Aus» heisst, die Box steht wieder
 * frei da.
 *
 * Der Knopf ist ehrlich in beide Richtungen:
 *
 * - Es läuft etwas → an, und Drücken schaltet aus.
 * - Es ist pausiert → aus, und Drücken spielt weiter. Das ist das
 *   «Ein», das es bei einer Box gibt.
 * - Es läuft nichts → **kein Knopf**. Auf einer leeren Box gibt es
 *   nichts zu starten (der Hub sagt das auch so), und ein Knopf, der
 *   auf eine Fehlermeldung führt, ist schlimmer als keiner. Die Kachel
 *   schreibt in diesem Fall ohnehin «Nichts läuft».
 *
 * Für den Fernseher gilt das alles nicht: Dessen Knopf ist schon der
 * Netzschalter (`toggle`, siehe lib/fernsehkachel.ts) – dort wäre ein
 * zweiter Ein/Aus nur verwirrend.
 */

/** Zustände, in denen auf der Box wirklich etwas läuft. */
export const LAEUFT = ['playing', 'buffering'];

export interface Medienschalter {
  /** Steht der Knopf auf «an»? */
  an: boolean;
  /** Was ein Druck schickt. */
  command: string;
  label: string;
}

/**
 * Was der Ein/Aus-Knopf dieser Box tut – oder `null` (rein, testbar).
 *
 * `turn_off` bevorzugt, weil nur das die Sitzung wirklich beendet. Wo
 * eine Integration es nicht kann, bleibt `pause`: eine halbe Antwort,
 * aber die richtige Richtung.
 */
export function medienSchalter(
  zustand: unknown,
  commands: string[],
): Medienschalter | null {
  const stand = String(zustand ?? '');
  if (LAEUFT.includes(stand)) {
    const aus = commands.includes('turn_off') ? 'turn_off' : 'pause';
    if (!commands.includes(aus)) return null;
    return { an: true, command: aus, label: 'Ausschalten' };
  }
  if (stand === 'paused' && commands.includes('play')) {
    return { an: false, command: 'play', label: 'Weiterspielen' };
  }
  return null;
}
