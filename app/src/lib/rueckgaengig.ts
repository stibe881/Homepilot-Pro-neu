import { CommandData, EntityState } from '../api/types';

/**
 * Das Angebot, die letzte Schaltung zurückzunehmen.
 *
 * Welcher Befehl den alten Zustand wiederherstellt und wie man das in
 * einem Wort sagt – beides ist entscheidbar und gehört deshalb hierher,
 * neben den Hub-Hook und nicht hinein.
 */

/** Befehle, deren Wirkung sich sauber umkehren lässt. */
const UNDOABLE = new Set(['turn_on', 'turn_off', 'toggle', 'set_brightness']);

/** Ein versehentlich geschaltetes Gerät, das sich zurücknehmen lässt. */
export interface UndoOffer {
  entityId: string;
  name: string;
  label: string;
  command: string;
  data?: CommandData;
}

/**
 * Der Befehl, der den Zustand von vorher wiederherstellt (rein, testbar).
 *
 * Bewusst aus dem *alten Zustand* abgeleitet und nicht als Gegenstück zum
 * Befehl: Wer eine auf 30 % gedimmte Lampe ausschaltet, will beim
 * Rückgängigmachen wieder 30 % und nicht volle Helligkeit.
 *
 * ``null``, wenn der Ausgangszustand unbekannt war – dann lieber gar kein
 * Angebot als eines, das etwas anderes tut als es verspricht.
 */
export function undoCommand(
  before: EntityState,
  command: string
): { command: string; data?: CommandData } | null {
  if (!UNDOABLE.has(command)) return null;
  if (before.state === 'off') return { command: 'turn_off' };
  if (before.state !== 'on') return null;
  if (typeof before.brightness === 'number') {
    return { command: 'set_brightness', data: { brightness: before.brightness } };
  }
  return { command: 'turn_on' };
}

/** Was gerade passiert ist, in einem Wort – für das Rückgängig-Band. */
export function undoLabel(
  before: EntityState,
  after: EntityState
): string {
  if (after.state === 'off') return 'ausgeschaltet';
  if (before.state !== 'on') return 'eingeschaltet';
  if (after.brightness !== before.brightness) return 'gedimmt';
  return 'geschaltet';
}
