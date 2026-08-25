/**
 * Wie die Tage eines Weckers heissen.
 *
 * Sieben Tage aufzuzählen liest niemand, «1,2,3,4,5» erst recht nicht.
 * Die drei Muster, die im Alltag vorkommen, bekommen einen Namen; alles
 * andere wird aufgezählt.
 */
const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** «täglich», «Mo–Fr», «am Wochenende» oder die einzelnen Tage (rein, testbar). */
export function tageSatz(days: number[]): string {
  const sortiert = [...new Set(days)].sort((a, b) => a - b);
  if (sortiert.length === 7) return 'täglich';
  if (sortiert.join(',') === '0,1,2,3,4') return 'Mo–Fr';
  if (sortiert.join(',') === '5,6') return 'am Wochenende';
  return sortiert.map((tag) => TAGE[tag] ?? '?').join(', ');
}
