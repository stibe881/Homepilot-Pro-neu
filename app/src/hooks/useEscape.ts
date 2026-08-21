/**
 * Escape schliesst das Fenster – im Browser.
 *
 * Am Telefon gibt es den Zurück-Weg über die Geste und auf Android über
 * `onRequestClose`. Am Rechner gab es keinen: Die Web-Fassung liess sich
 * nur mit der Maus bedienen, und ein geöffnetes Fenster verliess man
 * ausschliesslich über den Knopf «Schliessen». Das ist die eine Taste,
 * nach der jeder greift.
 *
 * Bewusst als Hook und nicht als Wrapper um `Modal`: Die Fenster in dieser
 * App sind über ein Dutzend Stellen verteilt und alle etwas anders
 * gebaut. Eine Zeile je Fenster ist ehrlicher als ein Umbau, der sie alle
 * gleichmachen müsste.
 *
 *   useEscape(offen, () => setOffen(false));
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';

export function useEscape(aktiv: boolean, schliessen: () => void) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !aktiv) return;
    // `document` gibt es auf Web immer – die Prüfung ist für den
    // Server-Durchlauf beim Bauen der statischen Seite.
    if (typeof document === 'undefined') return;

    const beiTaste = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Nicht weiterreichen: Sonst schlösse ein Escape in einem Fenster,
      // das in einem anderen liegt, gleich beide.
      event.stopPropagation();
      schliessen();
    };

    document.addEventListener('keydown', beiTaste);
    return () => document.removeEventListener('keydown', beiTaste);
  }, [aktiv, schliessen]);
}
