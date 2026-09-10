/**
 * Wann ein gezeigter Wert nicht mehr für «jetzt» steht.
 *
 * Ohne Verbindung zeigt die App den letzten bekannten Stand, und oben
 * steht ein Banner: «Keine Verbindung - gezeigt wird der letzte bekannte
 * Stand von 17:42». Die Kacheln darunter sahen aber aus wie immer: «An»,
 * «21,5 °C», «Fenster zu». Wer nur die Kachel ansieht - und das tut man,
 * denn dafür ist sie da -, liest eine Behauptung über jetzt.
 *
 * Ein Banner ist die falsche Stelle für diese Auskunft. Sie gehört an
 * den Wert selbst: gedämpft, mit der Uhrzeit dahinter. «21,5 °C» und
 * «21,5 °C (17:42)» sind zwei verschiedene Aussagen, und die zweite ist
 * die ehrliche.
 *
 * Alles rein und testbar - die Kacheln fragen, sie rechnen nicht.
 */

/** Ab dieser Stille gilt ein Wert als alt (Sekunden).
 *
 *  Zwei Minuten: Der Hub meldet Änderungen über den WebSocket, und
 *  selbst ein stiller Sensor sendet häufiger. Kürzer wäre nervös -
 *  jede kurze Funklücke färbte dann die halbe Wohnung. */
export const ALT_AB = 120;

/** Ab hier ist es nicht mehr «alt», sondern «weiss man nicht».
 *  Eine Stunde: Was so lange stillsteht, ist keine Verzögerung mehr. */
export const UNBEKANNT_AB = 3600;

export type Frische = 'frisch' | 'alt' | 'unbekannt';

/**
 * Wie frisch ist dieser Wert? (rein, testbar)
 *
 * `seit` ist der Zeitpunkt der letzten Meldung (Sekunden seit 1970, wie
 * `last_seen` am Gerät). Fehlt er, ist die Antwort «unbekannt» und nicht
 * «frisch»: Ein Gerät, von dem der Hub nicht weiss, wann es zuletzt
 * gesprochen hat, ist genau der Fall, den man sehen will.
 */
export function frische(
  seit: number | null | undefined,
  jetzt: number,
  verbunden = true
): Frische {
  // Die Verbindung zuerst, und das ist der ganze Punkt: Ein
  // Fenstersensor meldet sich nur, wenn sich etwas ändert - bei einem
  // selten benutzten Fenster können das Tage sein (docs/zigbee.md).
  // Solange der Hub antwortet, ist «seit drei Stunden dasselbe» eine
  // Auskunft und kein Problem. Erst ohne Verbindung wird aus
  // «unverändert» ein «ungeprüft».
  if (verbunden) return 'frisch';
  if (!seit || !Number.isFinite(seit)) return 'unbekannt';
  const alter = jetzt / 1000 - seit;
  if (alter >= UNBEKANNT_AB) return 'unbekannt';
  return alter >= ALT_AB ? 'alt' : 'frisch';
}

/**
 * Wie stark der Wert gedämpft wird (rein, testbar).
 *
 * Nicht ausblenden und nicht durchstreichen: Der alte Wert ist die
 * beste Auskunft, die es gerade gibt - er soll lesbar bleiben, nur
 * nicht wie eine frische Messung aussehen.
 */
export function deckkraft(art: Frische): number {
  if (art === 'frisch') return 1;
  return art === 'alt' ? 0.55 : 0.38;
}

/**
 * Was hinter dem Wert steht (rein, testbar) - oder nichts.
 *
 * Die Uhrzeit und nicht «vor 20 Minuten»: Wer weiss, dass er um 17:50
 * das Fenster geschlossen hat, erkennt an «17:42» sofort, dass die
 * Kachel das noch nicht mitbekommen hat. Eine gerundete Dauer liesse
 * ihn rätseln (dieselbe Überlegung wie in watchrules.offen_satz).
 */
export function altZusatz(
  art: Frische,
  seit: number | null | undefined,
  formatiere: (zeit: Date) => string
): string {
  if (art === 'frisch') return '';
  if (!seit || !Number.isFinite(seit)) return 'Stand unbekannt';
  return formatiere(new Date(seit * 1000));
}
