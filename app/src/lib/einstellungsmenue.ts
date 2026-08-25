/**
 * Wer welchen Bereich hinter den Einstellungen sieht.
 *
 * Die Regel stand als `show: istBesitzer` elfmal untereinander im
 * Bildschirm – und wurde damit zur Gewohnheit statt zur Entscheidung.
 * Aufgefallen ist es an der Geräteliste: «Mitbewohner sollen in den
 * Einstellungen auch die Geräte sehen.» Sie stand bei der Besitzerin,
 * obwohl sie nichts verändert, sondern nur Auskunft gibt.
 *
 * Die Trennlinie ist nicht die Rolle, sondern was der Bereich tut:
 *
 * - **Bedienen und nachschauen** – Suche, Widgets, das eigene Konto.
 *   Für alle, auch für Gäste.
 * - **Über das Haus Bescheid wissen** – die Geräteliste mit Batterie und
 *   Verlauf, die Abläufe zum Pausieren. Wer hier wohnt (`view_system`,
 *   `pause_automations`), darf das; ein Gast nicht.
 * - **Das Haus einrichten** – Benutzer, Alarm, Lautsprecher, Energie,
 *   System, Protokoll. Das bleibt bei der Besitzerin (`manage_users`).
 *
 * Verändert wird in der Geräteliste nichts: Anpassen, Ersetzen und die
 * Leuchtengruppen hängen weiter an `manage_users` (siehe
 * DashboardScreen). Ein Knopf, den der Hub mit «keine Berechtigung»
 * abweist, wäre schlimmer als kein Knopf.
 */

/** Schlüssel der Bereiche – dieselben wie im Menü. */
export type Bereich =
  | 'search'
  | 'users'
  | 'automations'
  | 'alarm'
  | 'devices'
  | 'speakers'
  | 'energy'
  | 'system'
  | 'activity'
  | 'widgets'
  | 'account';

/** Was diesen Bereich freischaltet. `null` heisst: für alle. */
const NOETIG: Record<Bereich, string | null> = {
  search: null,
  widgets: null,
  account: null,
  // Auskunft über das Haus.
  devices: 'view_system',
  automations: 'pause_automations',
  // Einrichtung.
  users: 'manage_users',
  alarm: 'manage_users',
  speakers: 'manage_users',
  energy: 'manage_users',
  system: 'manage_users',
  activity: 'manage_users',
};

/** Sieht jemand mit diesen Rechten diesen Bereich? (rein, testbar) */
export function siehtBereich(capabilities: string[], bereich: Bereich): boolean {
  const noetig = NOETIG[bereich];
  if (noetig === null) return true;
  // Die Besitzerin sieht alles – sie darf ohnehin jeden Knopf drücken,
  // und eine Liste, in der ihr etwas fehlt, wäre nur verwirrend.
  return capabilities.includes(noetig) || capabilities.includes('manage_users');
}
