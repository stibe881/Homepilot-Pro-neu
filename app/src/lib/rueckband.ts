/**
 * Das Rückgängig-Band: was gerade zurückzunehmen wäre, und wie lange.
 *
 * Ein Löschen im Familienteil landet im Papierkorb – dreissig Tage lang
 * wiederherstellbar, aber vier Tipper weit weg. Wer danebentippt, merkt
 * es in derselben Sekunde und will es in derselben Sekunde zurück; dass
 * es «irgendwo noch da» ist, hilft ihm nicht.
 *
 * Reines Rechnen: hinein, was passiert ist und wann, heraus, ob und was
 * das Band zeigt.
 */

/** Wie lange das Angebot steht. */
export const FRIST_MS = 8000;

export interface Rueckeintrag {
  /** Was zurückgenommen würde: «Milch», «Zähne putzen». */
  name: string;
  /** Was damit geschah: «gelöscht», «abgehakt». */
  label: string;
  /** Wann es geschah. */
  at: number;
  /** Woher es kam – damit der Aufrufer weiss, was er rückgängig macht. */
  collection: string;
  id: string;
}

/** Steht das Angebot noch? (rein, testbar) */
export function nochGueltig(
  eintrag: Rueckeintrag | null,
  jetzt: number = Date.now(),
): boolean {
  if (!eintrag) return false;
  // Acht Sekunden: lange genug, um den Fehler zu bemerken, kurz genug,
  // dass das Band nicht im Weg steht, während man weiterarbeitet. Ein
  // Angebot, das nach zwei Minuten noch dasteht, meint eine Handlung,
  // an die sich niemand mehr erinnert.
  return jetzt - eintrag.at < FRIST_MS;
}

/** Der Satz im Band (rein, testbar). */
export function bandSatz(eintrag: Rueckeintrag | null): string {
  if (!eintrag) return '';
  return `«${eintrag.name}» ${eintrag.label}`;
}

/** Wie ein Eintrag heisst, den man löscht (rein, testbar).
 *
 *  Ein Posten ohne Text ist kein leerer Name, sondern «Eintrag» – sonst
 *  stünde im Band «« » gelöscht». */
export function eintragName(zeile: { text?: unknown; name?: unknown } | null): string {
  const text = String(zeile?.text ?? zeile?.name ?? '').trim();
  return text || 'Eintrag';
}
