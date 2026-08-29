/**
 * «Sag mir später Bescheid» – die Fristen dazu.
 *
 * Vier Angebote, und keines davon ist eine Minutenzahl zum Eintippen:
 * Wer daran denkt, dass die Waschmaschine läuft, denkt in «nachher» und
 * «heute Abend», nicht in 137 Minuten.
 *
 * «Heute Abend» und «Morgen früh» sind Uhrzeiten und keine Abstände -
 * darum wird hier gerechnet und nicht eine feste Zahl hinterlegt. Wer um
 * 19 Uhr «heute Abend» wählt, meint gleich; wer es um 9 Uhr wählt,
 * meint in zehn Stunden.
 */

export interface Frist {
  key: string;
  label: string;
}

/** Wann «heute Abend» ist. */
export const ABEND_STUNDE = 19;
/** Wann «morgen früh» ist. */
export const MORGEN_STUNDE = 7;

export const FRISTEN: Frist[] = [
  { key: '30', label: 'In 30 Minuten' },
  { key: '120', label: 'In 2 Stunden' },
  { key: 'abend', label: 'Heute Abend' },
  { key: 'morgen', label: 'Morgen früh' },
];

/**
 * Wie viele Minuten diese Wahl bedeutet (rein, testbar).
 *
 * Mindestens eine Minute: «Heute Abend», um 19:30 gewählt, ist sonst
 * eine Erinnerung in der Vergangenheit - und die käme sofort.
 */
export function fristMinuten(key: string, jetzt: Date): number {
  const zahl = Number(key);
  if (Number.isFinite(zahl) && zahl > 0) return Math.round(zahl);
  const ziel = new Date(jetzt);
  if (key === 'abend') {
    ziel.setHours(ABEND_STUNDE, 0, 0, 0);
    // Schon vorbei? Dann ist «heute Abend» morgen Abend - alles andere
    // wäre eine Erinnerung, die nie kommt.
    if (ziel <= jetzt) ziel.setDate(ziel.getDate() + 1);
  } else {
    ziel.setHours(MORGEN_STUNDE, 0, 0, 0);
    if (ziel <= jetzt) ziel.setDate(ziel.getDate() + 1);
  }
  return Math.max(1, Math.round((ziel.getTime() - jetzt.getTime()) / 60000));
}

/** Der Satz zur Bestätigung – er nennt die Zeit, nicht die Wahl. */
export function fristSatz(minuten: number): string {
  if (minuten < 60) return `Erinnerung in ${minuten} Minuten`;
  const stunden = Math.round(minuten / 60);
  return stunden === 1 ? 'Erinnerung in einer Stunde' : `Erinnerung in ${stunden} Stunden`;
}
