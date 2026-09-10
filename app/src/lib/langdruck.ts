/**
 * Wie lange «lange drücken» dauert – und was es bedeuten darf.
 *
 * Langdrücken ist in dieser App an einem Dutzend Stellen die zweite
 * Bedienung: die Kachel öffnet ihr Blatt, die Raumkarte ihr Menü, der
 * Favorit lässt sich verschieben. Die Dauer stand nirgends: React Native
 * nimmt ohne Angabe 500 ms, eine Stelle setzte 350, eine andere 2000.
 * Für sich genommen ist jede Zahl begründbar; zusammen ergeben sie ein
 * Haus, in dem dasselbe Halten mal etwas tut und mal nicht – und man
 * lernt nie, wie lange man halten muss.
 *
 * Deshalb drei Zahlen, und jede steht für eine Absicht:
 *
 * - {@link SCHNELL} für das, was man oft tut und was nichts kaputt macht:
 *   ein Blatt öffnen, ein Menü zeigen, etwas anfassen zum Verschieben.
 *   Kurz genug, dass es sich wie ein Teil des Tippens anfühlt.
 * - {@link NORMAL} – die Vorgabe des Systems. Für alles, was einen
 *   Zustand ändert, den man danach wieder herstellen kann.
 * - {@link ABSICHT} für das, was man genau einmal richtig machen will:
 *   Alarm auslösen, alles löschen. Zwei Sekunden sind lang genug, dass
 *   ein Daumen beim Scrollen sie nicht erreicht, und kurz genug, wenn
 *   man es meint.
 *
 * Die Regel darunter, und sie ist wichtiger als die Zahlen: **Was durch
 * Langdrücken erreichbar ist, muss auch anders erreichbar sein.** Ein
 * verstecktes Menü ist für den, der es nicht kennt, kein Menü. Deshalb
 * hat jede Stelle mit Langdruck auch einen sichtbaren Weg – ein
 * Chevron, ein Punkte-Symbol, einen Knopf im Blatt.
 */

/** Ein Blatt öffnen, ein Menü zeigen, etwas zum Verschieben anfassen. */
export const SCHNELL = 350;

/** Die Vorgabe des Systems – für alles Umkehrbare. */
export const NORMAL = 500;

/** Alarm auslösen, alles löschen: was man einmal richtig machen will. */
export const ABSICHT = 2000;

/** Die drei Absichten, benannt. */
export type Absicht = 'schnell' | 'normal' | 'absicht';

/**
 * Die Dauer zu einer Absicht (rein, testbar).
 *
 * Über einen Namen und nicht über eine Zahl: An der Stelle, an der man
 * es hinschreibt, weiss man, *was* man meint – «öffnet ein Blatt» –,
 * nicht, wie viele Millisekunden das im ganzen Haus wert ist.
 */
export function dauer(absicht: Absicht): number {
  if (absicht === 'schnell') return SCHNELL;
  if (absicht === 'absicht') return ABSICHT;
  return NORMAL;
}

/**
 * Der Zusatz für die Vorlesehilfe (rein, testbar).
 *
 * VoiceOver liest ein `onLongPress` nicht von selbst vor – es ist eine
 * Geste, die man kennen muss. Für jemanden, der die App vorlesen lässt,
 * ist ein Langdruck-Menü damit unauffindbar. Der Satz hier gehört in
 * `accessibilityHint` und sagt beides: dass es die Geste gibt und was
 * sie tut.
 */
export function hinweis(was: string, absicht: Absicht = 'normal'): string {
  if (absicht === 'absicht') return `${was}. Zwei Sekunden gedrückt halten.`;
  return `${was}. Gedrückt halten.`;
}
