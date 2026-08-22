import React, { createContext, useContext, useMemo } from 'react';

import { Entity, HubSettings, User } from '../api/types';

/**
 * Zugangsdaten und Gerätebestand für alle, per Context statt Schleppe.
 *
 * `settings` und `entities` wanderten bisher als Props durch jede Ebene –
 * DashboardScreen → Screen → Karte → Zeile –, auch durch Komponenten, die
 * beides nur weiterreichen. Jede neue Zwischenebene musste die Schleppe
 * mittragen, und jede Signatur wurde um zwei Standard-Props länger.
 *
 * Der Provider liegt einmal um den Dashboard-Inhalt; wer die Daten
 * braucht, holt sie mit `useHubKontext()` (oder gezielt `useSettings()` /
 * `useEntities()`) dort ab, wo er sie verwendet.
 *
 * Bestehende Props verschwinden nicht auf einen Schlag – neue Komponenten
 * greifen zum Context, bestehende ziehen nach, wenn man sie ohnehin
 * anfasst (Punkt 61 der Werkbank).
 */

interface HubKontext {
  settings: HubSettings;
  entities: Entity[];
  user: User | null;
}

const Kontext = createContext<HubKontext | null>(null);

export function HubProvider({
  settings,
  entities,
  user,
  children,
}: HubKontext & { children: React.ReactNode }) {
  // Ein stabiles Objekt, damit nicht jede Elternzeichnung alle Verbraucher
  // neu zeichnet, obwohl sich nichts geändert hat.
  const wert = useMemo(() => ({ settings, entities, user }), [settings, entities, user]);
  return <Kontext.Provider value={wert}>{children}</Kontext.Provider>;
}

export function useHubKontext(): HubKontext {
  const wert = useContext(Kontext);
  if (!wert) {
    // Laut statt leise: Ein Verbraucher ausserhalb des Providers bekäme
    // sonst undefined-Zugangsdaten und scheiterte erst beim ersten Abruf.
    throw new Error('useHubKontext braucht einen <HubProvider> darüber.');
  }
  return wert;
}

export function useSettings(): HubSettings {
  return useHubKontext().settings;
}

export function useEntities(): Entity[] {
  return useHubKontext().entities;
}
