/**
 * Hat die Person «Bewegung reduzieren» eingeschaltet?
 *
 * Einmal gefragt, dann gemerkt - dieselbe Abfrage stand in
 * components/Auftritt.tsx; seit die Kacheln beim Schalten überblenden
 * (Punkt 527), brauchen mehrere Stellen dieselbe Antwort. Nicht
 * abfragbar heisst: normal animieren.
 *
 * Der eine Weg für alle (Fehler aus der Runde 579 der Werkbank): Der
 * Lauftext fragte AccessibilityInfo selbst, der Zustandspunkt fragte gar
 * nicht - und Archiv 527 behauptete das Gegenteil. Wer eine Bewegung
 * baut, holt sich die Antwort hier; und weil man die Einstellung auch
 * bei offener App umlegt, hört der Hook auf die Änderung.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useBewegungReduziert(): boolean {
  const [ruhig, setRuhig] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setRuhig)
      .catch(() => {});
    const horcher = AccessibilityInfo.addEventListener('reduceMotionChanged', setRuhig);
    return () => horcher.remove();
  }, []);
  return ruhig;
}
