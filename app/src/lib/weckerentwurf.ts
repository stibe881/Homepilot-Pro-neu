/**
 * Was in einem Weckerentwurf steht, bevor jemand ihn ausfüllt.
 *
 * Reines Rechnen, getrennt vom Formular: Welche Quelle vorgeschlagen
 * wird und welche Namen ein Gerät mitbringt, ist entscheidbar - und
 * lässt sich nur prüfen, wenn es für sich steht.
 */
import type { Entity } from '../api/types';

export interface WeckerEntwurf {
  time: string;
  kind: 'station' | 'playlist';
  name: string;
  player: string;
  device: string;
  days: number[];
  volume: number;
}

/** Ein leerer Entwurf, so weit sich das Haus selbst erklärt (rein, testbar). */
export function ersterEntwurf(entities: Entity[]): WeckerEntwurf {
  const radio = entities.find((entity) => entity.commands.includes('play_radio'));
  const spotify = entities.find((entity) => entity.commands.includes('play_playlist'));
  const spieler = radio ?? spotify;
  return {
    time: '07:00',
    // Radio zuerst: Ein Wecker, der von einem fremden Dienst abhängt,
    // schweigt genau dann, wenn dieser Dienst gerade hakt.
    kind: radio ? 'station' : 'playlist',
    name: '',
    player: spieler?.id ?? '',
    device: String(spieler?.state?.device ?? ''),
    days: [0, 1, 2, 3, 4],
    volume: 30,
  };
}

/** Die Namen, die ein Player selbst mitbringt (rein, testbar). */
export function vorschlaege(entity: Entity | undefined, kind: string): string[] {
  const feld = kind === 'station' ? 'stations' : 'playlists';
  const liste = entity?.state?.[feld];
  return Array.isArray(liste) ? liste.map(String) : [];
}
