/**
 * Wie oft welches Gerät zu welcher Tageszeit bedient wurde.
 *
 * Wie bei den Räumen (hooks/useRaumnutzung.ts): nur fürs Sortieren, und
 * nur auf diesem Gerät. Was Stefan am Telefon abends anfasst, geht dem
 * Wandpanel im Flur nichts an – dort bedient man anderes.
 *
 * Deshalb liegt es auch im Speicher der App und nicht beim Hub: Es ist
 * keine Einstellung, sondern eine Beobachtung dieses einen Bildschirms.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Kachelzaehler, merken } from '../lib/kachellernen';
import { jetzigerAbschnitt } from '../lib/tageszeit';

const SCHLUESSEL = 'homepilot.kachelnutzung';

export function useKachelnutzung() {
  const [kachelZaehler, setKachelZaehler] = useState<Kachelzaehler>({});
  useEffect(() => {
    AsyncStorage.getItem(SCHLUESSEL)
      .then((roh) => {
        if (roh) setKachelZaehler(JSON.parse(roh));
      })
      // Ohne Protokoll wird eben nicht gelernt - die feste Reihenfolge
      // bleibt, und niemand merkt etwas.
      .catch(() => {});
  }, []);
  const zaehleKachel = useCallback((entityId: string | null | undefined) => {
    if (!entityId) return;
    setKachelZaehler((zaehler) => {
      const jetzt = Date.now();
      const neu = merken(zaehler, entityId, jetzigerAbschnitt(jetzt).key, jetzt);
      AsyncStorage.setItem(SCHLUESSEL, JSON.stringify(neu)).catch(() => {});
      return neu;
    });
  }, []);

  return { kachelZaehler, zaehleKachel };
}
