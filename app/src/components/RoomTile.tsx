import { Ionicons } from '@expo/vector-icons';

import { Entity } from '../api/types';
import { timerZeile } from '../lib/fernsehtimer';
import { zustandsText } from '../lib/haushalt';
import { zustandWort } from '../lib/saugerkarte';

/**
 * Ein Gerät in einer Zeile: sein Sinnbild und sein Zustand in einem Wort.
 *
 * Hier stand die Raum-Kachel der Seite «Räume» – eine Liste der Geräte
 * mit Schaltknopf je Zeile. Sie ist der Kachel mit Kopfbild gewichen
 * (components/RoomCard.tsx); übrig bleiben die beiden Übersetzungen, die
 * mit ihr nichts zu tun hatten und anderswo weiterleben: in den kleinen
 * Raumfliesen der Startseite.
 *
 * Der Dateiname bleibt, damit die Verweise darauf nicht wandern müssen.
 */

export const KIND_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  light: 'bulb-outline',
  switch: 'power-outline',
  sensor: 'thermometer-outline',
  binary_sensor: 'radio-button-on-outline',
  button: 'ellipse-outline',
  media_player: 'musical-notes-outline',
  timer: 'moon-outline',
  camera: 'videocam-outline',
  vacuum: 'sparkles-outline',
  appliance: 'cube-outline',
  calendar: 'calendar-outline',
  lock: 'key-outline',
  cover: 'reorder-four-outline',
  weather: 'partly-sunny-outline',
  alert: 'warning-outline',
  scene: 'color-palette-outline',
};

/** Kurzer Zustand für die rechte Spalte – nur für nicht schaltbare Geräte. */
export function shortState(entity: Entity): string {
  const state = entity.state.state;
  switch (entity.kind) {
    case 'cover': {
      const position = entity.state.position;
      if (typeof position === 'number') return `${position}% offen`;
      return state === 'closed' ? 'Zu' : state === 'open' ? 'Offen' : '–';
    }
    case 'sensor':
      return `${state ?? '–'}${entity.state.unit ?? ''}`;
    case 'binary_sensor':
      return state === 'on' ? 'Aktiv' : 'Ruhig';
    case 'button':
      // Was zuletzt gedrückt wurde – ein Taster hat keinen Zustand.
      return state === 'long' ? 'Lang' : state === 'short' ? 'Kurz' : 'Bereit';
    case 'media_player':
      return state === 'playing' ? 'Spielt' : 'Still';
    case 'timer':
      // «Läuft» beantwortet die Frage nicht, die man an einen Timer hat:
      // wie lange noch. Siehe lib/fernsehtimer.
      return timerZeile(entity, Date.now());
    case 'lock':
      return state === 'locked' ? 'Zu' : 'Offen';
    case 'vacuum':
      // Über die gemeinsame Übersetzung: «segment_cleaning» ist auch
      // Reinigen, und ein Bezeichner gehört auf keine Kachel
      // (lib/saugerkarte.ts).
      return zustandWort(state);
    case 'appliance':
      // Nicht «sonst Bereit»: Ein Gerät im Standby oder ohne je gehörte
      // Meldung ist nicht bereit, es schweigt nur.
      return zustandsText(state);
    case 'scene':
      // «Gilt», solange die Lampen so stehen, wie die Szene sie gesetzt
      // hat. Die Bridge meldet es; wer eine Lampe von Hand verstellt,
      // hat die Szene verlassen.
      return state === 'active' ? 'Gilt' : 'Bereit';
    default:
      return String(state ?? '–');
  }
}
