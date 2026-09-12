/**
 * Ein Zurück im Editor, das eine Sitzung lang hält (Punkt 467 der Werkbank).
 *
 * Zurückholen gab es schon – aber nur für *gespeicherte* Fassungen. Wer
 * drei Schritte umstellte, die Bedingung änderte und es dann doch anders
 * wollte, musste abbrechen und von vorn beginnen. Bei einem Ablauf mit
 * zwölf Schritten ist das der Grund, warum man ihn lieber nicht anfasst.
 *
 * Bewusst rein und ohne React: Ein Stapel ist entscheidbar, und nur so
 * lässt sich prüfen, dass er weder überläuft noch dasselbe zweimal
 * merkt.
 */

/**
 * So viele Schritte lassen sich zurücknehmen.
 *
 * Dreissig, nicht unbegrenzt: Ein Entwurf ist ein ganzes Objekt, und
 * hundert Kopien eines Ablaufs mit zwölf Schritten sind Speicher, den
 * niemand je anschaut. Wer mehr als dreissig Änderungen zurücknehmen
 * will, will in Wahrheit die gespeicherte Fassung – und die gibt es
 * daneben.
 */
export const VERLAUF_MAX = 30;

/**
 * Einen Stand merken, bevor er überschrieben wird (rein, testbar).
 *
 * Der *vorherige* Stand kommt auf den Stapel, nicht der neue: Zurück
 * heisst «wie es war», und dafür muss das Vorher gespeichert sein.
 */
export function merken<T>(stapel: T[], vorher: T, max = VERLAUF_MAX): T[] {
  return [...stapel, vorher].slice(-max);
}

/**
 * Einen Schritt zurück (rein, testbar).
 *
 * Zurück kommt der oberste Stand und der Stapel ohne ihn. Ist er leer,
 * bleibt alles, wie es ist – ein Zurück, das im Kreis läuft, ist
 * schlimmer als ein Knopf, der nichts tut.
 */
export function zurueck<T>(stapel: T[]): { stand: T | null; stapel: T[] } {
  if (stapel.length === 0) return { stand: null, stapel };
  return { stand: stapel[stapel.length - 1], stapel: stapel.slice(0, -1) };
}

/**
 * Hat sich überhaupt etwas geändert? (rein, testbar)
 *
 * Jeder Tastendruck im Namensfeld löst ein `onChange` aus; ohne diese
 * Frage läge nach «Flurlicht» ein neunstufiger Stapel, und neunmal
 * Zurück brächte einen zurück zu «F». Verglichen wird der ganze
 * Entwurf, weil genau das die Einheit ist, die zurückgeholt wird.
 */
export function andersAls<T>(a: T, b: T): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}
