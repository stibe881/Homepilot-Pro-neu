/**
 * Wer hat die Türe aufgeschlossen? (Punkt 616 der Werkbank)
 *
 * Der Hub liest das Protokoll des Nuki (integrations/nuki.py) und legt
 * den letzten Eintrag als `last_unlock: {by, via, at}` in den Zustand.
 * Hier wird daraus die Zeile unter der Pille: «Livia (Code) · 15:42».
 * Die Kachel sagte bisher «Aufgeschlossen» - ohne Wer und ohne Seit-wann.
 */

import { EntityState } from '../api/types';

export interface LetzteOeffnung {
  by?: string;
  via?: string;
  at?: number;
}

/** Nach so vielen Stunden steht das Datum dazu - «15:42» allein wäre
 *  bei einem Eintrag von vorgestern eine Lüge. */
const HEUTE_STUNDEN = 20;

function uhr(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Die Zeile zum letzten Aufschliessen (rein, testbar).
 *
 *  Null, wenn der Hub nichts weiss (älterer Hub, kein Nuki, noch kein
 *  Eintrag seit dem Start). Ist die Türe inzwischen wieder abgeschlossen,
 *  steht «Zuletzt» davor - sonst läse sich «Livia (Code) · 15:42» unter
 *  «Abgeschlossen» wie ein Widerspruch. */
export function letzteOeffnung(state: EntityState, now: number = Date.now()): string | null {
  const roh = state.last_unlock as LetzteOeffnung | null | undefined;
  if (!roh || typeof roh !== 'object') return null;
  const at = typeof roh.at === 'number' && roh.at > 0 ? roh.at * 1000 : null;
  const wer = typeof roh.by === 'string' && roh.by.trim() ? roh.by.trim() : 'Jemand';
  const womit = typeof roh.via === 'string' && roh.via && roh.via !== 'unbekannt' ? ` (${roh.via})` : '';
  let wann = '';
  if (at != null) {
    const datum = new Date(at);
    const alt = now - at > HEUTE_STUNDEN * 3600 * 1000;
    wann = alt ? ` · ${datum.getDate()}.${datum.getMonth() + 1}. ${uhr(datum)}` : ` · ${uhr(datum)}`;
  }
  const zeile = `${wer}${womit}${wann}`;
  return String(state.state) === 'locked' ? `Zuletzt: ${zeile}` : zeile;
}
