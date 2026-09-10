/**
 * Das Absturzbuch dieses Geräts (Punkt 272 der Werkbank).
 *
 * Auf dem Gerät und nicht beim Hub: Ein Zeichenfehler in der App ist
 * nichts, was der Hub beheben könnte, und er passiert je Gerät anders -
 * das Wandtablet im Flur zeigt andere Kacheln als das iPhone. Ein
 * gemeinsames Buch hiesse, im Flur nach einem Fehler zu suchen, der auf
 * dem Telefon passiert ist.
 *
 * Gelesen wird beim Start, geschrieben bei jedem Fang von
 * `<Auffangnetz>`. Die Regeln stehen rein und testbar in
 * `lib/absturzbuch.ts`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { Absturz, eintragen } from '../lib/absturzbuch';

const SCHLUESSEL = 'homepilot.abstuerze';

export function useAbstuerze() {
  const [abstuerze, setAbstuerze] = useState<Absturz[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(SCHLUESSEL)
      .then((roh) => {
        if (roh) setAbstuerze(JSON.parse(roh));
      })
      // Ohne Buch fehlt eine Auskunft - die App läuft trotzdem.
      .catch(() => {});
  }, []);

  const merkeAbsturz = useCallback((bereich: string, meldung: string) => {
    setAbstuerze((buch) => {
      const neu = eintragen(buch, { bereich, meldung, at: Date.now() });
      AsyncStorage.setItem(SCHLUESSEL, JSON.stringify(neu)).catch(() => {});
      return neu;
    });
  }, []);

  const abstuerzeVergessen = useCallback(() => {
    setAbstuerze([]);
    AsyncStorage.removeItem(SCHLUESSEL).catch(() => {});
  }, []);

  return { abstuerze, merkeAbsturz, abstuerzeVergessen };
}
