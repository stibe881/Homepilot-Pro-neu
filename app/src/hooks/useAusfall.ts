/**
 * Wann die App von einem Ausfall sprechen darf.
 *
 * Der Balken «Keine Verbindung – gezeigt wird der letzte bekannte Stand»
 * kam bei jedem Öffnen der App kurz zum Vorschein: Die Verbindung wird
 * beim Aufwachen grundsätzlich neu aufgebaut (hooks/useHub.ts), und für
 * diese ein, zwei Sekunden stand der Status auf «connecting». Zwei
 * Schäden auf einmal:
 *
 * - **Der erste Tipp ging ins Leere.** Der Balken steht im Scrollbereich
 *   ganz oben. Er erschien, schob die ganze Seite nach unten - und
 *   verschwand, sobald die Verbindung stand. Wer genau dann tippte,
 *   traf den Inhalt im Sprung: Der Druck wurde abgebrochen oder landete
 *   auf der falschen Kachel. Von aussen sah das aus wie «ich muss immer
 *   zweimal klicken».
 * - **Er sagte, was schon dastand.** Die Kopfzeile zeigt den
 *   Verbindungsstand ohnehin («verbinde …», components/TopStrip.tsx).
 *
 * Deshalb gilt: Der Balken erscheint erst, wenn die Trennung **Bestand
 * hat** - ein paar Sekunden am Stück ohne Verbindung. Das kurze
 * Neu-Verbinden beim Aufwachen bleibt still, ein echter Ausfall (Hub
 * aus, Netz weg) meldet sich nach der Gnadenfrist wie bisher. Denn dann
 * ist der Balken keine Wiederholung der Kopfzeile: Er sagt zusätzlich,
 * von wann die gezeigten Werte stammen.
 */
import { useEffect, useRef, useState } from 'react';

import type { ConnectionStatus } from './useHub';

/** So lange darf eine Trennung dauern, bevor sie ein Ausfall ist.
 *  Fünf Sekunden: Das Neu-Verbinden beim Aufwachen braucht eine bis
 *  zwei, und wer den Hub wirklich verliert, wartet auf diese Auskunft
 *  keine spürbare Zeit. */
export const GNADE_MS = 5000;

/**
 * Wie lange es bis zum Balken noch dauert (rein, testbar).
 *
 * `getrenntSeit` ist der Moment, in dem die Verbindung verloren ging -
 * `null` heisst: sie steht, kein Balken. Zurück kommt die restliche
 * Wartezeit in Millisekunden; 0 heisst «jetzt zeigen».
 */
export function restGnade(
  getrenntSeit: number | null,
  jetzt: number,
  gnade: number = GNADE_MS
): number | null {
  if (getrenntSeit === null) return null;
  return Math.max(0, getrenntSeit + gnade - jetzt);
}

/** Ob gerade ein Ausfall zu melden ist - mit der Gnadenfrist von oben.
 *
 *  Gerechnet wird ab dem *ersten* Verlassen von «connected»: Ein echter
 *  Ausfall pendelt zwischen «connecting» und «disconnected», und jedes
 *  Pendeln dürfte die Frist sonst neu starten - der Balken käme nie. */
export function useAusfall(status: ConnectionStatus): boolean {
  const getrenntSeit = useRef<number | null>(null);
  const [ausfall, setAusfall] = useState(false);

  useEffect(() => {
    if (status === 'connected') {
      getrenntSeit.current = null;
      setAusfall(false);
      return;
    }
    if (getrenntSeit.current === null) getrenntSeit.current = Date.now();
    const rest = restGnade(getrenntSeit.current, Date.now());
    if (rest === null) return;
    const timer = setTimeout(() => setAusfall(true), rest);
    return () => clearTimeout(timer);
  }, [status]);

  return ausfall;
}
