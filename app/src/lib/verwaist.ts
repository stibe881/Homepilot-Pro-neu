/**
 * Verwaiste Abläufe (Punkt 262): «Zuletzt gefeuert: vor 4 Monaten».
 *
 * Ob ein Ablauf verwaist ist, entscheidet allein der Hub - die Liste
 * liefert `orphaned` fertig mit (hub/core/verwaist.py, 90 Tage). Die
 * Grenze hier zu wiederholen hiesse, sie zweimal zu pflegen, und
 * irgendwann hätten App und Hub zwei Meinungen. Der App bleibt nur die
 * Formatierung: aus Unix-Sekunden ein Satzteil, den man im Vorbeigehen
 * liest.
 *
 * `epochAgo` (lib/zeit.ts) taugt dafür nicht: Es zählt höchstens Tage,
 * und «vor 127 Tagen» muss man erst ausrechnen. Bei Verwaisten geht es
 * um Monate - also stehen hier Monate.
 */

/** Wie lange das letzte Feuern her ist - «vor 4 Monaten», «noch nie»
 *  (rein, testbar).
 *
 *  `null`/`undefined`/0 heisst: nie gefeuert, seit der Hub Buch führt.
 *  Unterhalb von zwei Monaten bleiben es Tage (genauer, und «vor einem
 *  Monat» wäre bei der 90-Tage-Grenze ohnehin nie zu sehen), ab einem
 *  Jahr werden es Jahre. */
export function zuletztGefeuert(
  at: number | null | undefined,
  jetzt: number = Date.now()
): string {
  if (!at || !Number.isFinite(at) || at <= 0) return 'noch nie';
  const tage = Math.max(0, Math.floor((jetzt - at * 1000) / 86_400_000));
  if (tage < 60) {
    if (tage === 0) return 'heute';
    return tage === 1 ? 'vor einem Tag' : `vor ${tage} Tagen`;
  }
  // Kalendermonate wären hier Scheingenauigkeit - 30 Tage je Monat
  // reichen für «wie lange ungefähr?», und nur das fragt die Zeile.
  const monate = Math.floor(tage / 30);
  if (monate < 12) return `vor ${monate} Monaten`;
  const jahre = Math.floor(monate / 12);
  return jahre === 1 ? 'vor einem Jahr' : `vor ${jahre} Jahren`;
}

/** Die ganze Zusatzzeile der Ablauf-Liste (rein, testbar). */
export function verwaistZeile(
  at: number | null | undefined,
  jetzt: number = Date.now()
): string {
  return `Zuletzt gefeuert: ${zuletztGefeuert(at, jetzt)}`;
}
