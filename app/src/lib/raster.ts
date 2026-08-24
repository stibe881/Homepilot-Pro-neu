/**
 * Wie viele Kacheln nebeneinander passen – und wie breit sie werden.
 *
 * Der Fall: Auf dem iPhone Max standen die Kacheln nebeneinander, auf
 * jedem kleineren Gerät untereinander. Zwei Ursachen, dieselbe Wurzel –
 * eine feste Zahl statt einer Rechnung:
 *
 *  - Die Startseite gab jeder Kachel `48 %` und dem Behälter zusätzlich
 *    eine Lücke von 14 Punkten. Zusammen sind das 96 % plus 14 Punkte,
 *    und das passt erst ab 350 Punkten Innenbreite. Ein iPhone 15 hat
 *    346, ein SE 331 – beide fielen knapp durch und brachen um.
 *  - Die Geräteseite entschied an der Fensterbreite («ab 380 zwei
 *    Spalten»), rechnete die Kacheln aber aus der gemessenen Fläche.
 *    Zwei Zahlen für dieselbe Frage, und die Schwelle lag genau
 *    zwischen den Geräten.
 *
 * Darum hier eine Rechnung aus der *gemessenen* Breite und einer
 * Mindestbreite je Kachel. Was nicht mehr sinnvoll lesbar wäre, bekommt
 * eine Spalte weniger – das entscheidet das Gerät, nicht eine Tabelle.
 */

import { space } from '../theme';

/** Schmaler soll eine Schaltkachel nicht werden.
 *
 * Bei 150 Punkten stehen Name, Raum und Schalter noch nebeneinander;
 * darunter bricht der Name um und die Kachel wird höher als breit. Auf
 * einem iPhone SE (331 Punkte innen) ergibt das zwei Spalten à 158 –
 * eng, aber lesbar. Auf einem alten 320er (276 innen) nur noch eine,
 * und das ist richtig so. */
export const KACHEL_MINDEST = 150;

/** Kameras brauchen Fläche: Ein Vorschaubild unter 260 Punkten zeigt
 *  nichts, was man erkennen würde. */
export const KAMERA_MINDEST = 260;

export interface RasterMass {
  /** Schmalste Breite, die eine Kachel noch verdient. */
  mindest?: number;
  /** Mehr Spalten werden auch auf breiten Schirmen nicht angeboten:
   *  Ab da wird die Seite zur Tabelle statt zur Übersicht. */
  hoechstens?: number;
  /** Abstand zwischen zwei Kacheln – dieselbe Lücke wie im Behälter. */
  luecke?: number;
}

/** Wie viele Kacheln nebeneinander passen (rein, testbar).
 *
 * `breite` ist die *gemessene* Innenbreite des Behälters, nicht die des
 * Fensters: Seitenleiste, Ränder und rechte Spalte sind darin schon
 * abgezogen.
 *
 * Ohne Messung (0) gilt eine Spalte. Das ist der Zustand für einen
 * Wimpernschlag beim ersten Zeichnen; zwei Spalten zu raten und dann
 * umzubrechen sähe schlechter aus als andersherum.
 */
export function spalten(breite: number, mass: RasterMass = {}): number {
  const { mindest = KACHEL_MINDEST, hoechstens = 3, luecke = space.gap } = mass;
  if (!Number.isFinite(breite) || breite <= 0) return 1;
  // Die Lücke einmal dazurechnen und wieder abziehen: n Kacheln brauchen
  // n-1 Lücken, nicht n. Ohne diesen Kniff fehlte genau eine Lücke, und
  // die letzte Spalte fiel raus.
  const passt = Math.floor((breite + luecke) / (mindest + luecke));
  return Math.max(1, Math.min(hoechstens, passt));
}

/** Wie breit eine einzelne Kachel wird (rein, testbar).
 *
 * In Punkten, nicht in Prozent. Prozente kennen die Lücke nicht, die der
 * Behälter dazwischenlegt – genau daran brach die Startseite.
 */
export function kachelBreite(
  breite: number,
  anzahl: number,
  luecke: number = space.gap
): number {
  if (!Number.isFinite(breite) || breite <= 0 || anzahl < 1) return 0;
  return Math.floor((breite - luecke * (anzahl - 1)) / anzahl);
}
