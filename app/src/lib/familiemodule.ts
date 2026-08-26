/**
 * Die Familien-Module in Gruppen.
 *
 * Siebzehn gleich aussehende Kacheln untereinander sind keine Übersicht,
 * sondern eine Liste, die man jedes Mal von vorne liest. Und sie stehen
 * in keiner Beziehung: «Notfallblatt» neben «Belohnungen» neben
 * «Einkaufsliste».
 *
 * Die Gruppen sind danach geschnitten, *wann* man etwas braucht - nicht
 * danach, was inhaltlich verwandt ist. «Kontakte» stehen deshalb bei
 * Notfall und Betreuung: Man sucht sie, wenn etwas ist, nicht wenn man
 * Nummern sortieren will.
 */
import { ModuleKey } from '../screens/family/bausteine';

export interface Modulgruppe {
  key: string;
  label: string;
  module: ModuleKey[];
}

export const MODULGRUPPEN: Modulgruppe[] = [
  {
    key: 'alltag',
    label: 'Alltag',
    // Was man in der Woche mehrmals anfasst.
    module: ['woche', 'kalender', 'tasks', 'chores', 'shopping', 'meals', 'routines'],
  },
  {
    key: 'notfall',
    label: 'Wenn etwas ist',
    // Die Seiten, die man selten öffnet und dann sofort braucht.
    module: ['emergency', 'medications', 'contacts', 'babysitter'],
  },
  {
    key: 'miteinander',
    label: 'Miteinander',
    // «Wer dazugehört» steht bei den Belohnungen: Man merkt dort, dass
    // ein Name fehlt - beim Punktestand, der das Kind nicht kennt.
    module: ['pins', 'rewards', 'members', 'countdowns'],
  },
  {
    key: 'nachschlagen',
    label: 'Nachschlagen',
    module: ['recipes', 'packlists', 'documents'],
  },
];

/** Zu welcher Gruppe dieses Modul gehört (rein, testbar).
 *
 *  Unbekanntes landet in der letzten Gruppe statt nirgends: Ein neues
 *  Modul soll sichtbar sein, auch wenn jemand vergisst, es hier
 *  einzutragen. */
export function gruppeVon(key: ModuleKey): string {
  const treffer = MODULGRUPPEN.find((gruppe) => gruppe.module.includes(key));
  return treffer ? treffer.key : MODULGRUPPEN[MODULGRUPPEN.length - 1].key;
}

/**
 * Die sichtbaren Module in ihre Gruppen einsortiert (rein, testbar).
 *
 * Die übergebene Reihenfolge bleibt innerhalb der Gruppe erhalten - wer
 * seine Kacheln gezogen hat, findet sie in derselben Abfolge wieder, nur
 * eben unter einer Überschrift.
 *
 * Leere Gruppen fallen weg: Eine Überschrift ohne Kacheln darunter ist
 * eine Frage, keine Auskunft.
 */
export function gruppiereModule<T extends { key: ModuleKey }>(
  module: T[]
): { key: string; label: string; module: T[] }[] {
  return MODULGRUPPEN.map((gruppe) => ({
    key: gruppe.key,
    label: gruppe.label,
    module: module.filter((eintrag) => gruppeVon(eintrag.key) === gruppe.key),
  })).filter((gruppe) => gruppe.module.length > 0);
}
