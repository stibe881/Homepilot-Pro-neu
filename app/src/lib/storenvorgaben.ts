/**
 * Die vier Stellungen, die man einer Store im Alltag gibt.
 *
 * Auf der Kachel standen bisher zwei Schieberegler - einer für die Höhe,
 * einer für die Lamellen -, beide in denselben Farben und beide auf 100
 * stehend. Wer die Store bedienen wollte, musste zuerst herausfinden,
 * welcher Balken welcher ist, und dann auf einen Prozentwert zielen.
 *
 * Im Alltag will man aber vier Stellungen und nicht hundert: ganz auf,
 * halb, Beschattung, zu. Vier Knöpfe treffen ist leichter als ein Wert
 * ziehen, und man sieht am angehobenen Knopf, wo die Store gerade steht.
 * Der Feinschliff bleibt - er liegt einen Tipp entfernt.
 *
 * «Beschattung» ist die eine Stellung, die eine Lamellenstore vor allen
 * anderen ausmacht: unten, aber offen. Nur wo es Lamellen gibt, steht
 * sie auch da; sonst wäre es ein zweites «zu».
 */

export type VorgabeKey = 'auf' | 'halb' | 'schatten' | 'zu';

export interface Vorgabe {
  key: VorgabeKey;
  label: string;
  /** Was der Hub bekommt - der Reihe nach ausgeführt. */
  befehle: { command: string; data?: Record<string, number> }[];
}

/** Bei so viel Abweichung gilt eine Vorgabe noch als «erreicht». Die
 *  Store meldet nach der Fahrt selten genau 50 - 47 ist dieselbe
 *  Stellung, und ein Knopf, der bei 47 nicht mehr leuchtet, wirkt kaputt. */
export const TOLERANZ = 8;

/**
 * Die Vorgaben, die dieses Gerät kann (rein, testbar).
 *
 * Ohne `set_position` bleiben «Auf» und «Zu»: Ein Rollo am Funkschalter
 * kennt nur fahren, und ein Knopf «Halb», der nichts täte, wäre schlimmer
 * als keiner.
 */
export function vorgaben(commands: string[]): Vorgabe[] {
  const kann = (befehl: string) => commands.includes(befehl);
  const liste: Vorgabe[] = [
    { key: 'auf', label: 'Auf', befehle: [{ command: 'open' }] },
  ];
  if (kann('set_position')) {
    liste.push({
      key: 'halb',
      label: 'Halb',
      befehle: [{ command: 'set_position', data: { position: 50 } }],
    });
  }
  if (kann('set_tilt')) {
    // Unten und trotzdem hell: Genau dafür hat eine Lamellenstore
    // Lamellen. Erst fahren, dann kippen - umgekehrt stellt die Fahrt
    // die Lamellen wieder gerade.
    liste.push({
      key: 'schatten',
      label: 'Beschattung',
      befehle: [{ command: 'close' }, { command: 'set_tilt', data: { tilt: 50 } }],
    });
  } else if (kann('set_position')) {
    liste.push({
      key: 'schatten',
      label: 'Beschattung',
      befehle: [{ command: 'set_position', data: { position: 25 } }],
    });
  }
  liste.push({ key: 'zu', label: 'Zu', befehle: [{ command: 'close' }] });
  return liste;
}

/**
 * Welche Vorgabe gerade gilt (rein, testbar).
 *
 * `null` heisst: keine - die Store steht irgendwo dazwischen, und dann
 * soll auch kein Knopf leuchten. Etwas anderes zu behaupten wäre die
 * schlechtere Auskunft: Wer «Halb» hervorgehoben sieht, glaubt es.
 */
export function aktiveVorgabe(
  position: number | null,
  tilt: number | null,
  hatTilt: boolean
): VorgabeKey | null {
  if (position === null) return null;
  const nahe = (wert: number, ziel: number) => Math.abs(wert - ziel) <= TOLERANZ;
  if (nahe(position, 100)) return 'auf';
  if (nahe(position, 0)) {
    // Unten mit offenen Lamellen ist Beschattung, unten mit geschlossenen
    // ist zu - dieselbe Höhe, zwei verschiedene Zimmer.
    if (hatTilt && tilt !== null && tilt > TOLERANZ) return 'schatten';
    return 'zu';
  }
  if (!hatTilt && nahe(position, 25)) return 'schatten';
  if (nahe(position, 50)) return 'halb';
  return null;
}
