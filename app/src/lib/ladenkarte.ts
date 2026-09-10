/**
 * «Wo ist der Laden?» – der Weg dorthin, ohne die App zu verlassen.
 *
 * Ein Gutschein trägt seinen Laden als Text: «Ochsner Sport»,
 * «Migros». Das genügt, um ihn wiederzufinden, und nicht, um
 * hinzufahren. Wer die Adresse sucht, tippt den Namen in eine
 * Kartenapp ab - und tippt ihn falsch ab, wenn er wie «Chrüterhüsli»
 * heisst.
 *
 * Zwei Wege, und der bessere zuerst:
 *
 * - **Der Laden ist als Ort angelegt** (beim Einkaufszettel, mit
 *   Koordinaten). Dann führt die Karte genau dorthin - und derselbe
 *   Ort trägt die Erinnerung «du stehst gerade davor»
 *   (hub/core/gutscheinort.py).
 * - **Sonst der Name**, an die Kartenapp weitergereicht. Die findet
 *   «Ochsner Sport Sursee» besser als jeder von uns.
 *
 * Der Abgleich läuft über den Namen und mit derselben Nachsicht wie im
 * Hub: Gross- und Kleinschreibung, Rechtsformen und Filialzusätze
 * zählen nicht. Zwei Auslegungen desselben Vergleichs liefen früher
 * oder später auseinander - deshalb steht die Regel in beiden Dateien
 * mit demselben Wortlaut, und ein Test hält beide Seiten an derselben
 * Liste fest.
 */

/** Was am Ladennamen nicht zum Laden gehört – wie im Hub. */
const BEIWERK = /\b(ag|gmbh|sa|filiale|shop|store|online)\b|[.,()]/gi;

/** Ein Ladenname, auf das Vergleichbare gebracht (rein, testbar). */
export function schluessel(name: string | null | undefined): string {
  return String(name ?? '')
    .replace(BEIWERK, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/**
 * Gehören Gutschein und Ort zusammen? (rein, testbar)
 *
 * Nachsichtig in beide Richtungen: «Ochsner Sport Sursee» als Ort
 * trägt den Gutschein «Ochsner Sport», und umgekehrt. Leere Namen
 * passen zu nichts – sonst hinge an einem Gutschein ohne Laden jeder
 * Ort im Haus.
 */
export function passt(
  gutscheinLaden: string | null | undefined,
  ortName: string | null | undefined
): boolean {
  const a = schluessel(gutscheinLaden);
  const b = schluessel(ortName);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/** Ein Ort, wie der Einkaufszettel ihn führt. */
export interface Ort {
  name: string;
  latitude?: number | null;
  longitude?: number | null;
}

/** Der Ort zu einem Laden – oder `null` (rein, testbar). */
export function ortFuer(laden: string | null | undefined, orte: Ort[]): Ort | null {
  return orte.find((ort) => passt(laden, ort.name)) ?? null;
}

/**
 * Die Adresse für die Kartenapp (rein, testbar).
 *
 * Mit Koordinaten die Koordinaten: Sie führen an die Tür und nicht an
 * die Hauptfiliale in Zürich, die zufällig denselben Namen trägt. Ohne
 * sie der Name; `null` nur, wenn beides fehlt – dann steht kein Knopf
 * da, statt einer, der eine leere Karte öffnet.
 */
export function kartenZiel(
  laden: string | null | undefined,
  orte: Ort[] = []
): string | null {
  const ort = ortFuer(laden, orte);
  if (ort && typeof ort.latitude === 'number' && typeof ort.longitude === 'number') {
    return `${ort.latitude},${ort.longitude}`;
  }
  const name = String(laden ?? '').trim();
  return name || null;
}
