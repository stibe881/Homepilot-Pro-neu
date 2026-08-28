/**
 * Die Funkenlinien der Sensoren - eine Abfrage für alle.
 */
import { useEffect, useState } from 'react';

import { HubClient } from '../api/client';
import { ConnectionStatus } from './useHub';

export function useSensorlinien(hub: HubClient, status: ConnectionStatus) {
  // Die Funkenlinien der Sensoren: ein Abruf für alle, alle fünf
  // Minuten - die Reihen ändern sich nicht schneller (Drosselung im
  // Hub, core/kurzverlauf.py).
  const [trends, setTrends] = useState<Record<string, [number, number][]>>({});
  useEffect(() => {
    if (status !== 'connected') return;
    let beendet = false;
    const laden = () =>
      hub
        .get<{ trends?: Record<string, [number, number][]> } | null>('/api/trends', {
          fallback: null,
          still: true,
        })
        .then((data) => {
          if (!beendet && data?.trends) setTrends(data.trends);
        });
    laden();
    const takt = setInterval(laden, 5 * 60 * 1000);
    return () => {
      beendet = true;
      clearInterval(takt);
    };
  }, [status, hub]);

  // Wie oft welcher Raum auf diesem Gerät bedient wurde - nur fürs
  return trends;
}
