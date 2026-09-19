/**
 * Tippen und schalten: «licht küche aus» im Suchfeld.
 *
 * Die Suche ist der schnellste Weg durchs Haus – und endete bisher
 * immer bei einer Kachel, die man dann noch antippen musste. Wer «licht
 * küche aus» schreibt, hat schon gesagt, was er will.
 *
 * **Schlösser und Alarmanlage bleiben aussen vor.** Ein Suchfeld, das
 * bei «tür auf» die Haustüre aufmacht, ist kein Suchfeld mehr, sondern
 * ein Risiko – ein Tippfehler im Zug reicht. Für beides gibt es die
 * Kachel mit ihrer Rückfrage, und die soll man auch gehen.
 *
 * Geraten wird nichts Unsichtbares: Der Treffer steht als Zeile da
 * («Licht Küche einschalten») und wird erst auf Tippen ausgeführt. Ein
 * falsch verstandener Satz kostet damit einen Blick, keinen Handgriff.
 */
import { Entity } from '../api/types';

export interface Suchbefehl {
  entityId: string;
  /** Was passiert – als ganzer Satz für die Zeile. */
  satz: string;
  command: string;
  data?: Record<string, number>;
}

/** Gerätearten, die das Suchfeld niemals schaltet. */
export const TABU = ['lock', 'alarm'];

interface Verb {
  woerter: string[];
  command: string;
  /** Wie der Satz lautet, wenn dieses Verb gewinnt. */
  wort: string;
}

const VERBEN: Verb[] = [
  { woerter: ['an', 'ein', 'anschalten', 'einschalten', 'anmachen'], command: 'turn_on', wort: 'einschalten' },
  { woerter: ['aus', 'ausschalten', 'ausmachen', 'abschalten'], command: 'turn_off', wort: 'ausschalten' },
  { woerter: ['hoch', 'auf', 'öffnen', 'rauf'], command: 'open', wort: 'hochfahren' },
  { woerter: ['runter', 'zu', 'schliessen', 'schließen', 'herunter'], command: 'close', wort: 'herunterfahren' },
  { woerter: ['stopp', 'stop', 'halt'], command: 'stop', wort: 'anhalten' },
  { woerter: ['pause', 'pausieren'], command: 'pause', wort: 'pausieren' },
  { woerter: ['play', 'spielen', 'weiter'], command: 'play', wort: 'abspielen' },
];

/** Eine Prozentzahl im Text («40%», «auf 40») – oder null (rein, testbar). */
export function prozentAus(woerter: string[]): number | null {
  for (const wort of woerter) {
    const treffer = /^(\d{1,3})\s*%?$/.exec(wort);
    if (!treffer) continue;
    const zahl = Number(treffer[1]);
    if (zahl >= 0 && zahl <= 100) return zahl;
  }
  return null;
}

/** Passt das Gerät zu allen übrigen Wörtern? (rein, testbar) */
function passt(entity: Entity, woerter: string[]): boolean {
  const heuhaufen = `${entity.name} ${entity.room ?? ''}`.toLowerCase();
  return woerter.every((wort) => heuhaufen.includes(wort));
}

interface Grundlage {
  kandidaten: Entity[];
  verb: Verb | null;
  prozent: number | null;
}

/**
 * Kandidaten, Verb und Prozentzahl aus dem Text (rein, testbar) - die
 * gemeinsame Grundlage für den einzelnen Befehl und für die Mehrdeutigkeit.
 * null heisst: Das war eine Suche, keine Ansage.
 */
function grundlage(text: string, entities: Entity[]): Grundlage | null {
  const woerter = text
    .toLowerCase()
    .split(/\s+/)
    .map((wort) => wort.replace(/[.,!?]+$/, ''))
    .filter(Boolean);
  if (woerter.length < 2) return null;

  const prozent = prozentAus(woerter);
  const verb =
    VERBEN.find((eintrag) => woerter.some((wort) => eintrag.woerter.includes(wort))) ?? null;
  if (!verb && prozent === null) return null;

  // Was übrig bleibt, beschreibt das Gerät.
  const rest = woerter.filter(
    (wort) =>
      !VERBEN.some((eintrag) => eintrag.woerter.includes(wort)) &&
      !/^\d{1,3}\s*%?$/.test(wort)
  );
  if (rest.length === 0) return null;

  const kandidaten = entities
    .filter((entity) => !TABU.includes(entity.kind))
    .filter((entity) => passt(entity, rest));
  if (kandidaten.length === 0) return null;

  return { kandidaten, verb, prozent };
}

/** Der Prozent-Befehl für ein einzelnes Gerät, falls es dazu passt (rein, testbar). */
function prozentBefehl(entity: Entity, prozent: number): Suchbefehl | null {
  if (entity.commands.includes('set_brightness')) {
    return {
      entityId: entity.id,
      command: 'set_brightness',
      data: { brightness: prozent },
      satz: `${entity.name} auf ${prozent} %`,
    };
  }
  if (entity.commands.includes('set_position')) {
    return {
      entityId: entity.id,
      command: 'set_position',
      data: { position: prozent },
      satz: `${entity.name} auf ${prozent} %`,
    };
  }
  return null;
}

/**
 * Der Befehl hinter einem getippten Satz (rein, testbar).
 *
 * null heisst entweder: Das war eine Suche, keine Ansage - dann zeigt das
 * Feld wie bisher nur Treffer. Oder: Mehrere Geräte passen gleichermassen
 * (siehe `mehrdeutigeKandidaten`) - dann entscheidet nicht diese Funktion
 * für eines von ihnen.
 */
export function befehlAusText(text: string, entities: Entity[]): Suchbefehl | null {
  const basis = grundlage(text, entities);
  if (!basis) return null;
  const { kandidaten, verb, prozent } = basis;

  // Eine Prozentzahl meint die Helligkeit bzw. die Storenhöhe - und sie
  // sticht das Verb: «storen auf 40» ist eine Position, kein «hoch».
  if (prozent !== null) {
    const treffer = kandidaten.filter((entity) => prozentBefehl(entity, prozent) !== null);
    if (treffer.length === 1) return prozentBefehl(treffer[0], prozent);
    if (treffer.length > 1) return null;
  }
  if (!verb) return null;

  const treffer = kandidaten.filter((entity) => entity.commands.includes(verb.command));
  if (treffer.length !== 1) return null;
  const entity = treffer[0];
  return {
    entityId: entity.id,
    command: verb.command,
    satz: `${entity.name} ${verb.wort}`,
  };
}

/**
 * Mehrere Geräte passen zum getippten Namen und können denselben Befehl
 * (Punkt 669 der Werkbank): «Bürolicht oder Gästezimmer?» statt der
 * ersten stillen Übereinstimmung, die `befehlAusText` früher traf, sobald
 * ein Name zu mehr als einer Entität passte - z. B. zwei Lampen, deren
 * Namen beide «Licht» und den gesuchten Raum enthalten.
 *
 * `null`, wenn es gar keine oder nur eine Übereinstimmung gibt - dann
 * sagt schon `befehlAusText` (oder die gewöhnliche Suche), was gilt.
 */
export function mehrdeutigeKandidaten(text: string, entities: Entity[]): Suchbefehl[] | null {
  const basis = grundlage(text, entities);
  if (!basis) return null;
  const { kandidaten, verb, prozent } = basis;

  if (prozent !== null) {
    const treffer = kandidaten
      .map((entity) => prozentBefehl(entity, prozent))
      .filter((befehl): befehl is Suchbefehl => befehl !== null);
    if (treffer.length > 1) return treffer;
  }
  if (verb) {
    const treffer = kandidaten
      .filter((entity) => entity.commands.includes(verb.command))
      .map((entity) => ({
        entityId: entity.id,
        command: verb.command,
        satz: `${entity.name} ${verb.wort}`,
      }));
    if (treffer.length > 1) return treffer;
  }
  return null;
}
