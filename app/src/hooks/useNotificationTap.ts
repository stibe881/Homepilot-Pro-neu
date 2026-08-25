import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Was passieren soll, wenn jemand auf eine Push-Nachricht tippt.
 *
 * Bisher öffnete sich nur die App – wer nachts vom Alarm geweckt wird,
 * musste sich dann erst durch die Räume zur richtigen Kamera tippen. Der
 * Hub legt der Nachricht deshalb die Kamera bei: beim Alarm die des
 * betroffenen Raums, bei einer Bewegungsmeldung die Kamera selbst, die sie
 * gesehen hat. Hier wird sie ausgepackt.
 *
 * Dieselbe Mechanik trägt inzwischen mehr als Kameras: Eine
 * Batteriewarnung legt `type: 'battery'` und das betroffene Gerät bei,
 * und die App springt damit auf die Geräteseite mit aufgeklappter
 * Batterienliste – dort steht der Knopf zum Quittieren.
 *
 * Das Standbild in der Nachricht selbst hängt am Hub: Es braucht eine von
 * aussen erreichbare Adresse ohne Anmeldung (`push.public_url`, siehe
 * hub/core/snapshots.py). Ohne sie kommt die Nachricht ohne Bild – der
 * Sprung zur Kamera funktioniert trotzdem.
 */
export interface Tap {
  /** Entitäts-Kennung einer Kamera, die geöffnet werden soll. */
  camera?: string;
  /** Betroffenes Gerät – falls keine Kamera dabei ist. */
  entityId?: string;
  type?: string;
}

/** Die Nutzdaten einer Nachricht auslesen (rein, testbar). */
// Die Antwort kommt aus expo-notifications, das hier bewusst nicht
// importiert wird (lazy, siehe unten) - deshalb offen getippt.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tapFromResponse(response: any): Tap | null {
  const data = response?.notification?.request?.content?.data;
  if (!data || typeof data !== 'object') return null;
  const camera = typeof data.camera === 'string' ? data.camera : undefined;
  const entityId = typeof data.entity_id === 'string' ? data.entity_id : undefined;
  const type = typeof data.type === 'string' ? data.type : undefined;
  if (!camera && !entityId && !type) return null;
  return { camera, entityId, type };
}

export function useNotificationTap(onTap: (tap: Tap) => void) {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;

    // Die App war zu, als die Nachricht ankam: Der Tap, der sie gestartet
    // hat, liegt schon bereit und käme über das Ereignis unten nie an.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (cancelled) return;
        const tap = tapFromResponse(response);
        if (tap) onTap(tap);
      })
      // Ohne letzte Nachricht startet die App schlicht auf der Startseite.
      .catch(() => {});

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const tap = tapFromResponse(response);
        if (tap) onTap(tap);
      }
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [onTap]);
}
