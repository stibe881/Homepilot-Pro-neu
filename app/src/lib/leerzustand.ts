/**
 * Was eine leere Ansicht sagt – und was man als Erstes tun kann.
 *
 * Eine leere Fläche beantwortet die falsche Frage. Wer zum ersten Mal
 * auf «Storen» tippt und nichts sieht, fragt nicht «wo sind die
 * Kacheln?», sondern «was muss ich tun, damit hier etwas steht?». Die
 * Antwort gehört genau dorthin – als ein Satz und, wo es einen gibt,
 * als erster Knopf.
 *
 * Die Sätze nennen die Integrationen, die es im Haus wirklich braucht
 * (Hue, Zigbee, Somfy …), nicht ein allgemeines «Geräte hinzufügen»:
 * Der Weg führt hier immer über die config.yaml des Hubs, und das darf
 * ruhig dastehen.
 */

import type { Section } from '../components/Rail';

export interface Leerbild {
  icon: string;
  titel: string;
  satz: string;
  /** Beschriftung des ersten Schritts – ohne sie gibt es keinen Knopf. */
  aktion?: string;
}

/** Was die leere Ansicht zeigt (rein, testbar). */
export function leerbild(
  section: Section,
  room: string | null,
  connected: boolean
): Leerbild {
  if (!connected) {
    return {
      icon: 'cloud-offline-outline',
      titel: 'Warte auf den Hub',
      satz: 'Sobald die Verbindung steht, erscheinen hier die Geräte.',
    };
  }
  if (section === 'light') {
    return {
      icon: 'bulb-outline',
      titel: 'Noch kein Licht angebunden',
      satz: 'Lampen kommen über eine Integration in der config.yaml des Hubs – z.B. hue, zigbee2mqtt oder tuya.',
    };
  }
  if (section === 'covers') {
    return {
      icon: 'reorder-four-outline',
      titel: 'Noch keine Storen angebunden',
      satz: 'Storen kommen über eine Integration in der config.yaml des Hubs – z.B. overkiz (Somfy) oder homematic.',
    };
  }
  if (section === 'cameras') {
    return {
      icon: 'videocam-outline',
      titel: 'Noch keine Kamera angebunden',
      satz: 'Kameras kommen über eine Integration in der config.yaml des Hubs – z.B. ring oder unifi_protect.',
    };
  }
  if (room) {
    return {
      icon: 'grid-outline',
      titel: `${room} ist noch leer`,
      satz: 'Geräte bekommen ihren Raum unter «Geräte» – oder gleich hier.',
      aktion: 'Geräte zuordnen',
    };
  }
  return {
    icon: 'grid-outline',
    titel: 'Noch keine Geräte',
    satz: 'Der Hub kennt noch nichts – Integrationen werden in seiner config.yaml aktiviert.',
  };
}
