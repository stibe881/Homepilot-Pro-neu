/**
 * Die zweite Berührung, bevor die Türe aufgeht.
 *
 * «Öffnen» wurde zu «Wirklich öffnen?», und erst der zweite Tipp zog die
 * Falle. Das war fest eingebaut, für alle und immer – gedacht gegen den
 * Ellbogen am Wandpanel und gegen die Hosentasche.
 *
 * Wer die Türe mehrmals am Tag öffnet, für den ist es der zweite Tipp zu
 * viel: zwei Hände voll Einkauf, und der erste Tipp ist längst verfallen
 * (nach vier Sekunden vergisst die Kachel ihn wieder). Darum eine
 * Einstellung – aber eine, die im Zweifel fragt: Fehlt sie, bleibt es
 * beim bisherigen Verhalten.
 *
 * Sie gilt fürs ganze Haus, nicht für ein Gerät: Eine Türe, die am Panel
 * nachfragt und auf dem Telefon nicht, ist keine Regel, sondern ein
 * Ratespiel. Und sie gilt nur fürs Öffnen. Aufschliessen bleibt, wie es
 * war – wer aufschliesst, steht davor.
 *
 * Was sie nicht ist: ein Zugangsschutz. Die Rechte prüft der Hub, und die
 * Face-ID-Hürde (lib/biometrie.ts) sowie die Gerätesperre («schaltet nur
 * nach Rückfrage») bleiben davon unberührt – wer die Türe zusätzlich
 * gesperrt hat, wird weiter gefragt.
 */

/** Befehle, nach denen die Türe wirklich aufgeht. */
export const OEFFNEN = new Set(['open_door', 'unlatch']);

/**
 * Darf dieser Befehl die Rückfrage überspringen? (rein, testbar)
 *
 * Absichtlich herum gefragt: Die Antwort ist «nein», solange nicht beides
 * zutrifft - es geht ums Öffnen, und es ist ausdrücklich so eingestellt.
 * Andersherum gefragt («braucht es eine Rückfrage?») würde jeder neue
 * Aufrufer, der einen anderen Befehl einsetzt, versehentlich eine
 * bestehende Rückfrage abschalten. Aufschliessen ist nicht öffnen, und
 * eine fehlende Einstellung ist kein Freibrief.
 */
export function mayOpenDirectly(command: string, doorConfirm?: boolean): boolean {
  return OEFFNEN.has(command) && doorConfirm === false;
}
