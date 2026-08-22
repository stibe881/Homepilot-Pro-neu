/**
 * Die Hintergrund-Aufgabe der Ortung.
 *
 * Sie läuft ohne React und ohne offene App: Das Betriebssystem weckt sie,
 * wenn das Telefon eine Zonengrenze überschreitet. Deshalb liest sie
 * Hub-Adresse, Token und die eigene Zone aus dem Speicher – im Moment des
 * Aufwachens gibt es keinen Bildschirm, den man fragen könnte.
 *
 * Bewusst eine eigene Datei: `import` registriert die Aufgabe als
 * Nebenwirkung, und das soll man an genau einer Stelle sehen.
 */

import * as TaskManager from 'expo-task-manager';

import { ORTUNG_TASK, ortungLesen } from '../hooks/useOrtung';

interface Ereignis {
  eventType?: number;
  region?: { identifier?: string };
}

// 1 = betreten, 2 = verlassen (Location.GeofencingEventType). Die Zahlen
// direkt, damit die Aufgabe nicht das ganze Location-Modul lädt, nur um
// zwei Konstanten zu lesen.
const BETRETEN = 1;

TaskManager.defineTask(ORTUNG_TASK, async ({ data, error }) => {
  if (error) return;
  const ereignis = data as Ereignis;
  const ort = String(ereignis?.region?.identifier ?? '');
  if (!ort) return;
  const stand = await ortungLesen();
  // Pausiert heisst pausiert: nichts melden, nicht bloss verstecken.
  if (!stand.aktiv || !stand.url || !stand.token) return;
  if (stand.pausiertBis > Date.now()) return;
  try {
    await fetch(`${stand.url}/api/presence/geofence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${stand.token}`,
      },
      body: JSON.stringify({
        event: ereignis.eventType === BETRETEN ? 'enter' : 'leave',
        place: ort,
        ...(stand.zone ? { zone: stand.zone } : {}),
      }),
    });
  } catch {
    // Kein Netz beim Übertreten der Grenze: Das nächste Ereignis
    // korrigiert es, und der Hub führt Verstummen ohnehin als
    // «unbekannt» statt als «weg».
  }
});
