/**
 * Was oben in der Kopfzeile als «3 an» mitzählt.
 *
 * Die Zahl beantwortet eine Frage beim Hinausgehen: «Brennt noch etwas?»
 * Manche Geräte gehören nicht in diese Antwort – der Kühlschrank, die
 * Umwälzpumpe, ein Grow-Licht, das absichtlich Tag und Nacht läuft. Sie
 * standen bisher trotzdem darin, und wer sie loswerden wollte, musste
 * die Kachel ganz ausblenden: Dann verschwand sie auch von der
 * Startseite, und schalten liess sie sich nur noch über die Geräteliste.
 *
 * Deshalb zwei getrennte Listen. `hidden` heisst «will ich nicht sehen»,
 * `ungezaehlt` heisst «zählt nicht als Licht, das noch brennt». Das
 * Zweite lässt die Kachel, wo sie ist.
 */

import { Entity } from '../api/types';

/** Zählt dieses Gerät als «an» in der Kopfzeile? (rein, testbar) */
export function zaehltMit(
  entity: Entity,
  hidden: string[],
  ungezaehlt: string[]
): boolean {
  if (entity.kind !== 'light' && entity.kind !== 'switch') return false;
  if (entity.state.state !== 'on') return false;
  if (hidden.includes(entity.id)) return false;
  if (ungezaehlt.includes(entity.id)) return false;
  // Sonst zählte eine Deckenlampe mit fünf Spots sechsmal: einmal als
  // Leuchte und fünfmal einzeln.
  if (entity.combined_into) return false;
  return true;
}

/** Die Geräte hinter der Zahl (rein, testbar). */
export function gezaehlteLichter(
  entities: Entity[],
  hidden: string[],
  ungezaehlt: string[]
): Entity[] {
  return entities.filter((entity) => zaehltMit(entity, hidden, ungezaehlt));
}

/**
 * Lässt sich dieses Gerät aus der Zählung nehmen? (rein, testbar)
 *
 * Nur Licht und Schalter: Die Zahl zählt nichts anderes, und ein Eintrag
 * im Menü einer Kamera wäre ein Knopf ohne Wirkung.
 */
export function zaehlbar(entity: { kind?: string }): boolean {
  return entity.kind === 'light' || entity.kind === 'switch';
}
