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
  | 'diagnose'
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
/** Der Nachbar in der Leiste (rein, testbar) - null am Rand.
 *
 *  Punkt 433: Auf dem Telefon wischt man zwischen den Bereichen, statt
 *  nach unten zur Leiste zu greifen. Die Reihenfolge ist die der Leiste;
 *  am Rand endet die Geste, statt umzulaufen - ein Wischen, das von
 *  «Einstellungen» wieder auf «Start» springt, verwirrt mehr als es hilft. */
export function nachbarBereich(
  sichtbar: Section[],
  aktiv: Section,
  richtung: 1 | -1
): Section | null {
  const index = sichtbar.indexOf(aktiv);
  if (index < 0) return null;
  return sichtbar[index + richtung] ?? null;
}

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
  diagnose: 'Prüfwerkzeuge',
  widgets: 'Widgets',
  account: 'Konto',
  connection: 'Verbindungen',
};
