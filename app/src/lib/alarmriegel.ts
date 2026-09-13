/**
 * Die unverschlossene Türe beim Scharfschalten (Punkt 614 der Werkbank).
 *
 * Der Hub kannte in der Bereitschaftsprüfung nur «offen» und «blind»;
 * beim Schloss zählte der Türsensor, nicht der Riegel. Jetzt kommt eine
 * dritte Antwort: `reason: 'unverschlossen'` mit den Türen. Hier steht,
 * wie die App sie liest und wann sie nach dem Abschliessen weitermachen
 * darf - ohne Netz und ohne Bildschirm, damit es sich messen lässt.
 */

export interface Riegel {
  entity_id: string;
  label: string;
}

/** Die unverschlossenen Türen aus der Antwort des Hubs (rein, testbar).
 *
 *  Nachsichtig gelesen: Ein älterer Hub schickt das Feld nicht, und was
 *  keinen Namen hat, kann man niemandem zeigen. */
export function unverschlossenAus(body: unknown): Riegel[] {
  const roh = (body as { unlocked?: unknown } | null)?.unlocked;
  if (!Array.isArray(roh)) return [];
  return roh
    .filter(
      (zeile): zeile is Riegel =>
        !!zeile &&
        typeof zeile === 'object' &&
        typeof (zeile as Riegel).entity_id === 'string' &&
        typeof (zeile as Riegel).label === 'string' &&
        (zeile as Riegel).label.length > 0
    )
    .map((zeile) => ({ entity_id: zeile.entity_id, label: zeile.label }));
}

/** Der Satz zu den Türen (rein, testbar).
 *
 *  `scharf` heisst: Die Anlage hat trotzdem geschaltet (Nachtmodus) -
 *  dann ist es ein Hinweis, keine Absage. Nachts geht man nochmals raus. */
export function riegelText(riegel: Riegel[], scharf: boolean): string | null {
  if (riegel.length === 0) return null;
  const namen = riegel.map((zeile) => zeile.label).join(', ');
  return scharf
    ? `Scharf – aber nicht abgeschlossen: ${namen}`
    : `Nicht abgeschlossen: ${namen}`;
}

/** Welche Türen nach dem Befehl noch nicht «locked» melden (rein, testbar).
 *
 *  Ein Nuki braucht rund fünf Sekunden für eine Umdrehung; solange sagt
 *  es «locking». Erst wenn keine Türe mehr übrig ist, darf die Anlage
 *  nochmals scharf gestellt werden - ein zweiter Versuch mitten in der
 *  Bewegung bekäme dieselbe Absage. */
export function nochNichtZu(
  riegel: Riegel[],
  zustand: (entityId: string) => string | undefined
): Riegel[] {
  return riegel.filter((zeile) => zustand(zeile.entity_id) !== 'locked');
}

/** Wie oft die App nach dem Abschliessen nachsieht und wie lange sie
 *  dazwischen wartet - zusammen rund eine halbe Minute, mehr als das
 *  Nachfassen des Hubs (nuki.py, SETTLE_DELAYS). */
export const NACHSEHEN = { versuche: 12, abstandMs: 2500 };
