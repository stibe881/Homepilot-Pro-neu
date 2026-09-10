import { useMemo, useState } from 'react';

import { CommandData, Entity } from '../api/types';
import { hatEigeneAuswahl, istMusikbox } from '../lib/geraeteart';
import { gezeigteQuelle, wahlWirkung } from '../lib/musikwahl';

/**
 * Der Zustand hinter dem Player: welche Quelle gezeigt wird und wohin
 * die Musik soll.
 *
 * Dieselbe Karte steht an drei Stellen (Startseite, Blatt über der
 * Raumkachel, Raumkopf), und sie soll überall dieselben Boxen
 * anbieten und sich beim Umziehen gleich verhalten. Was gerechnet wird,
 * steht in lib/musikwahl.ts; hier liegt nur, was sich merken muss.
 *
 * `schluessel` ist der Ort, für den gewählt wurde. Wechselt er - man
 * geht ein Zimmer weiter -, gilt wieder die Vorwahl: Sonst zeigte die
 * Küche die Box, die man im Wohnzimmer angetippt hat.
 */
export interface Musikwahl {
  /** Alle Boxen und Quellen des Hauses - dieselbe Liste überall. */
  players: Entity[];
  /** Was die Karte gerade zeigt. */
  player: Entity | undefined;
  /** Box, auf der die gezeigte Quelle spielt - nur bei Spotify/Radio. */
  activeDevice: string | null;
  /** Zuletzt gewählte Box; sie reist bis zum Startbefehl mit. */
  wunschBox: string | null;
  /** Ein Tipp im Wähler. */
  waehlen: (ziel: Entity) => void;
}

interface Stand {
  schluessel: string;
  id: string | null;
  wunsch: string | null;
}

export function useMusikwahl(
  entities: Entity[],
  onCommand: (entityId: string, command: string, data?: CommandData) => void,
  vorwahl?: Entity | null,
  schluessel = ''
): Musikwahl {
  const [stand, setStand] = useState<Stand>({ schluessel, id: null, wunsch: null });
  // Kein Effekt fürs Zurücksetzen: Der Schlüssel steht im Zustand mit
  // drin, und was zu einem anderen Ort gehört, zählt einfach nicht.
  // Ein Effekt hätte einen Bildaufbau lang die Box des vorigen Zimmers
  // gezeigt.
  const gilt = stand.schluessel === schluessel ? stand : { id: null, wunsch: null };

  const players = useMemo(() => entities.filter(istMusikbox), [entities]);
  const player = gezeigteQuelle(players, gilt.id, vorwahl, entities);

  const waehlen = (ziel: Entity) => {
    const wirkung = wahlWirkung(player, ziel);
    const wunsch = wirkung.wunsch ?? gilt.wunsch;
    if (wirkung.art === 'umzug') {
      onCommand(wirkung.quelle, 'play_on', {
        device: wirkung.device,
        play: wirkung.play,
      });
      setStand({ schluessel, id: wirkung.quelle, wunsch });
    } else {
      setStand({ schluessel, id: wirkung.zeigt, wunsch });
    }
  };

  return {
    players,
    player,
    // Die Box der *gezeigten* Quelle, nicht immer die von Spotify:
    // Sonst stünde auf der Radio-Karte, wo Spotify spielt.
    activeDevice:
      player && hatEigeneAuswahl(player) ? ((player.state.device as string) ?? null) : null,
    wunschBox: gilt.wunsch,
    waehlen,
  };
}
