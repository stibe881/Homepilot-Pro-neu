/**
 * Ein Warte-Schritt innerhalb einer Szene.
 *
 * Gewünscht im Haus: eine Wartezeit zwischen zwei Gruppen von Aktionen,
 * statt einer Szene, die alles auf einen Schlag schaltet - «Licht aus,
 * warten, Store zu» statt beidem gleichzeitig (Punkt 658 der Werkbank).
 *
 * Anders als jede Geräte-Aktion braucht ein Warte-Schritt keine
 * Entität - im Entwurf trägt er trotzdem eine, rein lokal und nie
 * gespeichert: Auswahl, Löschen und das Ändern der Sekunden laufen im
 * Editor überall über `entity_id` (`setField`, `byId`, …); ohne eine
 * eigene liesse sich ein Warte-Schritt darin nirgends anfassen.
 */

export const WARTE_KOMMANDO = 'wait';

/** Ist diese Aktion ein Warte-Schritt? (rein, testbar) */
export function istWarteSchritt(action: { command: string }): boolean {
  return action.command === WARTE_KOMMANDO;
}

/** Eine neue, rein lokale Kennung für einen Warte-Schritt.
 *
 * Nie beim Hub gespeichert - `AutomationsScreen.tsx` lässt `entity_id`
 * beim Speichern eines `wait`-Schritts weg.
 */
export function neueWarteId(): string {
  return `__warten_${Math.random().toString(36).slice(2)}`;
}

/** «10 Sekunden», «2 Minuten» (rein, testbar) - lesbarer als eine reine
 *  Zahl, sobald es über eine Minute geht. */
export function wartezeitLabel(seconds: number): string {
  if (seconds < 60) return seconds === 1 ? '1 Sekunde' : `${seconds} Sekunden`;
  const minuten = Math.round(seconds / 60);
  return minuten === 1 ? '1 Minute' : `${minuten} Minuten`;
}
