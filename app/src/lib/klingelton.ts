/**
 * Der Klingelton: welcher Klang auf welchen Boxen spielt, wenn es klingelt.
 *
 * Gehört zur Regel «Es klingelt» (core/notifyrules.py) und steht deshalb in
 * deren Karte, wie die Storen-Auswahl der Wächter-Regeln in ihrer eigenen.
 * Anders als dort heisst eine leere Auswahl hier «still», nicht «alle
 * Boxen» - ein Klingelton soll erst losgehen, wenn ihn jemand eingerichtet
 * hat, nicht beim ersten Klingeln nach der Auslieferung auf jeder Box im
 * Haus (core/klingelton.py).
 */

export interface Lautsprecher {
  id: string;
  name: string;
  room?: string | null;
}

export interface Klang {
  key: string;
  label: string;
}

export interface Klingeltonstand {
  sound: string;
  speakers: string[];
  sounds: Klang[];
  candidates: Lautsprecher[];
}

/** Name und Raum in einer Zeile (rein, testbar). */
export function lautsprecherName(box: Lautsprecher): string {
  const raum = (box.room ?? '').trim();
  if (!raum || box.name.toLowerCase().includes(raum.toLowerCase())) {
    return box.name;
  }
  return `${box.name} · ${raum}`;
}

/** Eine Box aus der Auswahl nehmen oder dazunehmen (rein, testbar). */
export function boxUmschalten(gewaehlt: string[], id: string): string[] {
  return gewaehlt.includes(id)
    ? gewaehlt.filter((eintrag) => eintrag !== id)
    : [...gewaehlt, id];
}

/**
 * Was die Wahl gerade bewirkt, in einem Satz (rein, testbar).
 *
 * Ohne Box steht hier bewusst, was *nicht* passiert - sonst sucht man
 * den versprochenen Ton und hält sein Ausbleiben für einen Fehler.
 */
export function klingeltonSatz(stand: Klingeltonstand | null): string {
  if (!stand || stand.speakers.length === 0) {
    return 'Keine Box gewählt – es bleibt bei der Push-Nachricht allein.';
  }
  const klang = stand.sounds.find((eintrag) => eintrag.key === stand.sound)?.label ?? stand.sound;
  const namen = stand.speakers
    .map((id) => stand.candidates.find((box) => box.id === id))
    .filter((box): box is Lautsprecher => box != null)
    .map(lautsprecherName);
  const boxenText =
    namen.length <= 2 ? namen.join(' und ') : `${namen.length} Boxen`;
  return `«${klang}» spielt auf ${boxenText}.`;
}
