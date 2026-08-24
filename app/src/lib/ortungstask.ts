/**
 * Die Hintergrund-Aufgaben der Ortung.
 *
 * Sie laufen ohne React und ohne offene App: Das Betriebssystem weckt
 * sie. Deshalb lesen sie Hub-Adresse, Token und die eigene Zone aus dem
 * Speicher – im Moment des Aufwachens gibt es keinen Bildschirm, den man
 * fragen könnte.
 *
 * Es sind zwei, und beide werden gebraucht:
 *
 *  - **`ORTUNG_TASK`** – die Zonenüberwachung. Sie meldet den Übertritt
 *    scharf und sofort und kostet fast nichts, weil sie das
 *    Betriebssystem selbst führt.
 *  - **`STANDORT_TASK`** – die laufende Aktualisierung. Sie meldet, wenn
 *    sich das Telefon bewegt hat. *Auf Bewegung, nicht auf Uhr*: Wer
 *    stillsteht, erzeugt nichts, und die Ortung kostet dann auch nichts.
 *
 * Warum nicht die Zonenüberwachung allein, wie bis Fassung 0.6: Sie
 * meldet Flanken, und eine Flanke, die nicht ankommt, ist für immer weg.
 * Genau das passierte beim Heimkommen – die Grenze wird gekreuzt, während
 * das Telefon noch am Mobilfunk hängt und das WLAN erst gleich kommt.
 * Danach stand man bis zum nächsten Weggehen auf «unterwegs».
 *
 * Beide melden dasselbe: die Position. Was der Hub daraus macht, rechnet
 * er selbst – so heilt jede Meldung, was von einer früheren fehlt.
 *
 * Bewusst eine eigene Datei: `import` registriert die Aufgaben als
 * Nebenwirkung, und das soll man an genau einer Stelle sehen.
 */

import * as TaskManager from 'expo-task-manager';

import { ORTUNG_TASK, STANDORT_TASK, ortungLesen } from '../hooks/useOrtung';
import { Standortmeldung, positionMelden } from './ortungspuffer';

interface Zonenereignis {
  eventType?: number;
  region?: { identifier?: string };
}

interface Standortereignis {
  locations?: {
    coords?: { latitude?: number; longitude?: number; accuracy?: number | null };
    timestamp?: number;
  }[];
}

/** Darf gerade gemeldet werden? Sonst gibt es kein Ziel. */
async function ziel() {
  const stand = await ortungLesen();
  // Pausiert heisst pausiert: nichts melden, nicht bloss verstecken.
  if (!stand.aktiv || !stand.url || !stand.token) return null;
  if (stand.pausiertBis > Date.now()) return null;
  return { url: stand.url, token: stand.token, zone: stand.zone };
}

/**
 * Wo das Telefon jetzt ist – für die Zonenüberwachung.
 *
 * Sie meldet nur, *welche* Grenze gekreuzt wurde, nicht wohin. Statt
 * daraus eine Flanke zu bauen, wird einmal gemessen: Dann geht auch von
 * hier eine vollständige Aussage hinaus, und die zwei Wege können sich
 * nicht widersprechen.
 */
async function jetzigePosition(): Promise<Standortmeldung | null> {
  try {
    const Location = await import('expo-location');
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: Number(position.coords.accuracy) || 0,
      at: Math.round((position.timestamp || Date.now()) / 1000),
    };
  } catch {
    return null;
  }
}

TaskManager.defineTask(ORTUNG_TASK, async ({ data, error }) => {
  if (error) return;
  const ereignis = data as Zonenereignis;
  if (!String(ereignis?.region?.identifier ?? '')) return;
  const wohin = await ziel();
  if (!wohin) return;
  const position = await jetzigePosition();
  if (!position) return;
  // Kein Netz beim Übertreten der Grenze? Dann liegt die Meldung im
  // Puffer und geht beim nächsten Anlass hinaus. Genau daran scheiterte
  // die Ankunft bisher.
  await positionMelden(wohin, position);
});

TaskManager.defineTask(STANDORT_TASK, async ({ data, error }) => {
  if (error) return;
  const ereignis = data as Standortereignis;
  // Das Betriebssystem liefert die Punkte gebündelt, sobald es die App
  // weckt. Nur der jüngste sagt etwas darüber, wo jemand *ist*.
  const punkte = ereignis?.locations ?? [];
  const letzter = punkte[punkte.length - 1];
  if (!letzter?.coords) return;
  const wohin = await ziel();
  if (!wohin) return;
  await positionMelden(wohin, {
    latitude: Number(letzter.coords.latitude),
    longitude: Number(letzter.coords.longitude),
    accuracy: Number(letzter.coords.accuracy) || 0,
    at: Math.round((letzter.timestamp || Date.now()) / 1000),
  });
});
