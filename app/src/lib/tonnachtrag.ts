/**
 * Lautstärken, die auf das Ende einer Wiedergabe warten.
 *
 * Ein Ablauf, der morgens alle Boxen auf 20 % stellt, meint die stillen
 * Boxen – nicht die, auf der gerade Radio läuft. Der Hub merkt sich den
 * Wunsch dort und reicht ihn nach, sobald die Musik aus ist
 * (hub/core/ton.py).
 *
 * Weil man dieser Box zwischendurch nichts ansieht – sie steht einfach
 * noch auf dem alten Wert –, sagt es die Musikzentrale in einem Satz.
 * Ohne ihn wäre die naheliegende Erklärung «der Ablauf ist kaputt».
 */

export interface Nachtragzeile {
  entity_id: string;
  volume: number;
  source?: { label?: string } | null;
  at?: number;
}

/**
 * «Nest Badezimmer wartet auf 20 %» (rein, testbar).
 *
 * Mit Namen statt Kennung: «test.speaker_bath wartet» beantwortet die
 * Frage nicht, die man hat. Ist die Box dem Hub unbekannt (gerade
 * abgebaut), steht die Kennung – lieber unschön als gar nichts.
 */
export function nachtragSatz(
  zeilen: Nachtragzeile[] | undefined,
  namen: Record<string, string>,
): string | null {
  const gueltig = (zeilen ?? []).filter((zeile) => zeile && zeile.entity_id);
  if (gueltig.length === 0) return null;
  if (gueltig.length === 1) {
    const zeile = gueltig[0];
    return `${namen[zeile.entity_id] ?? zeile.entity_id} wartet auf ${zeile.volume} % – solange dort etwas läuft`;
  }
  // Ab zwei zählt die Zahl, nicht die Liste: Vier Boxennamen in einer
  // Zeile liest niemand, und die Frage lautet ohnehin nur «warum steht
  // da noch der alte Wert?».
  return `${gueltig.length} Boxen warten auf ihre Lautstärke – solange dort etwas läuft`;
}
