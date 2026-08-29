import { useEffect } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const PANEL_TAG = 'homepilot-panel';

/** Hält den Bildschirm wach, solange der Wandpanel-Modus aktiv ist.
 *
 * Bewusst über activate/deactivate statt useKeepAwake: Der Hook lässt sich
 * nicht abschalten, der Bildschirm bliebe also auch ohne Panel-Modus an.
 */
export function usePanelMode(active: boolean) {
  useEffect(() => {
    if (!active) return;
    // Wachhalten ist eine Zugabe - wo es fehlt (Web), sperrt der
    // Bildschirm wie immer.
    activateKeepAwakeAsync(PANEL_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(PANEL_TAG).catch(() => {});
    };
  }, [active]);
}
