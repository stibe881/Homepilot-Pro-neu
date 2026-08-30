import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { knopfHandlung } from '../lib/mitteilungsknoepfe';

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
  /** Wohin der Tipp führt: 'raum:Küche', 'familie:shopping', 'bereich:system' …
   *  Der neue, allgemeine Weg - siehe lib/pushziel.ts. */
  ziel?: string;
  /** Entitäts-Kennung einer Kamera, die geöffnet werden soll. */
  camera?: string;
  /** Betroffenes Gerät – falls keine Kamera dabei ist. */
  entityId?: string;
  type?: string;
  /** Handgriffe, die ein Ablauf seiner Nachricht mitgegeben hat -
   *  «Trockner an» unter «Waschmaschine fertig» (lib/pushziel.ts). */
  knoepfe?: unknown;
  /** Titel und Text der Nachricht - das Blatt mit den Knöpfen soll
   *  zeigen, worauf man da eigentlich getippt hat. */
  title?: string;
  body?: string;
}

/** Ein Griff aus der Mitteilung heraus – samt dem, was drinstand. */
export interface Knopfdruck {
  handlung: 'spaeter' | 'erledigt' | 'ichmachs';
  title: string;
  body: string;
  category?: string;
  entityId?: string;
}

/** Was jemand in der Mitteilung gedrückt hat (rein, testbar).
 *
 *  `null` heisst: kein Knopf, sondern das gewöhnliche Antippen - dafür
 *  ist `tapFromResponse` zuständig. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function knopfAusResponse(response: any): Knopfdruck | null {
  const handlung = knopfHandlung(response?.actionIdentifier);
  if (!handlung) return null;
  const inhalt = response?.notification?.request?.content;
  const titel = typeof inhalt?.title === 'string' ? inhalt.title : '';
  if (!titel) return null;
  const daten = inhalt?.data && typeof inhalt.data === 'object' ? inhalt.data : {};
  return {
    handlung,
    title: titel,
    body: typeof inhalt?.body === 'string' ? inhalt.body : '',
    category: typeof daten.category === 'string' ? daten.category : undefined,
    entityId: typeof daten.entity_id === 'string' ? daten.entity_id : undefined,
  };
}

/** Die Nutzdaten einer Nachricht auslesen (rein, testbar). */
// Die Antwort kommt aus expo-notifications, das hier bewusst nicht
// importiert wird (lazy, siehe unten) - deshalb offen getippt.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tapFromResponse(response: any): Tap | null {
  const data = response?.notification?.request?.content?.data;
  if (!data || typeof data !== 'object') return null;
  const ziel = typeof data.ziel === 'string' ? data.ziel : undefined;
  const camera = typeof data.camera === 'string' ? data.camera : undefined;
  const entityId = typeof data.entity_id === 'string' ? data.entity_id : undefined;
  const type = typeof data.type === 'string' ? data.type : undefined;
  const knoepfe = Array.isArray(data.knoepfe) ? data.knoepfe : undefined;
  if (!ziel && !camera && !entityId && !type && !knoepfe) return null;
  const inhalt = response?.notification?.request?.content;
  return {
    ziel,
    camera,
    entityId,
    type,
    knoepfe,
    title: typeof inhalt?.title === 'string' ? inhalt.title : undefined,
    body: typeof inhalt?.body === 'string' ? inhalt.body : undefined,
  };
}

export function useNotificationTap(
  onTap: (tap: Tap) => void,
  /** Ein Knopf aus der Mitteilung – «Später» oder «Erledigt». */
  onKnopf?: (druck: Knopfdruck) => void
) {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;

    // Die App war zu, als die Nachricht ankam: Der Tap, der sie gestartet
    // hat, liegt schon bereit und käme über das Ereignis unten nie an.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (cancelled) return;
        const druck = knopfAusResponse(response);
        if (druck) {
          onKnopf?.(druck);
          return;
        }
        const tap = tapFromResponse(response);
        if (tap) onTap(tap);
      })
      // Ohne letzte Nachricht startet die App schlicht auf der Startseite.
      .catch(() => {});

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        // Zuerst die Knöpfe: Wer «Später» drückt, will nicht auch noch
        // die App auf der Kameraseite offen finden.
        const druck = knopfAusResponse(response);
        if (druck) {
          onKnopf?.(druck);
          return;
        }
        const tap = tapFromResponse(response);
        if (tap) onTap(tap);
      }
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [onTap, onKnopf]);
}
