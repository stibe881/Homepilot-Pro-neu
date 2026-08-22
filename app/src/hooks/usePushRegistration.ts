import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { geraeteName, kann } from '../lib/plattform';

import { HubSettings } from '../api/types';

/** Woran die Anmeldung steht – damit ein Fehlschlag sichtbar wird. */
export type PushState =
  | { state: 'idle' }
  | { state: 'web' }
  /** Expo Go auf Android kann seit SDK 53 keine Push-Nachrichten mehr. */
  | { state: 'expoGoAndroid' }
  | { state: 'denied' }
  | { state: 'registered'; label: string }
  | { state: 'failed'; detail: string };

/**
 * Die EAS-Projekt-Kennung. Ohne sie stellt Expo keinen Push-Token aus –
 * `getExpoPushTokenAsync` bricht dann mit «No projectId found» ab.
 */
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

/**
 * Meldet das Gerät beim Hub für Benachrichtigungen an.
 *
 * Läuft im Hintergrund, stört die App nie – meldet aber zurück, warum es
 * nicht geklappt hat. Vorher verschwand jeder Fehler still, und im
 * System-Screen stand bloss «Kein Gerät angemeldet», ohne den Grund.
 */
export function usePushRegistration(
  settings: HubSettings,
  connected: boolean
): PushState {
  const [push, setPush] = useState<PushState>({ state: 'idle' });

  useEffect(() => {
    if (!connected) return;
    if (!kann.push) {
      setPush({ state: 'web' });
      return;
    }
    // Expo Go kann auf Android seit SDK 53 keine Push-Nachrichten mehr
    // entgegennehmen; auf iOS geht es dort weiterhin.
    const inExpoGo =
      Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
    if (Platform.OS === 'android' && inExpoGo) {
      setPush({ state: 'expoGoAndroid' });
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
        if (cancelled) return;
        if (!granted) {
          setPush({ state: 'denied' });
          return;
        }

        const id = projectId();
        const { data: pushToken } = await Notifications.getExpoPushTokenAsync(
          id ? { projectId: id } : undefined
        );
        if (cancelled || !pushToken) return;

        const label = geraeteName();
        const response = await fetch(`${settings.url}/api/push/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
          },
          body: JSON.stringify({ token: pushToken, label }),
        });
        if (cancelled) return;
        if (!response.ok) {
          setPush({ state: 'failed', detail: `Hub antwortet mit ${response.status}` });
          return;
        }
        setPush({ state: 'registered', label });
      } catch (err) {
        // Benachrichtigungen sind eine Zugabe – ein Fehler hier darf die
        // App nicht stören, aber verschwiegen wird er auch nicht mehr.
        if (!cancelled) {
          setPush({ state: 'failed', detail: String(err instanceof Error ? err.message : err) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [settings.url, settings.token, connected]);

  return push;
}

/**
 * Was der System-Screen zur Lage dieses Geräts anzeigt (rein, testbar).
 *
 * Nur über die Anmeldung – ob eine Nachricht ankam, weiss allein der Hub
 * über die Zustell-Quittung. Eine Erfolgsmeldung gehört deshalb bewusst
 * nicht hierher: «verschickt» hiess früher nur «an Expo übergeben».
 */
export function pushHint(push: PushState): string {
  switch (push.state) {
    case 'web':
      return 'Im Browser gibt es keine Push-Nachrichten. Öffne die App auf dem Handy.';
    case 'expoGoAndroid':
      return 'Expo Go kann auf Android seit SDK 53 keine Push-Nachrichten mehr empfangen. Dafür braucht es einen eigenen Build – siehe docs/eigener-app-build.md.';
    case 'denied':
      return 'Die App darf keine Benachrichtigungen zeigen – in den Geräte-Einstellungen erlauben.';
    case 'failed':
      return /projectid/i.test(push.detail)
        ? 'Ohne EAS-Projekt-Kennung stellt Expo keinen Push-Token aus. Einmalig «npx eas init» im App-Ordner ausführen – das trägt sie in die app.json ein – und die App neu starten.'
        : `Anmeldung fehlgeschlagen: ${push.detail}`;
    case 'registered':
      return `Dieses Gerät ist angemeldet (${push.label}). Kommt nichts an, prüfe die Benachrichtigungen in den Geräte-Einstellungen.`;
    default:
      return 'Noch kein Gerät angemeldet – die App meldet sich an, sobald sie mit dem Hub verbunden ist.';
  }
}
