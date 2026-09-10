/**
 * Wie eng die Kacheln stehen.
 *
 * Die Kachelgrösse ist gemessen und begründet (lib/raster.ts): 150
 * Punkte, weil darunter der Name umbricht. Das ist die richtige Antwort
 * für die Frage «was ist das Minimum» – aber nicht für die Frage, die
 * im Haus gestellt wird, und die lautet anders je nach Gerät und Person:
 *
 * - Am **Wandtablet im Flur** liest man im Vorbeigehen, aus anderthalb
 *   Metern. Dort ist gross richtig, auch wenn weniger draufpasst.
 * - Auf dem **iPad auf dem Sofa** will man die Wohnung auf einen Blick,
 *   ohne zu scrollen. Dort ist eng richtig.
 * - Auf dem **Telefon** liegt es dazwischen und hängt an den Augen
 *   dessen, der es hält.
 *
 * Deshalb am **Gerät** und nicht an der Person - genau wie der
 * Grundriss und das App-Symbol: Wandpanel, iPad und Telefon gehören
 * derselben Person und wollen trotzdem Verschiedenes.
 *
 * **Was sich dabei nicht ändert**: Der Inhalt einer Kachel. «Eng» macht
 * keine kleineren Schriften und keine kürzeren Namen - es passen bloss
 * mehr nebeneinander. Eine Dichte, die auch die Schrift schrumpfen
 * lässt, ist ein zweiter Schriftgrössen-Einsteller, und den gibt es im
 * Betriebssystem schon (lib/schrift.ts).
 *
 * Reines Rechnen; wer speichert, ist usePrefs.
 */
import { FAVORIT_MINDEST, KACHEL_MINDEST } from './raster';
import { space } from '../theme';

export type Dichte = 'luftig' | 'normal' | 'eng';

/** Die Stufen in Anzeige-Reihenfolge, mit dem Wort, das dabeisteht. */
export const DICHTEN: { key: Dichte; label: string; hinweis: string }[] = [
  {
    key: 'luftig',
    label: 'Luftig',
    hinweis: 'Grosse Kacheln – fürs Wandtablet und aus zwei Metern Abstand.',
  },
  {
    key: 'normal',
    label: 'Normal',
    hinweis: 'Wie bisher.',
  },
  {
    key: 'eng',
    label: 'Eng',
    hinweis: 'Mehr auf einen Blick – fürs iPad auf dem Sofa.',
  },
];

/**
 * Die Faktoren je Stufe.
 *
 * Absichtlich klein: ein Viertel mehr, ein Fünftel weniger. Wer daraus
 * halb und doppelt macht, bekommt bei «eng» Kacheln, in denen der Name
 * umbricht - genau das, wogegen die 150 Punkte in raster.ts stehen -,
 * und bei «luftig» eine Spalte auf dem iPad.
 */
const FAKTOR: Record<Dichte, number> = {
  luftig: 1.25,
  normal: 1,
  eng: 0.8,
};

export interface Masse {
  /** Schmalste Breite, die eine Kachel noch verdient. */
  mindest: number;
  /** Dasselbe für die kleineren Favoritenkacheln. */
  favoritMindest: number;
  /** Abstand zwischen zwei Kacheln. */
  luecke: number;
}

/** Eine gespeicherte Stufe einlesen (rein, testbar). */
export function lesen(wert: unknown): Dichte {
  const text = String(wert ?? '').trim().toLowerCase();
  return text === 'luftig' || text === 'eng' ? text : 'normal';
}

/**
 * Die Masse zu einer Stufe (rein, testbar).
 *
 * Die Lücke wächst und schrumpft mit, aber schwächer: Kacheln, die
 * grösser werden, brauchen nicht doppelt so viel Luft dazwischen -
 * sonst sieht die Seite bei «luftig» leer aus statt grosszügig.
 */
export function masse(dichte: Dichte): Masse {
  const faktor = FAKTOR[dichte];
  return {
    mindest: Math.round(KACHEL_MINDEST * faktor),
    favoritMindest: Math.round(FAVORIT_MINDEST * faktor),
    luecke: Math.round(space.gap * (1 + (faktor - 1) / 2)),
  };
}
