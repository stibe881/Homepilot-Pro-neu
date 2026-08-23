/**
 * Push-Nachrichten in ihre Unterkategorien einteilen.
 *
 * Zwanzig gleich aussehende Zeilen beantworten die eigentliche Frage
 * nicht: «Was weckt mich nachts, was ist bloss Betrieb?»
 *
 * Die Einteilung selbst kommt vom Hub (core/push.py) und stand früher in
 * der App: Dieselben Gruppen brauchen zwei Listen – im Profil («was will
 * ich bekommen?») und unter Abläufe → Push («was schickt der Hub
 * überhaupt?»). Zwei Listen liefen auseinander, und die Hälfte der
 * Kategorien landete im Profil unter «Weiteres», obwohl sie längst einen
 * Platz hatte.
 *
 * Hier steht nur noch das Sortieren – rein und testbar.
 */

/** So viel, wie zum Einsortieren nötig ist. */
export interface Gruppierbar {
  key: string;
  /** Unterkategorie vom Hub; fehlt sie, gilt «Weiteres». */
  group?: string;
}

/** Sammelname für alles, was der Hub (noch) nicht einordnet. */
export const OHNE_GRUPPE = 'Weiteres';

/**
 * Nach Unterkategorie sortieren (rein, testbar).
 *
 * `order` gibt die Reihenfolge – sie kommt vom Hub, damit «Sicherheit»
 * oben steht und «Betrieb» unten. Was dort nicht vorkommt, hängt sich
 * hinten an: Eine neue Kategorie soll nie unsichtbar sein, höchstens
 * unsortiert. Leere Gruppen fallen weg.
 */
export function nachGruppen<T extends Gruppierbar>(
  items: T[],
  order: string[] = []
): { title: string; items: T[] }[] {
  const nameOf = (item: T) => item.group || OHNE_GRUPPE;
  const namen = [...order, ...items.map(nameOf)].filter(
    (name, index, alle) => alle.indexOf(name) === index
  );
  return namen
    .map((title) => ({ title, items: items.filter((item) => nameOf(item) === title) }))
    .filter((gruppe) => gruppe.items.length > 0);
}
