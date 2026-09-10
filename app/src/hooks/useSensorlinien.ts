/**
 * Die Funkenlinien der Sensoren - eine Abfrage für alle.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { HubClient } from '../api/client';
import { ConnectionStatus } from './useHub';
import { useTakt } from './useTakt';

export function useSensorlinien(hub: HubClient, status: ConnectionStatus) {
  // Die Funkenlinien der Sensoren: ein Abruf für alle, alle fünf
  // Minuten - die Reihen ändern sich nicht schneller (Drosselung im
  // Hub, core/kurzverlauf.py).
  const [trends, setTrends] = useState<Record<string, [number, number][]>>({});
  // Kein Zustand mehr setzen, sobald der Haken ausgehängt ist - eine
  // Antwort kann eintreffen, nachdem die Seite längst gewechselt hat.
  const beendetRef = useRef(false);
  useEffect(() => {
    beendetRef.current = false;
    return () => {
      beendetRef.current = true;
    };
  }, []);

  const laden = useCallback(() => {
    if (status !== 'connected') return;
    hub
      .get<{ trends?: Record<string, [number, number][]> } | null>('/api/trends', {
        fallback: null,
        still: true,
      })
      .then((data) => {
        if (!beendetRef.current && data?.trends) setTrends(data.trends);
      });
  }, [status, hub]);

  useEffect(laden, [laden]);
  // Punkt 345: der gemeinsame Takt statt einem eigenen setInterval - er
  // hält im Hintergrund an und lädt beim Zurückkommen sofort einmal neu,
  // statt bis zu fünf Minuten eine alte Linie zu zeigen.
  useTakt(laden, status === 'connected' ? 5 * 60 * 1000 : null);

  // Wie oft welcher Raum auf diesem Gerät bedient wurde - nur fürs
  return trends;
}
