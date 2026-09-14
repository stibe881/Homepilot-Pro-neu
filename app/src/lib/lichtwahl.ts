import { Entity } from '../api/types';
import { weisstonFarbe } from './szenenfarben';
import { WEISSTOENE } from './weisston';

/**
 * Was eine Lichtkachel zum Einstellen anbietet - und was davon gerade
 * leuchtet (Punkt 648 der Werkbank).
 *
 * Der gemeldete Fall, mit Bild der Büro-Kacheln: «Man kann bei den
 * Lichtern die Farbe und die Weissheit nicht einstellen in den Kacheln.
 * Es soll aber auch nur da gehen, wo die Lampen dies unterstützen.»
 * Beide Hälften des Satzes stehen hier: Die Kachel zeigt eine Reihe,
 * wenn die Lampe sie kann, und keine, wenn nicht - ein Farbpunkt an
 * einer Lampe, die nur an und aus kann, wäre ein Knopf, der nichts tut.
 *
 * Weisstöne und Farben in **einer** Reihe, Weiss zuerst: Es ist dieselbe
 * Frage («in welchem Licht soll es leuchten?»), und die häufigste
 * Antwort ist warmweiss. Zwei getrennte Reihen wären zwei Zeilen für
 * eine Entscheidung.
 *
 * Reines Rechnen; wer es zeichnet, ist components/ColorRow.tsx.
 */

/** Ein Weisston, wie ihn die Reihe zeigt. */
export interface Weissknopf {
  /** Mirek - der Wert, den `set_color_temp` erwartet. */
  mirek: number;
  /** «warmweiss» und so weiter. */
  label: string;
  /** Womit der Punkt in der App gezeichnet wird. Ungefähr, nicht
   *  gemessen: Er soll den Unterschied zeigen, nicht die Lampe
   *  vorführen. */
  hex: string;
}

// Die Farbe zum Zeichnen kommt aus lib/szenenfarben.ts - dieselbe, die
// ein Szenenknopf als Punkt trägt. Zwei Paletten für dieselben drei
// Töne wären zwei Stellen, an denen jemand eine ändert.
export const WEISSKNOEPFE: Weissknopf[] = WEISSTOENE.map((ton) => ({
  mirek: ton.mirek,
  label: ton.label,
  hex: weisstonFarbe(ton.mirek),
}));

/** Kann die Lampe Farben? (rein, testbar) */
export function kannFarbe(entity: Entity): boolean {
  return entity.commands.includes('set_color');
}

/** Kann sie Weisstöne? (rein, testbar) */
export function kannWeiss(entity: Entity): boolean {
  return entity.commands.includes('set_color_temp');
}

/**
 * Welcher Weisston leuchtet gerade? (rein, testbar)
 *
 * Der nächstgelegene der drei, nicht der genaue Wert: Eine Lampe meldet
 * 366 zurück, wo 370 geschickt wurde, und eine Szene aus der Bridge
 * bringt Werte mit, die auf keiner unserer Stufen liegen. Ohne
 * Nachsicht wäre nie ein Punkt markiert.
 *
 * `null` heisst: Die Lampe leuchtet bunt (``color_mode``) oder hat
 * keinen Weisston gemeldet. Der Modus kommt von der Bridge, weil nur
 * sie ihn kennt - der zuletzt gesetzte Weisston bleibt im Zustand
 * stehen, auch während die Lampe rot leuchtet.
 */
export function aktiverWeisston(entity: Entity): number | null {
  if (!kannWeiss(entity)) return null;
  if (String(entity.state.color_mode ?? '') === 'farbe') return null;
  const wert = Number(entity.state.color_temp);
  if (!Number.isFinite(wert) || wert <= 0) return null;
  let beste: number | null = null;
  let abstand = Infinity;
  for (const ton of WEISSKNOEPFE) {
    const dieser = Math.abs(ton.mirek - wert);
    if (dieser < abstand) {
      abstand = dieser;
      beste = ton.mirek;
    }
  }
  // Mehr als 60 Mirek daneben heisst: Das ist keine unserer Stufen -
  // dann lieber kein Punkt als ein falscher.
  return abstand <= 60 ? beste : null;
}

/**
 * Leuchtet die Lampe gerade bunt? (rein, testbar)
 *
 * Nur dann soll in der Farbreihe ein Punkt markiert sein. Ohne den
 * Modus (Anbindungen, die ihn nicht melden) gilt: Was eine Farbe im
 * Zustand hat, zeigt sie auch.
 */
export function zeigtFarbe(entity: Entity): boolean {
  if (!kannFarbe(entity)) return false;
  const modus = String(entity.state.color_mode ?? '');
  if (modus === 'weiss') return false;
  return typeof entity.state.color === 'string';
}

/**
 * Aus der Fingerhöhe im senkrechten Regler ein Prozent (rein, testbar).
 *
 * Oben ist hell: Der Balken zählt von unten, die Bildschirmkoordinate
 * von oben. Genau diese Umkehrung ist der Fehler, den man sonst erst an
 * der Lampe bemerkt - man zieht nach oben und es wird dunkler.
 */
export function ausY(y: number, hoehe: number): number {
  if (hoehe <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((hoehe - y) / hoehe) * 100)));
}
