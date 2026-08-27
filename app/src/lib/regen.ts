/**
 * Regen, der gleich kommt – als ein Satz.
 *
 * Die Wochenzeile beantwortet die Frage am Fenster nicht: «60 % heute»
 * hilft nicht beim Entscheid, ob die Wäsche jetzt hereingeholt gehört.
 * Der Hub rechnet aus den Viertelstundenwerten von Open-Meteo, in wie
 * vielen Minuten es anfängt (hub/core/regen.py); hier steht nur, wie das
 * in der App heisst.
 *
 * Dieselben Worte wie in der Mitteilung: Wer beides sieht, soll nicht
 * zweimal dasselbe in anderen Worten lesen.
 */

export interface Regenstand {
  /** Regnet es jetzt schon? */
  now?: boolean;
  /** Minuten bis zum Anfang – oder bis zum Ende, wenn es schon regnet. */
  minutes?: number | null;
  mm?: number | null;
}

/** Der Satz für die Wetterkarte – oder nichts (rein, testbar). */
export function regenSatz(stand: Regenstand | null | undefined): string | null {
  if (!stand) return null;
  const minuten = stand.minutes;
  if (stand.now) {
    if (minuten == null) return 'Es regnet.';
    return `Es regnet noch etwa ${minuten} Min.`;
  }
  if (minuten == null) return null;
  if (minuten <= 5) return 'Es fängt gleich an zu regnen.';
  return `Regen in etwa ${minuten} Min.`;
}
