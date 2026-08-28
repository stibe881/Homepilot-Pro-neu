import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { Entity, HubSettings } from '../api/types';
import { watchKontext } from '../lib/watchkontext';

/**
 * Der Apple Watch die Zugangsdaten hinüberreichen.
 *
 * Die Watch-App (targets/watch/) redet selbst mit dem Hub; was ihr
 * fehlt, sind Adresse, Token und die Haustüre. Das schickt dieser Haken
 * als Anwendungs-Kontext (WatchConnectivity) - beim Verbinden und immer
 * dann, wenn sich daran etwas ändert. Der Kontext überlebt drüben auch
 * den Neustart der Uhr: WatchConnectivity liefert den letzten Stand
 * nach, die Uhr legt ihn zusätzlich in ihre UserDefaults.
 *
 * Wie beim Sperrbildschirm (useLiveAktivitaet) doppelt abgesichert: Das
 * native Modul gibt es nur in einem Build, der es enthält - nicht in
 * Expo Go, nicht auf Android, nicht im Web. Fehlt es, tut der Haken
 * nichts, und die App läuft unverändert.
 */
export function useWatchSync(
  settings: HubSettings,
  entities: Entity[],
  connected: boolean
): void {
  // Nur schicken, was sich geändert hat: updateApplicationContext weckt
  // sonst bei jedem Zustands-Update irgendeines Geräts die Uhr.
  const zuletzt = useRef<string>('');
  const kontext = connected ? watchKontext(settings, entities) : null;
  const serialisiert = kontext ? JSON.stringify(kontext) : '';

  useEffect(() => {
    if (!serialisiert || Platform.OS !== 'ios') return;
    if (serialisiert === zuletzt.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let modul: any;
    try {
      // Erst zur Laufzeit laden: In Builds ohne das Modul würde ein
      // Import oben den Start zerlegen.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { requireNativeModule } = require('expo-modules-core');
      modul = requireNativeModule('WatchVerbindung');
    } catch {
      return;
    }
    zuletzt.current = serialisiert;
    // Still: Keine gekoppelte Uhr ist der Normalfall, kein Fehler.
    modul.senden(JSON.parse(serialisiert)).catch(() => {});
  }, [serialisiert]);
}
