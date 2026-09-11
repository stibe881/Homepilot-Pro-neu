/**
 * Die Adresse eines Klingeltons zum Anhören auf dem Gerät in der Hand.
 *
 * Die Testtaste daneben spielt auf den *Boxen* im Haus. Das beantwortet
 * «wie laut ist das im Flur», aber nicht «welchen nehme ich»: Wer die
 * Klänge durchprobiert, sitzt mit dem Telefon auf dem Sofa und hört von
 * der Küchenbox nichts. Darum holt die App den Ton als Datei und spielt
 * ihn selbst.
 *
 * Das Token steht in der Adresse und nicht in einer Kopfzeile, weil
 * Audio- und Videoplayer keine eigenen mitschicken - derselbe Weg wie
 * bei den Aufnahmen (lib/aufnahmeurl.ts).
 */

/** Die Adresse zum Klang-Schlüssel (rein, testbar). */
export function klingeltonUrl(basis: string, token: string, key: string): string {
  return (
    `${basis.replace(/\/+$/, '')}/api/push/doorbell-sound/` +
    `${encodeURIComponent(key)}.wav?token=${encodeURIComponent(token)}`
  );
}
