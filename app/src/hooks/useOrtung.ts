/**
 * Die App meldet selbst, wann jemand kommt (Punkt 194 der Werkbank).
 *
 * Bisher meldete nicht die App den Ortswechsel, sondern ein
 * iOS-Kurzbefehl, den jede Person einmal von Hand baut – und der still
 * stirbt, wenn jemand ein neues Telefon einrichtet. Die App wusste vom
 * Standort gar nichts.
 *
 * Ehrlich zu den Kosten, und darum genau so gebaut:
 *
 *  - **Region Monitoring, kein laufendes GPS.** Das Betriebssystem weckt
 *    die App beim Übertreten einer Grenze; dazwischen misst niemand.
 *    Alles andere hiesse: Akku am Nachmittag leer, Ortung abgeschaltet
 *    statt genutzt.
 *  - **Die Zonen kommen vom Hub** (/api/presence/zones). Damit ändert man
 *    eine Adresse einmal statt auf jedem Telefon.
 *  - **Nichts läuft ungefragt.** Ohne den Schalter in den Einstellungen
 *    wird keine Berechtigung verlangt, und Gäste werden nie geortet.
 *  - **Pausieren ist Pausieren.** Wer die Ortung aussetzt, meldet nichts –
 *    nicht: meldet und versteckt es.
 *
 * Auf Web und im Expo-Go-Client gibt es das nicht; dort bleibt alles beim
 * Kurzbefehl, und der Hook meldet «nicht verfügbar» statt zu scheitern.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { HubSettings } from '../api/types';
import {
  Ort as Ortsangabe,
  genauGenug,
  meldungsText,
  ortsMeldungen,
} from '../lib/ortungsmeldung';

/** Name der Hintergrund-Aufgabe. Muss über App-Starts hinweg gleich bleiben. */
export const ORTUNG_TASK = 'homepilot-geofence';
/** Wo Schalter, Pause und die Zugangsdaten für die Aufgabe liegen. */
export const ORTUNG_KEY = 'homepilot.ortung';

export interface OrtungStand {
  /** Vom Benutzer eingeschaltet. */
  aktiv: boolean;
  /** Pausiert bis zu diesem Zeitpunkt (ms), 0 = läuft. */
  pausiertBis: number;
  /** Wie viele Orte überwacht werden. */
  orte: number;
  /** Warum es gerade nicht läuft – für die Zeile im Profil. */
  hinweis: string;
  /** Was die letzte Standortmeldung ergeben hat («Gemeldet: Zuhause.»). */
  gemeldet: string;
}

export interface Ort {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
}

const AUS: OrtungStand = {
  aktiv: false,
  pausiertBis: 0,
  orte: 0,
  hinweis: '',
  gemeldet: '',
};

/** Gibt es die nativen Module? Im Browser und in Expo Go nicht. */
export function ortungMoeglich(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/**
 * Der gespeicherte Stand – auch für die Hintergrund-Aufgabe lesbar.
 *
 * Die Aufgabe läuft ohne React: Sie braucht Hub-Adresse, Token und die
 * eigene Zone aus dem Speicher, sonst wüsste sie beim Aufwachen nicht,
 * wohin sie melden soll.
 */
export async function ortungLesen(): Promise<{
  aktiv: boolean;
  pausiertBis: number;
  url: string;
  token: string;
  zone: string;
}> {
  try {
    const roh = await AsyncStorage.getItem(ORTUNG_KEY);
    const stand = roh ? JSON.parse(roh) : {};
    return {
      aktiv: !!stand.aktiv,
      pausiertBis: Number(stand.pausiertBis) || 0,
      url: String(stand.url ?? ''),
      token: String(stand.token ?? ''),
      zone: String(stand.zone ?? ''),
    };
  } catch {
    return { aktiv: false, pausiertBis: 0, url: '', token: '', zone: '' };
  }
}

/**
 * Steuert die Zonenüberwachung dieses Geräts.
 *
 * `zone` ist die Kennung der eigenen Person im Hub (geofence.<zone>);
 * ohne sie wüsste der Hub nicht, wer da kommt.
 */
export function useOrtung(settings: HubSettings, zone: string, erlaubt: boolean) {
  const [stand, setStand] = useState<OrtungStand>(AUS);

  const speichern = useCallback(
    async (aktiv: boolean, pausiertBis: number) => {
      await AsyncStorage.setItem(
        ORTUNG_KEY,
        JSON.stringify({
          aktiv,
          pausiertBis,
          url: settings.url,
          token: settings.token,
          zone,
        })
      ).catch(() => {});
    },
    [settings.url, settings.token, zone]
  );

  // Beim Start den gespeicherten Stand übernehmen.
  useEffect(() => {
    ortungLesen().then((gespeichert) =>
      setStand((vorher) => ({
        ...vorher,
        aktiv: gespeichert.aktiv,
        pausiertBis: gespeichert.pausiertBis,
      }))
    );
  }, []);

  /** Die Orte vom Hub - eine Adresse ändert man einmal, nicht je Telefon. */
  const orteHolen = useCallback(async (): Promise<Ort[]> => {
    let antwort: Response;
    try {
      antwort = await fetch(`${settings.url}/api/presence/zones`, {
        headers: { Authorization: `Bearer ${settings.token}` },
      });
    } catch {
      throw new Error('Der Hub ist gerade nicht erreichbar.');
    }
    if (!antwort.ok) throw new Error('Der Hub kennt keine Orte (geofence einrichten).');
    const orte = ((await antwort.json()) as { places?: Ort[] }).places ?? [];
    if (orte.length === 0) throw new Error('Der Hub kennt keine Orte mit Koordinaten.');
    return orte;
  }, [settings.url, settings.token]);

  /**
   * Einmal sagen, wo das Telefon gerade ist.
   *
   * Die Zonenüberwachung meldet nur Übertritte. Wer die Ortung im
   * eigenen Wohnzimmer einschaltet, kreuzt keine Grenze - der Hub führte
   * ihn weiter als «unterwegs», bis er einmal weggeht und wiederkommt.
   * Darum beim Einschalten von selbst und daneben als Knopf.
   *
   * Gibt den Satz zurück, der danach in den Einstellungen steht.
   */
  const melden = useCallback(async (): Promise<string> => {
    if (!ortungMoeglich()) return 'Auf diesem Gerät nicht verfügbar.';
    if (!erlaubt) return 'Für Gäste ist die Ortung aus.';
    let Location: typeof import('expo-location');
    try {
      Location = await import('expo-location');
    } catch {
      return 'Die Ortung fehlt in diesem Build.';
    }
    const vorne = await Location.requestForegroundPermissionsAsync();
    if (!vorne.granted) return 'Ohne Standort-Erlaubnis geht es nicht.';
    let orte: Ort[];
    try {
      orte = await orteHolen();
    } catch (err) {
      return String((err as Error).message);
    }
    let position;
    try {
      position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
    } catch {
      return 'Der Standort war gerade nicht zu bekommen.';
    }
    const { latitude, longitude, accuracy } = position.coords;
    if (!genauGenug(orte as Ortsangabe[], accuracy)) {
      return 'Der Standort ist gerade zu ungenau - draussen oder am Fenster nochmal.';
    }
    const meldungen = ortsMeldungen(orte as Ortsangabe[], latitude, longitude);
    for (const meldung of meldungen) {
      // Nacheinander: Der Hub führt je Zone eine Liste der Orte, in denen
      // sie steckt, und zwei gleichzeitige Meldungen überschrieben sich.
      const antwort = await fetch(`${settings.url}/api/presence/geofence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.token}`,
        },
        body: JSON.stringify({
          event: meldung.event,
          place: meldung.place,
          ...(zone ? { zone } : {}),
        }),
      }).catch(() => null);
      if (!antwort || !antwort.ok) {
        return antwort?.status === 404
          ? `Der Hub kennt keine Zone «${zone}» - unter Abläufe → geofence anlegen.`
          : 'Der Hub hat die Meldung nicht angenommen.';
      }
    }
    return meldungsText(orte as Ortsangabe[], meldungen, latitude, longitude);
  }, [settings.url, settings.token, zone, erlaubt, orteHolen]);

  /** Die Überwachung wirklich starten oder beenden. */
  const anwenden = useCallback(
    async (aktiv: boolean, pausiertBis: number): Promise<string> => {
      if (!ortungMoeglich()) return 'Auf diesem Gerät nicht verfügbar.';
      if (!erlaubt) return 'Für Gäste ist die Ortung aus.';
      let Location: typeof import('expo-location');
      try {
        Location = await import('expo-location');
        // Die Aufgabe muss registriert sein, bevor sie startet.
        await import('../lib/ortungstask');
      } catch {
        return 'Die Ortung fehlt in diesem Build.';
      }
      const laeuft = aktiv && pausiertBis < Date.now();
      if (!laeuft) {
        await Location.stopGeofencingAsync(ORTUNG_TASK).catch(() => {});
        return '';
      }
      const vorne = await Location.requestForegroundPermissionsAsync();
      if (!vorne.granted) return 'Ohne Standort-Erlaubnis geht es nicht.';
      const hinten = await Location.requestBackgroundPermissionsAsync();
      if (!hinten.granted) {
        return 'Dafür braucht es «Standort: immer» – sonst meldet das Telefon nur, während die App offen ist.';
      }
      let orte: Ort[] = [];
      try {
        orte = await orteHolen();
      } catch (err) {
        return String((err as Error).message);
      }
      await Location.startGeofencingAsync(
        ORTUNG_TASK,
        orte.map((ort) => ({
          identifier: ort.id,
          latitude: ort.latitude,
          longitude: ort.longitude,
          radius: ort.radius,
          notifyOnEnter: true,
          notifyOnExit: true,
        }))
      );
      setStand((vorher) => ({ ...vorher, orte: orte.length }));
      // Und gleich sagen, wo wir jetzt sind: Sonst steht der Hub bis zum
      // nächsten Übertritt auf dem alten Stand - beim Einschalten im
      // eigenen Wohnzimmer also auf «unterwegs».
      melden().then(
        (satz) => setStand((vorher) => ({ ...vorher, gemeldet: satz })),
        () => {}
      );
      return '';
    },
    // settings kommt über orteHolen/melden herein - hier stünde es doppelt.
    [erlaubt, melden, orteHolen]
  );

  const schalten = useCallback(
    async (aktiv: boolean) => {
      const hinweis = await anwenden(aktiv, 0);
      await speichern(aktiv && !hinweis, 0);
      setStand((vorher) => ({
        ...vorher,
        aktiv: aktiv && !hinweis,
        pausiertBis: 0,
        hinweis,
      }));
    },
    [anwenden, speichern]
  );

  const pausieren = useCallback(
    async (bis: Date) => {
      const zeit = bis.getTime();
      await anwenden(stand.aktiv, zeit);
      await speichern(stand.aktiv, zeit);
      setStand((vorher) => ({ ...vorher, pausiertBis: zeit }));
    },
    [anwenden, speichern, stand.aktiv]
  );

  const weiter = useCallback(async () => {
    const hinweis = await anwenden(stand.aktiv, 0);
    await speichern(stand.aktiv, 0);
    setStand((vorher) => ({ ...vorher, pausiertBis: 0, hinweis }));
  }, [anwenden, speichern, stand.aktiv]);

  /** Für den Knopf «Jetzt melden» in den Einstellungen. */
  const jetztMelden = useCallback(async () => {
    setStand((vorher) => ({ ...vorher, gemeldet: 'Einen Moment …' }));
    const satz = await melden();
    setStand((vorher) => ({ ...vorher, gemeldet: satz }));
  }, [melden]);

  /**
   * Den Hausstandort von hier übernehmen.
   *
   * Der stille Einrichtungsfehler, den man sonst nie findet: Steht der
   * Hauskreis auf einer Vorgabe aus dem Quelltext oder auf einem
   * vertippten Wert, ist man dauerhaft «unterwegs», während man in der
   * Stube sitzt - und nichts sieht kaputt aus. Wer zuhause steht,
   * drückt hier einen Knopf; vertippen ist ausgeschlossen.
   */
  const hierIstZuhause = useCallback(async (): Promise<string> => {
    if (!ortungMoeglich()) return 'Auf diesem Gerät nicht verfügbar.';
    let Location: typeof import('expo-location');
    try {
      Location = await import('expo-location');
    } catch {
      return 'Die Ortung fehlt in diesem Build.';
    }
    const vorne = await Location.requestForegroundPermissionsAsync();
    if (!vorne.granted) return 'Ohne Standort-Erlaubnis geht es nicht.';
    let position;
    try {
      position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
    } catch {
      return 'Der Standort war gerade nicht zu bekommen.';
    }
    const { latitude, longitude, accuracy } = position.coords;
    // Hier zählt Genauigkeit doppelt: Ein Hausstandort, der um 200 m
    // danebenliegt, ist derselbe Fehler in Grün.
    if (typeof accuracy === 'number' && accuracy > 100) {
      return `Der Standort ist auf ${Math.round(accuracy)} m genau – das ist für ein Zuhause zu grob. Draussen oder am Fenster nochmal.`;
    }
    const antwort = await fetch(`${settings.url}/api/presence/home`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.token}`,
      },
      body: JSON.stringify({ latitude, longitude }),
    }).catch(() => null);
    if (!antwort || !antwort.ok) {
      return antwort?.status === 403
        ? 'Dafür fehlt die Berechtigung – das darf nur, wer die Konfiguration ändern darf.'
        : 'Der Hub hat den Standort nicht angenommen.';
    }
    // Gleich melden: Sonst steht «unterwegs» weiter da, obwohl der
    // Kreis jetzt stimmt.
    return await melden();
  }, [melden, settings.url, settings.token]);

  const zuhauseSetzen = useCallback(async () => {
    setStand((vorher) => ({ ...vorher, gemeldet: 'Einen Moment …' }));
    const satz = await hierIstZuhause();
    setStand((vorher) => ({ ...vorher, gemeldet: satz }));
  }, [hierIstZuhause]);

  return {
    stand,
    schalten,
    pausieren,
    weiter,
    jetztMelden,
    zuhauseSetzen,
    moeglich: ortungMoeglich(),
  };
}
