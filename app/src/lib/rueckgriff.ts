/**
 * Was «Rückgängig» gerade anbietet – und in welcher Reihenfolge.
 *
 * Drei Dinge können gleichzeitig zurücknehmbar sein: ein abgehakter
 * Posten im Laden, ein grosser Griff («Alles aus») und die letzte
 * einzelne Schaltung. Die Einblendung hat aber nur einen Knopf, und
 * welches der drei er meint, ist nicht Geschmackssache:
 *
 *  * Das Abhaken im Laden geht vor – es ist die jüngere Handlung, und es
 *    ist die, bei der man danebentippt.
 *  * Der grosse Griff geht der einzelnen Schaltung vor: «Alles aus»
 *    setzt zwanzig Befehle ab; der letzte davon ist nicht das, was
 *    jemand zurücknehmen will, der ganze Griff ist es.
 *  * Ging etwas schief, gibt es gar kein Angebot: Ein fehlgeschlagener
 *    Befehl hat nichts hinterlassen, was man zurücknehmen müsste, und
 *    die Fehlermeldung steht an derselben Stelle.
 *
 * Die Reihenfolge stand bisher als verschachtelte Bedingung in drei
 * Eigenschaften desselben Elements – dreimal dieselbe Regel, dreimal zu
 * ändern.
 */

export type Rueckquelle = 'einkauf' | 'griff' | 'befehl' | null;

export interface Rueckangebot {
  quelle: Rueckquelle;
  what: { name: string; label: string } | null;
}

/** Wie ein zurücknehmbarer Griff heisst (rein, testbar). */
export function griffSatz(anzahl: number): { name: string; label: string } {
  return {
    name: `${anzahl} Gerät${anzahl === 1 ? '' : 'e'}`,
    label: 'ausgeschaltet',
  };
}

/** Welches Zurück die Einblendung anbietet (rein, testbar). */
export function rueckangebot(lage: {
  fehler: boolean;
  einkauf: { name: string } | null;
  griff: { count: number } | null;
  befehl: { name: string; label: string } | null;
}): Rueckangebot {
  if (lage.fehler) return { quelle: null, what: null };
  if (lage.einkauf) {
    return { quelle: 'einkauf', what: { name: lage.einkauf.name, label: 'abgehakt' } };
  }
  if (lage.griff) return { quelle: 'griff', what: griffSatz(lage.griff.count) };
  if (lage.befehl) return { quelle: 'befehl', what: lage.befehl };
  return { quelle: null, what: null };
}
