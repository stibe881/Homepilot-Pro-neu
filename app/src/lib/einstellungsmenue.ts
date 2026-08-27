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
 * Was hinter «Administrator» liegt.
 *
 * Die Liste war eine einzige Reihe von vierzehn Punkten und mischte
 * zweierlei: Dinge, die man im Alltag braucht (Suche, Abläufe, Alarm,
 * Lautsprecher, Konto), und die Einrichtung des Hauses. Das Zweite
 * öffnet man selten und nie beiläufig – es hat einen eigenen Ort
 * verdient, statt die häufigen Wege zu verlängern.
 *
 * Die Auswahl folgt derselben Frage wie ``NOETIG`` oben, nur eine Stufe
 * gröber: Ändert oder erklärt der Punkt, *wie das Haus eingerichtet
 * ist*? Dann liegt er dahinter. Bedient er es, bleibt er vorne.
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
 * Die Zeile unter «Administrator» (rein, testbar).
 *
 * Sie richtet sich danach, was dahinter wirklich sichtbar ist: Ein
 * Mitbewohner sieht weniger als die Besitzerin, und eine Zeile, die
 * mehr verspricht als die Seite hält, schickt ihn ins Leere.
 */
export function adminZeile(sichtbar: number): string {
  if (sichtbar <= 0) return 'Nichts davon steht dir offen';
  return 'Benutzer, Geräte, System und der Rückblick';
}
