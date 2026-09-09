/**
 * Wie lange eine Einblendung stehen bleibt (alle rein, testbar).
 *
 * Fünf Sekunden waren für «Licht antwortet nicht» richtig. Für die
 * Meldungen, die wirklich weiterhelfen, nicht: Der Hub erklärt einen
 * Funk-Timeout der CCU in vier Zeilen - was zu prüfen ist, steht am
 * Ende, und genau das war nach drei Zeilen abgeschnitten und nach fünf
 * Sekunden weg. Aus dem Haus kam davon ein Bild: «… Prüfen: St…»
 *
 * Also: Die Zeit wächst mit dem Text, und lange Meldungen lassen sich
 * aufklappen. Gedeckelt bleibt sie trotzdem - eine Einblendung, die eine
 * halbe Minute über den Kacheln hängt, ist ein Fenster, das man
 * wegräumen muss.
 */

/** Ab so vielen Zeichen passt es nicht mehr in drei Zeilen. */
export const KURZ = 110;

/** Länger als das steht keine Einblendung (Millisekunden). */
export const HOECHSTENS = 20_000;

/** Wie lange diese Meldung stehen bleibt, in Millisekunden. */
export function anzeigedauer(text: string): number {
  const zeichen = String(text ?? '').length;
  // Fünf Sekunden Grundzeit, dazu 40 ms je Zeichen: Das entspricht rund
  // 25 Zeichen pro Sekunde und damit langsamem, ruhigem Lesen - schnell
  // genug tippt niemand weg, was er noch nicht gelesen hat.
  return Math.min(HOECHSTENS, 5000 + zeichen * 40);
}

/** Braucht diese Meldung mehr als die drei Zeilen? (rein, testbar) */
export function istLang(text: string | null | undefined): boolean {
  return String(text ?? '').length > KURZ;
}
