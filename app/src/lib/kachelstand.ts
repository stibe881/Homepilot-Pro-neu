/**
 * Was im Anpassen-Modus auf einer Kachel steht.
 *
 * Der Anpassen-Modus zeigte alles auf einmal: zwei Chips für Raum und
 * Gruppe, darunter bis zu fünf beschriftete Knöpfe. Auf einer
 * halbbreiten Telefonkachel brauchen die vier Knöpfe rund 320 Punkte
 * Breite und bekommen 180 – sie brachen also auf zwei Reihen um, die
 * Chips ebenso, und der Griff zum Verschieben lag über dem Raum-Chip.
 * Der eigentliche Inhalt – Name, Zustand, «vor 13 Std.» – rutschte
 * dabei so weit nach unten, dass zwei Kacheln einen Bildschirm füllten.
 *
 * Statt die Knöpfe kleiner zu machen, sind sie umgezogen: in ein Blatt,
 * das sich über die ganze Breite öffnet. Auf der Kachel bleibt eine
 * Zeile, die sagt, was eingestellt ist. Hier steht, wie sie lautet.
 */
export interface Kachelstand {
  room?: string | null;
  group?: string | null;
  favorite?: boolean;
  hidden?: boolean;
  locked?: boolean;
  ungezaehlt?: boolean;
}

/**
 * Die Zeile unter dem Namen (rein, testbar).
 *
 * Der Raum immer, auch wenn keiner gesetzt ist: «Kein Raum» ist die
 * Auskunft, wegen der man den Anpassen-Modus überhaupt öffnet. Alles
 * andere nur, wenn es gilt. «Keine Gruppe · kein Favorit · nicht
 * versteckt» stünde sonst auf jeder der vierzig Kacheln und wäre auf
 * einer halbbreiten schon nach dem Raum abgeschnitten.
 */
export function standZeile(stand: Kachelstand): string {
  const teile: string[] = [];
  teile.push(stand?.room?.trim() || 'Kein Raum');
  const gruppe = stand?.group?.trim();
  if (gruppe) teile.push(gruppe);
  if (stand?.favorite) teile.push('Favorit');
  if (stand?.hidden) teile.push('versteckt');
  if (stand?.locked) teile.push('Rückfrage');
  if (stand?.ungezaehlt) teile.push('zählt nicht');
  return teile.join(' · ');
}

/**
 * Weicht die Kachel vom Gewöhnlichen ab? (rein, testbar)
 *
 * Nur dann bekommt die Zeile Farbe. Ohne das leuchtete jede Kachel im
 * Anpassen-Modus, und die drei, an denen jemand etwas eingestellt hat,
 * gingen zwischen den vierzig anderen unter.
 */
export function faelltAuf(stand: Kachelstand): boolean {
  return !!(
    stand?.favorite ||
    stand?.hidden ||
    stand?.locked ||
    stand?.ungezaehlt
  );
}
