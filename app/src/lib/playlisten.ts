/**
 * Eigene Reihenfolge und ausgeblendete Playlists – je Musikkarte.
 *
 * Lag im Speicher des Telefons und war damit nach jedem neuen Build weg:
 * Man sortiert seine acht Playlists einmal, und nach dem nächsten Update
 * stehen sie wieder so da, wie Spotify sie ausliefert. Jetzt liegt es
 * beim Hub, bei der Person (lib/persoenlich.ts) – jeder darf seine eigene
 * Reihenfolge haben, und sie überlebt das Gerät.
 *
 * Hier steht nur das Rechnen damit; das Holen und Ablegen macht die
 * Karte.
 */

/** Was zu einer Box gemerkt ist. */
export interface Playlistwahl {
  order: string[];
  hidden: string[];
}

/** Alles, je Kennung der Musikkarte. */
export type Playlistbuch = Record<string, Playlistwahl>;

export const LEER: Playlistwahl = { order: [], hidden: [] };

/**
 * Den Eintrag einer Karte herausholen – auch aus dem, was ein älterer
 * Stand hinterlassen hat (rein, testbar).
 */
export function wahlFuer(buch: unknown, entityId: string): Playlistwahl {
  if (!buch || typeof buch !== 'object') return LEER;
  const eintrag = (buch as Record<string, unknown>)[entityId];
  if (!eintrag || typeof eintrag !== 'object') return LEER;
  const roh = eintrag as { order?: unknown; hidden?: unknown };
  return {
    order: Array.isArray(roh.order) ? roh.order.filter((x) => typeof x === 'string') : [],
    hidden: Array.isArray(roh.hidden) ? roh.hidden.filter((x) => typeof x === 'string') : [],
  };
}

/**
 * Den Eintrag einer Karte setzen (rein, testbar).
 *
 * Eine Karte ohne eigene Reihenfolge und ohne ausgeblendete Playlist
 * verschwindet aus dem Buch: Ein leerer Eintrag je Lautsprecher, den es
 * einmal gab, wäre Ballast in den Einstellungen jeder Person.
 */
export function wahlSetzen(
  buch: Playlistbuch,
  entityId: string,
  wahl: Playlistwahl
): Playlistbuch {
  const naechstes = { ...buch };
  if (wahl.order.length === 0 && wahl.hidden.length === 0) delete naechstes[entityId];
  else naechstes[entityId] = wahl;
  return naechstes;
}
