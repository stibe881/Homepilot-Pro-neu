/**
 * Hell und wach, solange die Kassenansicht offen ist (Punkt 532).
 *
 * `expo-brightness` ist ein natives Modul - deshalb ging mit ihm die
 * `runtimeVersion` auf 8 (CLAUDE.md, «Ausliefern»). Im Browser gibt es
 * keine Helligkeit; dort bleibt es beim Wachhalten, und jeder Fehler
 * des Moduls ist keiner: Ein Telefon, das an der Kasse nicht heller
 * wird, zeigt den Code trotzdem.
 */
import * as Brightness from 'expo-brightness';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { KASSEN_HELLIGKEIT, zurueckstellen } from '../lib/kassenlicht';

const KASSE_TAG = 'kasse';

export function useKassenlicht(offen: boolean): void {
  useEffect(() => {
    if (!offen) return;
    activateKeepAwakeAsync(KASSE_TAG).catch(() => {});
    let vorher: number | null = null;
    if (Platform.OS !== 'web') {
      Brightness.getBrightnessAsync()
        .then((wert) => {
          vorher = wert;
          return Brightness.setBrightnessAsync(KASSEN_HELLIGKEIT);
        })
        .catch(() => {});
    }
    return () => {
      deactivateKeepAwake(KASSE_TAG).catch(() => {});
      const zurueck = zurueckstellen(vorher);
      if (zurueck !== null && Platform.OS !== 'web') {
        Brightness.setBrightnessAsync(zurueck).catch(() => {});
      }
    };
  }, [offen]);
}
