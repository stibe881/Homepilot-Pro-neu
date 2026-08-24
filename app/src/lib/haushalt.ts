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

export interface GeraeteZeile {
  text: string;
  running: boolean;
}

/**
 * Was auf der Kachel steht, solange nichts läuft.
 *
 * Ohne diese Liste stand unter «Waschmaschine» der rohe Wert aus dem
 * Hub – und weil V-ZUG-Geräte im Standby mit 503 antworten und der Hub
 * dann noch keine Messung hat, war das stundenlang das englische
 * «unknown». Ein Zustand, der niemandem etwas sagt, ist so gut wie
 * keiner.
 */
const RUHETEXT: Record<string, string> = {
  idle: 'Bereit',
  off: 'Bereit',
  // Gerät am Netz, Anzeige schläft. Nicht «Bereit»: Ob die Maschine
  // ausgeräumt ist, weiss im Standby niemand.
  standby: 'Standby',
  unknown: 'Unbekannt',
  '': 'Unbekannt',
};

/**
 * Der Zustand eines Haushaltgeräts in einem Wort (rein, testbar).
 *
 * An drei Stellen gebraucht – Übersichtskachel, Raumkachel, Gerätekarte.
 * Sie sagten bisher jede für sich «Läuft» oder sonst «Bereit»; ein Gerät
 * im Standby stand damit auf der einen Seite als «Standby» und auf der
 * anderen als «Bereit».
 */
export function zustandsText(value: unknown): string {
  const wert = String(value ?? '');
  if (wert === 'running' || wert === 'on') return 'Läuft';
  // Ein unerwarteter Wert steht weiter beim Namen da: «error» auf der
  // Kachel ist hässlich, aber es ist die Wahrheit und man kann danach
  // suchen. Nur was der Hub regelmässig schickt, wird übersetzt.
  return RUHETEXT[wert] ?? wert;
}

/** Zustandstext einer Haushaltgerät-Kachel (rein, testbar). */
export function applianceLine(
  entity: Entity | undefined,
  demoText: string
): GeraeteZeile {
  if (!entity) return { text: demoText, running: /läuft|trocknen/i.test(demoText) };
  const value = String(entity.state.state ?? '');
  const running = value === 'running' || value === 'on';
  const grund = zustandsText(value);
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
