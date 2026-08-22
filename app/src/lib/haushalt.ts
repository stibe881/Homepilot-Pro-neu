/**
 * Was auf einer Haushaltgerät-Kachel steht (Punkt aus dem Betrieb).
 *
 * Herausgelöst aus OverviewScreen, weil genau hier ein Fehler wohnte, den
 * man nur in der Küche sieht: Die Kachel hängte die Restzeit an, egal ob
 * das Gerät lief. Zusammen mit dem Zustands-Merge des Hubs (ein Feld, das
 * eine Integration weglässt, behält seinen alten Wert) stand an der
 * längst fertigen Waschmaschine tagelang «Bereit · noch 1 min».
 *
 * Die Regel dagegen ist einfach: Restzeit und Programm gehören zu einem
 * laufenden Gerät. Steht es still, steht da «Bereit» – und sonst nichts.
 */

import { Entity } from '../api/types';

export interface GeraeteZeile {
  text: string;
  running: boolean;
}

/** Zustandstext einer Haushaltgerät-Kachel (rein, testbar). */
export function applianceLine(
  entity: Entity | undefined,
  demoText: string
): GeraeteZeile {
  if (!entity) return { text: demoText, running: /läuft|trocknen/i.test(demoText) };
  const value = String(entity.state.state ?? '');
  const running = value === 'running' || value === 'on';
  const grund = running ? 'Läuft' : value === 'idle' || value === 'off' ? 'Bereit' : value;
  if (!running) return { text: grund, running };
  const program = entity.state.program ? ` · ${entity.state.program}` : '';
  const minutes =
    entity.state.minutes_left != null ? ` · noch ${entity.state.minutes_left} min` : '';
  return { text: grund + program + minutes, running };
}
