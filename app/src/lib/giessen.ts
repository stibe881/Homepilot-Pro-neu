/**
 * Trockenheit auf der Wetterkarte.
 *
 * Der Hub schickt abends eine Push, wenn es lange nicht geregnet hat
 * (hub/core/giessen.py). Wer sie wegwischt, hat die Auskunft verloren –
 * also steht sie auch dort, wo man ohnehin nachsieht, wenn man an den
 * Balkon denkt.
 *
 * Erst ab drei Tagen: Zwei trockene Tage sind Sommer, keine Nachricht.
 */

/** Ab hier lohnt sich der Satz – gleiche Schwelle wie die Push-Regel. */
export const AB_TAGEN = 3;

/**
 * «Seit 5 Tagen kein Regen» – oder nichts (rein, testbar).
 *
 * Kommt in den nächsten Tagen Regen, schweigt die Zeile: Die Frage
 * lautet «muss ich giessen?», und darauf ist die Antwort dann nein.
 */
export function trockenSatz(
  tage: unknown,
  kommt: unknown,
  reicht = 3,
): string | null {
  const zahl = Number(tage);
  if (!Number.isFinite(zahl) || zahl < AB_TAGEN) return null;
  const regen = Number(kommt);
  if (Number.isFinite(regen) && regen >= reicht) return null;
  return `Seit ${Math.round(zahl)} Tagen kein Regen`;
}
