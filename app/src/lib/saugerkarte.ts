/**
 * Das Rechnen hinter der Saugerkarte – ohne Bildschirm, ohne Netz.
 *
 * Herausgelöst aus VacuumHome.tsx, damit es prüfbar ist: Ob ein Tipp im
 * Gang wirklich den Gang trifft, entscheidet sich hier und nicht in
 * einer Komponente, die Jest gar nicht laden kann.
 */

import { Entity } from '../api/types';

export interface VacuumRoom {
  id: number;
  name: string;
  /** [x0, y0, x1, y1] als Anteile (0..1) des Kartenbilds – die Hülle. */
  box?: number[];
  /**
   * Die tatsächliche Form: Rechtecke [x, y, breite, höhe] als Anteile.
   *
   * Der Hub liest sie aus dem gerenderten Kartenbild (kartenform.py).
   * Ohne sie bleibt es bei der Hülle – bei einer rechtwinkligen Wohnung
   * ist das dasselbe.
   */
  shape?: number[][];
}

export type Box = [number, number, number, number];

/** «Reinigt · 82 %» – Zustand und Akku in einer Zeile (rein, testbar). */
export function vacuumText(vacuum: Entity): string {
  const labels: Record<string, string> = {
    cleaning: 'Reinigt',
    returning: 'Fährt zur Station',
    charging: 'Lädt',
    charging_complete: 'Geladen',
    docked: 'An der Station',
    idle: 'Bereit',
    paused: 'Pausiert',
    error: 'Fehler',
  };
  const state = labels[String(vacuum.state.state ?? '')] ?? String(vacuum.state.state ?? '–');
  const battery = vacuum.state.battery;
  return battery != null ? `${state} · ${battery} %` : state;
}

/** Umriss aller Räume mit etwas Rand – der Bereich des Bilds, der wirklich
 *  Wohnung zeigt (rein, testbar). */
export function contentBox(rooms: VacuumRoom[], pad = 0.03): Box | null {
  const boxes = rooms.map((room) => room.box).filter(Array.isArray) as number[][];
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((box) => box[0]));
  const y0 = Math.min(...boxes.map((box) => box[1]));
  const x1 = Math.max(...boxes.map((box) => box[2]));
  const y1 = Math.max(...boxes.map((box) => box[3]));
  return padBox([x0, y0, x1, y1], pad);
}

export function padBox(box: Box, pad: number): Box {
  return [
    Math.max(0, box[0] - pad),
    Math.max(0, box[1] - pad),
    Math.min(1, box[2] + pad),
    Math.min(1, box[3] + pad),
  ];
}

/** Liegt der Punkt in der tatsächlichen Zimmerform? (rein, testbar) */
export function inShape(shape: number[][] | undefined, x: number, y: number): boolean {
  if (!Array.isArray(shape)) return false;
  return shape.some(
    (r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]
  );
}

/**
 * Welches Zimmer liegt an diesem Punkt? (rein, testbar)
 *
 * Mit der tatsächlichen Form ist das eine klare Frage: Der Punkt liegt
 * in genau einem Zimmer, und das gewinnt.
 *
 * Ohne Form – ältere Hub-Fassung, oder die Farbsuche im Kartenbild hat
 * nichts hergegeben – bleibt die alte Näherung: Die Hüllen sind
 * achsenparallele Rechtecke um schief liegende Räume und überlappen sich
 * deshalb kräftig (der Gang einer diagonalen Wohnung umschliesst als
 * Rechteck halbe Nachbarzimmer). Von allen Treffern gewinnt dann das
 * kleinste – es beschreibt den Punkt am genauesten.
 */
export function roomAt(rooms: VacuumRoom[], x: number, y: number): VacuumRoom | null {
  for (const room of rooms) {
    if (inShape(room.shape, x, y)) return room;
  }
  let best: VacuumRoom | null = null;
  let bestArea = Infinity;
  for (const room of rooms) {
    // Zimmer mit Form haben oben schon entschieden – ihre Hülle darf
    // jetzt nicht doch noch den Nachbarn überstimmen.
    if (Array.isArray(room.shape)) continue;
    const box = room.box;
    if (!Array.isArray(box)) continue;
    if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
    const area = (box[2] - box[0]) * (box[3] - box[1]);
    if (area < bestArea) {
      best = room;
      bestArea = area;
    }
  }
  return best;
}

/** In welchem Zimmer steht der Sauger? (rein, testbar) */
export function robotRoom(rooms: VacuumRoom[], robot: number[] | undefined): VacuumRoom | null {
  if (!Array.isArray(robot) || robot.length !== 2) return null;
  return roomAt(rooms, robot[0], robot[1]);
}

/** Eine Fläche vom Bild- in den Ausschnitt-Raum umrechnen (rein, testbar). */
export function inCrop(box: number[], crop: Box): Box | null {
  const width = crop[2] - crop[0];
  const height = crop[3] - crop[1];
  if (width <= 0 || height <= 0) return null;
  const x0 = (box[0] - crop[0]) / width;
  const y0 = (box[1] - crop[1]) / height;
  const x1 = (box[2] - crop[0]) / width;
  const y1 = (box[3] - crop[1]) / height;
  if (x1 <= 0 || y1 <= 0 || x0 >= 1 || y0 >= 1) return null;
  return [Math.max(0, x0), Math.max(0, y0), Math.min(1, x1), Math.min(1, y1)];
}

/**
 * Die Rechtecke einer Zimmerform im Ausschnitt (rein, testbar).
 *
 * Was ausserhalb liegt, fällt weg; der Rest kommt als [x, y, breite,
 * höhe] in Ausschnitt-Anteilen zurück – fertig zum Zeichnen.
 */
export function shapeInCrop(shape: number[][] | undefined, crop: Box): number[][] {
  if (!Array.isArray(shape)) return [];
  const teile: number[][] = [];
  for (const r of shape) {
    const area = inCrop([r[0], r[1], r[0] + r[2], r[1] + r[3]], crop);
    if (!area) continue;
    teile.push([area[0], area[1], area[2] - area[0], area[3] - area[1]]);
  }
  return teile;
}
