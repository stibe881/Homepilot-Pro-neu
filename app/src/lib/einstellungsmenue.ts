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

/**
 * Was zur Einrichtung des Hauses gehört und nicht zu seiner Bedienung.
 *
 * Die Frage ist dieselbe wie bei ``NOETIG`` oben, nur eine Stufe
 * gröber: Ändert oder erklärt der Punkt, *wie das Haus eingerichtet
 * ist*? Dann gehört er hierher. Bedient er es, nicht.
 *
 * Gebraucht wird die Trennung noch auf dem breiten Bildschirm: Dort
 * steht sie als Überschrift «Administrator» in der Menüspalte. Auf dem
 * Telefon war sie einmal eine eigene Tür - das kostete zwei Tipps und
 * sparte einen Bildschirm. Dort gruppiert jetzt
 * lib/einstellungsgruppen.ts feiner, und alles bleibt einen Tipp weit.
 */
export const ADMIN_PUNKTE: readonly string[] = [
  'users',
  'personen',
  'devices',
  'sorgen',
  'system',
  'activity',
] as const;

export type Menuegruppe = 'haus' | 'admin';

/** Wohin gehört dieser Punkt? (rein, testbar) */
export function gruppeVon(key: string): Menuegruppe {
  return ADMIN_PUNKTE.includes(key) ? 'admin' : 'haus';
}

/**
 * Womit die Einstellungen aufgehen, wenn daneben Platz für das Menü ist
 * (rein, testbar).
 *
 * Auf dem Telefon ist «Einstellungen» eine Liste von Kacheln: Erst der
 * Tipp darauf führt zu einer Seite, und die Liste ist der Weg zurück.
 * Auf einem breiten Bildschirm steht das Menü ohnehin links daneben -
 * dort war die Kachelliste ein Zwischenschritt für nichts. Man tippte auf
 * «Einstellungen», bekam eine Liste, tippte noch einmal, und erst dann
 * sah man die Ansicht, die man gemeint hatte. Zweimal derselbe Weg,
 * einmal davon vergeblich.
 *
 * Darum geht dort gleich eine Seite auf. Welche, richtet sich nach dem,
 * was zuletzt offen war: Wer zwischen System und Abläufen hin- und
 * herspringt, soll nicht jedes Mal von vorne anfangen. Beim ersten Mal
 * die erste Seite - und wenn es die von letztem Mal nicht mehr gibt
 * (andere Rolle, weniger Rechte), ebenfalls.
 *
 * `null` heisst: Es gibt keine solche Seite. Dann bleibt es bei der
 * Kachelliste - ein Gast sieht kaum etwas, und ein leerer Bereich wäre
 * schlimmer als eine kurze Liste.
 */
export function einstiegsSeite<T extends string>(
  seiten: readonly T[],
  zuletzt: T | null | undefined,
  /** Telefon: keine Menüspalte daneben, sondern eine eigene Übersicht. */
  schmal = false
): T | null {
  if (zuletzt && seiten.includes(zuletzt)) return zuletzt;
  // Beim allerersten Mal auf dem Telefon die Übersicht - sie ist dort
  // die Karte, und «Benutzerverwaltung» als Einstieg wäre geraten. Ab
  // dem zweiten Mal führt die Erinnerung ohnehin dorthin, wo man war.
  if (schmal) return null;
  return seiten[0] ?? null;
}
