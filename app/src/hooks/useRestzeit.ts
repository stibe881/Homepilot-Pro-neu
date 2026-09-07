import { useState } from 'react';

import { useTakt } from './useTakt';

/**
 * Eine Uhr, die nur läuft, solange etwas abläuft.
 *
 * Für die Restzeit der Abläufe («geht in 12 Min aus», lib/abschaltung.ts):
 * Der Hub schickt den Zeitpunkt genau einmal, heruntergezählt wird in der
 * App - und zwar nur dort, wo gerade wirklich eine Frist läuft. Ohne
 * Frist gibt es keinen Takt: Zwanzig Kacheln, die im Sekundentakt nichts
 * zu zeigen haben, kosten Akku für nichts.
 *
 * Zehn Sekunden, weil die Anzeige in Minuten rechnet: Ein feinerer Takt
 * änderte am Text nichts, ein gröberer liesse «noch 1 Min» zu lange
 * stehen.
 */
export function useJetzt(aktiv: boolean, ms = 10000): number {
  const [jetzt, setJetzt] = useState(() => Date.now());
  useTakt(() => setJetzt(Date.now()), aktiv ? ms : null);
  return jetzt;
}
