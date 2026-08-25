/**
 * Wohin ein gezogener Eintrag fällt.
 *
 * Herausgelöst aus components/DraggableList.tsx: Die Datei zieht die
 * Symbolschriften von Expo mit, und Jest lädt sie deshalb nicht.
 *
 * Was hier steht, ist nur die Rechnung. Der Fehler, der zu dieser Datei
 * geführt hat, lag *nicht* darin, sondern in der Geste selbst: Der
 * PanResponder wurde bei jeder Fingerbewegung neu gebaut und verlor
 * damit den Startpunkt, sodass `dy` nie mehr als einen Wimpernschlag
 * mass. Prüfen lässt sich das nur im Browser – die Rechnung hier
 * wenigstens schon.
 */

/** Höhe einer Zeile – Grundlage fürs Umrechnen der Ziehdistanz. */
export const ROW = 56;

/**
 * Auf welchem Platz ein Eintrag landet (rein, testbar).
 *
 * Gerundet, nicht abgeschnitten: Wer eine Zeile um zwei Drittel ihrer
 * Höhe zieht, meint die nächste – nicht dieselbe.
 */
export function zielIndex(index: number, dy: number, laenge: number): number {
  if (laenge <= 0) return 0;
  return Math.max(0, Math.min(laenge - 1, index + Math.round(dy / ROW)));
}

/** Die neue Reihenfolge nach dem Loslassen (rein, testbar).
 *
 * Null heisst: nichts geändert – dann muss auch nichts gespeichert
 * werden. */
export function verschoben<T>(items: T[], von: number, nach: number): T[] | null {
  if (von === nach || von < 0 || von >= items.length) return null;
  const next = [...items];
  const [moved] = next.splice(von, 1);
  next.splice(nach, 0, moved);
  return next;
}
