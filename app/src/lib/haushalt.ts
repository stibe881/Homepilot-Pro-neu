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
import { dauerText } from './format';

/** Zustandswerte, die alle dasselbe heissen: Die Maschine wartet. */
const RUHT = new Set(['idle', 'off', 'standby', 'ready', 'unknown', '']);

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
  // «Bereit» deckt alles ab, was heisst: Die Maschine wartet. Vorher
  // stand hier der rohe Wert, und je nach Firmware las man dann
  // «standby» oder – gleich nach dem Hub-Start – «unknown» an einer
  // Maschine, die schlicht dasteht.
  const grund = running ? 'Läuft' : RUHT.has(value.toLowerCase()) ? 'Bereit' : value;
  if (!running) return { text: grund, running };
  const program = entity.state.program ? ` · ${entity.state.program}` : '';
  const minutes =
    entity.state.minutes_left != null
      ? ` · noch ${dauerText(Number(entity.state.minutes_left))}`
      : '';
  return { text: grund + program + minutes, running };
}

/** Geräte an einer Messsteckdose, die zum Haushalt zählen. */
const APPLIANCE_NAME = /tumbler|trockner|wasch|geschirr|sp(ü|ue)lmaschine/i;

/** Ab dieser Leistung gilt ein Gerät an der Steckdose als «arbeitet». */
const WORKING_WATTS = 5;

export interface Working {
  entity: Entity;
  /** Kurze Zusatzangabe: Restzeit, Programm oder Leistung. */
  note: string;
}

/**
 * Welche Haushaltsgeräte arbeiten gerade? (rein, testbar)
 *
 * Zwei Quellen, weil die Geräte unterschiedlich angebunden sind: echte
 * Haushaltsgeräte (V-ZUG & Co.) melden ihren Zustand selbst, ein Tumbler an
 * der Schalt-Messsteckdose verrät es nur über die Leistung – eingeschaltet
 * ist die Steckdose auch dann noch, wenn er längst fertig ist.
 */
export function workingAppliances(entities: Entity[]): Working[] {
  const working: Working[] = [];
  for (const entity of entities) {
    if (!entity.available) continue;

    if (entity.kind === 'appliance') {
      const state = String(entity.state.state ?? '');
      if (state !== 'running' && state !== 'on') continue;
      const minutes = entity.state.minutes_left;
      working.push({
        entity,
        note:
          minutes != null
            ? // «noch 233 min» rechnet sonst jeder selbst nach – meistens
              // falsch. Über einer Stunde also «3 h 53 min».
              `noch ${dauerText(Number(minutes))}`
            : String(entity.state.program ?? 'läuft'),
      });
      continue;
    }

    const watts = Number(entity.state.power);
    if (!Number.isFinite(watts)) continue;
    if (!APPLIANCE_NAME.test(entity.name)) continue;
    if (String(entity.state.state) === 'off' || watts <= WORKING_WATTS) continue;
    working.push({ entity, note: `${Math.round(watts)} W` });
  }
  return working;
}
