import { CommandData, EntityState } from '../api/types';

/**
 * Das Angebot, die letzte Schaltung zurückzunehmen.
 *
 * Welcher Befehl den alten Zustand wiederherstellt und wie man das in
 * einem Wort sagt – beides ist entscheidbar und gehört deshalb hierher,
 * neben den Hub-Hook und nicht hinein.
 */

/**
 * Befehle, deren Wirkung sich sauber umkehren lässt.
 *
 * Lange standen hier nur an, aus und Helligkeit - also die Griffe, bei
 * denen ein Fehlgriff am wenigsten wehtut. Gerade Storen, Thermostate
 * und Lautstärke sind die, deren alten Wert man hinterher nicht mehr
 * weiss: «Die Store war vorher irgendwo bei 40» ist keine Angabe, mit
 * der man sie zurückstellt.
 */
const UNDOABLE = new Set([
  'turn_on',
  'turn_off',
  'toggle',
  'set_brightness',
  'open',
  'close',
  'set_position',
  'set_tilt',
  'set_temperature',
  'set_volume',
  'unlock',
  'unlatch',
  'start',
]);

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
  command: string,
  kind = 'light',
  commands: readonly string[] = []
): { command: string; data?: CommandData } | null {
  if (!UNDOABLE.has(command)) return null;

  if (kind === 'cover') {
    // Die Position zuerst: Sie ist die Angabe, die man hinterher nicht
    // mehr weiss. Kann die Store keine Position, bleibt auf oder zu -
    // gröber, aber immer noch besser als nichts.
    if (command === 'set_tilt') {
      return typeof before.tilt === 'number'
        ? { command: 'set_tilt', data: { tilt: before.tilt } }
        : null;
    }
    if (typeof before.position === 'number' && commands.includes('set_position')) {
      return { command: 'set_position', data: { position: before.position } };
    }
    if (before.state === 'closed') return { command: 'close' };
    if (before.state === 'open') return { command: 'open' };
    return null;
  }

  if (kind === 'lock') {
    // Nur in die sichere Richtung: Ein versehentliches Aufschliessen
    // lässt sich zurücknehmen, ein versehentliches Abschliessen nicht -
    // ein Band unter dem Daumen, das die Haustüre öffnet, wäre genau
    // der Knopf, den es hier nicht geben soll. Wer wirklich zugesperrt
    // hat und das nicht wollte, macht es an der Kachel auf.
    return before.state === 'locked' ? { command: 'lock' } : null;
  }

  if (command === 'set_temperature') {
    return typeof before.target === 'number'
      ? { command: 'set_temperature', data: { temperature: before.target } }
      : null;
  }

  if (command === 'set_volume') {
    return typeof before.volume === 'number'
      ? { command: 'set_volume', data: { volume: before.volume } }
      : null;
  }

  if (kind === 'vacuum') {
    // Auch hier nur die eine Richtung: Den losgeschickten Sauger
    // zurückzurufen ist harmlos, ihn ungefragt loszuschicken nicht.
    return command === 'start' ? { command: 'dock' } : null;
  }

  if (before.state === 'off') return { command: 'turn_off' };
  if (before.state !== 'on') return null;
  if (typeof before.brightness === 'number') {
    return { command: 'set_brightness', data: { brightness: before.brightness } };
  }
  return { command: 'turn_on' };
}

/**
 * Was gerade passiert ist, in einem Wort – für das Rückgängig-Band
 * (rein, testbar).
 *
 * Aus dem Befehl abgeleitet und nicht aus dem erwarteten Zustand: Den
 * gab es nur für Licht und Schalter (`expectedState` in useHub), und
 * ihn für Storen mitzurechnen hiesse, ihre Fahrt-Animation zu stören -
 * die lebt davon, dass der gemeldete Wert erst später springt.
 */
export function undoLabel(
  before: EntityState,
  command: string,
  data?: CommandData,
  kind = 'light'
): string {
  if (kind === 'cover') {
    if (command === 'set_tilt') return 'Lamellen gestellt';
    if (command === 'open') return 'hochgefahren';
    if (command === 'close') return 'heruntergefahren';
    if (command === 'set_position') {
      const vorher = typeof before.position === 'number' ? before.position : null;
      const ziel = Number(data?.position);
      if (vorher === null || !Number.isFinite(ziel)) return 'gestellt';
      return ziel > vorher ? 'hochgefahren' : 'heruntergefahren';
    }
    return 'gestellt';
  }
  if (kind === 'lock') return 'aufgeschlossen';
  if (kind === 'vacuum') return 'losgeschickt';
  if (command === 'set_temperature') return 'Temperatur gestellt';
  if (command === 'set_volume') return 'Lautstärke gestellt';
  if (command === 'set_brightness') {
    return Number(data?.brightness) > 0 ? 'gedimmt' : 'ausgeschaltet';
  }
  if (command === 'turn_off') return 'ausgeschaltet';
  if (command === 'turn_on') return 'eingeschaltet';
  // Bleibt der Umschalter: Was er getan hat, sagt der Zustand von vorher.
  return before.state === 'on' ? 'ausgeschaltet' : 'eingeschaltet';
}
