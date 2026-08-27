/**
 * Die Strähne eines Ämtli: wie oft in Folge es erledigt wurde.
 *
 * Punkte gibt es schon (Prämien) – aber Punkte sammeln sich, eine
 * Strähne kann *reissen*. Genau das motiviert: «6 Wochen am Stück»
 * will niemand auf null fallen lassen. Die Strähne gehört dem Ämtli,
 * nicht der Person – bei einer Rotation heisst sie «die Reihe hält»,
 * und das ist die Leistung aller.
 *
 * Gerechnet wird beim Abhaken, gespeichert am Eintrag selbst: kein
 * eigenes Protokoll, nichts, was aufgeräumt werden müsste.
 */

export interface StraehnenStand {
  streak?: number;
  /** ISO-Tag der Erledigung, die die Strähne zuletzt verlängert hat. */
  streak_last?: string | null;
}

/** Wie viele Tage zwischen zwei Erledigungen liegen dürfen.
 *
 * Eine Periode plus Kulanz: Wer den Montags-Abfall am Dienstag abhakt,
 * hat die Woche nicht verpasst. Erst wer eine ganze Runde auslässt,
 * fängt wieder bei eins an. */
export const KULANZ_TAGE: Record<string, number> = {
  daily: 2,
  weekly: 9,
  monthly: 35,
  none: 0,
};

function tage(vonIso: string, bisIso: string): number {
  const von = new Date(`${vonIso.slice(0, 10)}T12:00:00`).getTime();
  const bis = new Date(`${bisIso.slice(0, 10)}T12:00:00`).getTime();
  if (!Number.isFinite(von) || !Number.isFinite(bis)) return Number.POSITIVE_INFINITY;
  return Math.round((bis - von) / 86_400_000);
}

/** Die Strähne nach diesem Abhaken (rein, testbar). */
export function naechsteStraehne(
  chore: StraehnenStand & { repeat?: string | null },
  heuteIso: string
): { streak: number; streak_last: string } {
  const frist = KULANZ_TAGE[chore.repeat || 'weekly'] ?? 0;
  const letzte = chore.streak_last;
  const abstand = letzte ? tage(letzte, heuteIso) : Number.POSITIVE_INFINITY;
  // Zweimal am selben Tag abgehakt (vertippt, zurückgenommen, wieder
  // abgehakt) verlängert nicht.
  if (abstand === 0) {
    return { streak: Math.max(1, chore.streak ?? 1), streak_last: heuteIso };
  }
  const haelt = frist > 0 && abstand <= frist;
  return {
    streak: haelt ? (chore.streak ?? 0) + 1 : 1,
    streak_last: heuteIso,
  };
}

/** Der Satz zur Strähne – ab zwei, eine Einzelne ist keine (rein, testbar). */
export function straehnenSatz(
  chore: StraehnenStand & { repeat?: string | null }
): string | null {
  const n = chore.streak ?? 0;
  if (n < 2) return null;
  const einheit =
    chore.repeat === 'daily' ? 'Tage' : chore.repeat === 'monthly' ? 'Monate' : 'Wochen';
  return `${n} ${einheit} am Stück`;
}
