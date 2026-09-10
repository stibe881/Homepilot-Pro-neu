/**
 * Wie oft die App beim Zeichnen gestolpert ist - und wo.
 *
 * `<Auffangnetz>` fängt einen Fehler ab und zeigt eine Ersatzfläche;
 * genau dafür liegt es um jeden Bereich einzeln. Nur erfuhr davon
 * niemand: Auf dem Telefon tippt man auf «Nochmals», es geht weiter,
 * und beim nächsten Mal denkt man «das war schon mal». Auf dem
 * Wandpanel im Flur sieht es überhaupt niemand.
 *
 * Also ein Buch. Nicht zum Hub geschickt - ein Zeichenfehler ist nichts,
 * was der Hub beheben könnte, und ein Bericht bei jedem Bildaufbau wäre
 * schlimmer als der Fehler selbst. Es liegt auf dem Gerät, hält die
 * letzten Einträge und steht unter *System*: «Kameras: dreimal, zuletzt
 * heute 18:12.» Das ist die Auskunft, mit der man anfangen kann.
 *
 * Alles hier ist rein und testbar; das Schreiben besorgt
 * `lib/persoenlich.ts` an der Aufrufstelle.
 */

/** Ein abgefangener Fehler, wie er im Buch steht. */
export interface Absturz {
  /** Der Bereich, in dem das Netz hing («Die Kameras»). */
  bereich: string;
  /** Die Meldung des Fehlers - gekürzt, sie landet in einer Zeile. */
  meldung: string;
  /** Wann, in Millisekunden seit 1970. */
  at: number;
}

/** So viele Einträge bleiben stehen. Mehr liest ohnehin niemand, und
 *  der Speicher der App ist kein Protokollserver. */
export const HOECHSTENS = 20;

/** So lang darf die Meldung sein. Ein Aufrufpfad mit vierzig Zeilen
 *  sagt in der Übersicht nicht mehr als der erste Satz. */
export const MELDUNG_MAX = 200;

/**
 * Einen Fehler ins Buch nehmen (rein, testbar).
 *
 * Neueste zuerst, gedeckelt. Zwei gleiche Fehler kurz hintereinander
 * bleiben zwei Einträge: Beim Zeichnen wiederholt sich derselbe Fehler,
 * und wie *oft* er kommt, ist die Auskunft - `nachBereich` zählt sie.
 */
export function eintragen(buch: Absturz[], neu: Absturz): Absturz[] {
  const sauber: Absturz = {
    bereich: String(neu.bereich || 'Die Ansicht').trim(),
    meldung: String(neu.meldung || 'Unbekannter Fehler').trim().slice(0, MELDUNG_MAX),
    at: Number.isFinite(neu.at) ? neu.at : Date.now(),
  };
  return [sauber, ...(buch ?? [])].slice(0, HOECHSTENS);
}

/**
 * Was unter *System* steht (rein, testbar): je Bereich, wie oft und
 * wann zuletzt - häufigster zuerst.
 *
 * Nicht die rohe Liste: Zwanzig Zeilen «Die Kameras» sagen weniger als
 * eine Zeile «Die Kameras: 20-mal».
 */
export function nachBereich(
  buch: Absturz[]
): { bereich: string; anzahl: number; zuletzt: number }[] {
  const topf = new Map<string, { anzahl: number; zuletzt: number }>();
  for (const eintrag of buch ?? []) {
    const name = String(eintrag?.bereich || 'Die Ansicht');
    const bisher = topf.get(name);
    topf.set(name, {
      anzahl: (bisher?.anzahl ?? 0) + 1,
      zuletzt: Math.max(bisher?.zuletzt ?? 0, Number(eintrag?.at) || 0),
    });
  }
  return [...topf.entries()]
    .map(([bereich, wert]) => ({ bereich, ...wert }))
    .sort((a, b) => b.anzahl - a.anzahl || b.zuletzt - a.zuletzt);
}

/**
 * Der eine Satz für die Übersicht (rein, testbar).
 *
 * Leer, wenn nichts passiert ist - «0 Abstürze» ist keine Auskunft,
 * sondern eine Zeile, die man ab dem zweiten Mal überliest.
 */
export function absturzSatz(buch: Absturz[]): string {
  const gruppen = nachBereich(buch);
  if (gruppen.length === 0) return '';
  const gesamt = (buch ?? []).length;
  const schlimmster = gruppen[0];
  if (gruppen.length === 1) {
    return schlimmster.anzahl === 1
      ? `Einmal gestolpert: ${schlimmster.bereich}`
      : `${schlimmster.anzahl}-mal gestolpert: ${schlimmster.bereich}`;
  }
  return `${gesamt}-mal gestolpert, am häufigsten: ${schlimmster.bereich}`;
}
