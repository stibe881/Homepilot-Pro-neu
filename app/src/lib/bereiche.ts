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
  // Die Brandmeldeanlage (Punkt 445) - neben der Alarmanlage.
  | 'brand'
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
/** Der Farbwinkel eines Bereichs (rein, testbar) - Punkt 436.
 *
 *  Die Leiste färbt den gewählten Punkt in der Farbe des Bereichs,
 *  im Zimmer in der des Raums (lib/raumkarte.ts: raumTon) - so weiss
 *  man beim Hinsehen, wo man ist, bevor man den Namen liest. Feste
 *  Winkel statt gerechneter: Die sieben Bereiche sollen sich klar
 *  unterscheiden, und Licht darf warm sein, Kameras kühl. */
const BEREICH_TON: Partial<Record<Section, number>> = {
  start: 210,
  home: 150,
  light: 42,
  covers: 265,
  cameras: 190,
  family: 330,
  settings: 0,
};

export function bereichTon(section: Section): number | null {
  const ton = BEREICH_TON[section];
  return typeof ton === 'number' ? ton : null;
}

/** Die Tönung eines gewählten Leistenpunkts aus dem Winkel (rein, testbar).
 *  Durchscheinend, damit sie auf jedem Erscheinungsbild neben der
 *  Fläche der Leiste besteht - ein voller Ton schlüge das Symbol tot. */
export function bereichTint(ton: number | null): string | null {
  return ton === null ? null : `hsla(${ton}, 55%, 50%, 0.28)`;
}

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
  brand: 'Brandmeldeanlage',
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
