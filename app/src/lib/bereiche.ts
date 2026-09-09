/**
 * Die Bereiche der App und wie sie heissen.
 *
 * Standen in components/Rail.tsx, wo sie die Leiste füllen - aber die
 * Namen werden längst anderswo gebraucht: im Auffangnetz («Kameras
 * lässt sich gerade nicht anzeigen»), beim Riegel, bei den Push-Zielen
 * und in der Seitenhilfe. Aus einem Bildschirmbaustein Wörter zu
 * importieren, zieht ausserdem die ganze Symbolschrift mit hinein; ein
 * Test über die reine Liste kam damit nicht mehr zum Laufen.
 *
 * Die Leiste reicht beides weiterhin durch, damit die bestehenden
 * Importe bleiben können, wo sie sind.
 */

export type Section =
  | 'start'
  | 'home'
  | 'light'
  | 'covers'
  | 'cameras'
  | 'family'
  | 'settings'
  // Über „Einstellungen“ erreichbar, nicht in der Leiste:
  | 'devices'
  | 'automations'
  | 'system'
  | 'energy'
  | 'alarm'
  | 'besuch'
  | 'speakers'
  | 'users'
  | 'personen'
  | 'activity'
  | 'widgets'
  | 'account'
  // «Konto & Verbindung» war beides zugleich: Wer sein Erscheinungsbild
  // ändern wollte, scrollte an Adresse und Token vorbei. Zwei Fragen,
  // zwei Punkte.
  | 'connection';

/**
 * Wie ein Bereich heisst, wenn man ihn benennen muss – in Meldungen und
 * im Auffangnetz («Kameras lässt sich gerade nicht anzeigen»). Die Leiste
 * zeigt nur sieben davon; die übrigen erreicht man über Einstellungen und
 * brauchen trotzdem einen Namen.
 */
export const SECTION_LABEL: Record<Section, string> = {
  start: 'Start',
  home: 'Räume',
  light: 'Licht',
  covers: 'Storen',
  cameras: 'Kameras',
  family: 'Familie',
  settings: 'Einstellungen',
  devices: 'Geräte',
  automations: 'Abläufe',
  system: 'System',
  energy: 'Energie',
  alarm: 'Alarmanlage',
  besuch: 'Besuch',
  speakers: 'Boxen',
  users: 'Benutzer',
  personen: 'Familie und Freunde',
  activity: 'Zuletzt passiert',
  widgets: 'Widgets',
  account: 'Konto',
  connection: 'Verbindungen',
};
