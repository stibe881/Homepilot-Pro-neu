import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { HubSettings } from '../api/types';

/**
 * Meldet das Gerät beim Hub für Benachrichtigungen an.
 *
 * Läuft still im Hintergrund: Ohne Erlaubnis, im Browser oder im Simulator
 * passiert schlicht nichts – die App bleibt in jedem Fall bedienbar.
 */
export function usePushRegistration(settings: HubSettings, connected: boolean) {
  useEffect(() => {
    if (!connected || Platform.OS === 'web') {
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const existing = await Notifications.getPermissionsAsync();
        let granted = existing.granted;
        if (!granted && existing.canAskAgain) {
          granted = (await Notifications.requestPermissionsAsync()).granted;
        }
        if (!granted || cancelled) return;

        const { data: pushToken } = await Notifications.getExpoPushTokenAsync();
        if (cancelled || !pushToken) return;

        await fetch(`${settings.url}/api/push/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
          },
          body: JSON.stringify({
            token: pushToken,
            label: Platform.OS === 'ios' ? 'iPhone/iPad' : 'Android',
          }),
        });
      } catch {
        // Benachrichtigungen sind eine Zugabe – ein Fehler hier darf die
        // App nicht stören.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [settings.url, settings.token, connected]);
}
