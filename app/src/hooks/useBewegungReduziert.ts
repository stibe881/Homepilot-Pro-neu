/**
 * Hat die Person «Bewegung reduzieren» eingeschaltet?
 *
 * Einmal gefragt, dann gemerkt - dieselbe Abfrage stand in
 * components/Auftritt.tsx; seit die Kacheln beim Schalten überblenden
 * (Punkt 438), brauchen zwei Stellen dieselbe Antwort. Nicht abfragbar
 * heisst: normal animieren.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useBewegungReduziert(): boolean {
  const [ruhig, setRuhig] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setRuhig)
      .catch(() => {});
  }, []);
  return ruhig;
}
