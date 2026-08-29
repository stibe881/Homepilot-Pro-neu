/**
 * Wie oft welcher Raum auf diesem Gerät bedient wurde.
 *
 * Nur fürs Sortieren, und nur auf diesem Gerät: Was Stefan am Telefon
 * oft öffnet, geht Livia am Wandpanel nichts an.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Nutzung, merken as merkeRaum } from '../lib/raumnutzung';

export function useRaumnutzung() {
  const [raumZaehler, setRaumZaehler] = useState<Nutzung>({});
  useEffect(() => {
    AsyncStorage.getItem('homepilot.raumnutzung')
      .then((roh) => {
        if (roh) setRaumZaehler(JSON.parse(roh));
      })
      .catch(() => {});
  }, []);
  const zaehleRaum = useCallback((raum: string | null | undefined) => {
    if (!raum) return;
    setRaumZaehler((zaehler) => {
      const neu = merkeRaum(zaehler, raum, Date.now());
      AsyncStorage.setItem('homepilot.raumnutzung', JSON.stringify(neu)).catch(() => {});
      return neu;
    });
  }, []);

  return { raumZaehler, zaehleRaum };
}
