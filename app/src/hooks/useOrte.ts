/**
 * Die Orte des Hubs – und wie ein Laden zu seinem kommt.
 *
 * Orte gab es bisher nur in der config.yaml. Für das Zuhause geht das
 * gerade noch, für Läden nicht: Wer im Coop steht und merkt, dass die
 * Erinnerung fehlt, wird nicht per SSH eine Datei bearbeiten.
 *
 * Deshalb derselbe Weg wie beim Zuhause: davorstehen, Knopf drücken.
 * Koordinaten abzutippen bringt niemand fehlerfrei zustande, und ein
 * Ort, der 300 m danebenliegt, meldet sich nie.
 */

import { useCallback, useEffect, useState } from 'react';

import { HubSettings } from '../api/types';
import { Ort } from './useOrtung';

export interface OrtMitHerkunft extends Ort {
  /** 'config' = aus der config.yaml, nicht löschbar. 'app' = hier angelegt. */
  source?: 'config' | 'app';
}

export function useOrte(settings: HubSettings) {
  const [orte, setOrte] = useState<OrtMitHerkunft[]>([]);
  const [laeuft, setLaeuft] = useState(false);

  const kopf = useCallback(
    () => ({
      'Content-Type': 'application/json',
      ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
    }),
    [settings.token]
  );

  const laden = useCallback(async () => {
    try {
      const antwort = await fetch(`${settings.url}/api/presence/zones`, {
        headers: kopf(),
      });
      if (!antwort.ok) return;
      const daten = (await antwort.json()) as { places?: OrtMitHerkunft[] };
      setOrte(daten.places ?? []);
    } catch {
      // Kein Hub erreichbar: Dann bleibt die Liste, wie sie war. Eine
      // Fehlermeldung hier wäre Lärm - man merkt es an anderer Stelle.
    }
  }, [settings.url, kopf]);

  useEffect(() => {
    laden();
  }, [laden]);

  /**
   * Den aktuellen Standort als Ort ablegen. Gibt eine Meldung zurück -
   * leer heisst: hat geklappt.
   */
  const setzeHier = useCallback(
    async (name: string, ortId?: string, radius = 150): Promise<string> => {
      if (!name.trim()) return 'Der Ort braucht einen Namen.';
      let Location: typeof import('expo-location');
      try {
        Location = await import('expo-location');
      } catch {
        return 'Die Ortung fehlt in diesem Build.';
      }
      setLaeuft(true);
      try {
        const erlaubnis = await Location.requestForegroundPermissionsAsync();
        if (erlaubnis.status !== 'granted') {
          return 'Ohne Standort-Erlaubnis geht es nicht.';
        }
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const antwort = await fetch(`${settings.url}/api/presence/places`, {
          method: 'POST',
          headers: kopf(),
          body: JSON.stringify({
            name,
            id: ortId,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            radius,
          }),
        });
        if (!antwort.ok) {
          const body = await antwort.json().catch(() => null);
          return String(body?.detail ?? `Der Hub antwortet mit ${antwort.status}`);
        }
        const daten = (await antwort.json()) as { places?: OrtMitHerkunft[] };
        setOrte(daten.places ?? []);
        return '';
      } catch {
        return 'Der Standort war gerade nicht zu bekommen.';
      } finally {
        setLaeuft(false);
      }
    },
    [settings.url, kopf]
  );

  const entferne = useCallback(
    async (ortId: string): Promise<string> => {
      try {
        const antwort = await fetch(
          `${settings.url}/api/presence/places/${encodeURIComponent(ortId)}`,
          { method: 'DELETE', headers: kopf() }
        );
        if (!antwort.ok) return `Der Hub antwortet mit ${antwort.status}`;
        const daten = (await antwort.json()) as { places?: OrtMitHerkunft[] };
        setOrte(daten.places ?? []);
        return '';
      } catch {
        return 'Der Hub ist gerade nicht erreichbar.';
      }
    },
    [settings.url, kopf]
  );

  return { orte, laeuft, laden, setzeHier, entferne };
}
