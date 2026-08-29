/**
 * Was in der Spalte rechts steht – und was nur auf der Startseite.
 *
 * Die Spalte trug bisher überall dasselbe: Wetter, die Musik des Hauses,
 * die Musik des offenen Raums, eine Wetterwarnung. Im Zimmer ist das die
 * falsche Hälfte. Wer «Küche» öffnet, will die Küche sehen – und bekam
 * daneben das Wetter von Zell und die Box, die im Wohnzimmer spielt.
 * Beides beantwortet keine Frage, die man im Zimmer stellt, und auf dem
 * Telefon schob es die Lampen unter den Bildschirmrand.
 *
 * Was bleibt: die Box **dieses** Raums und die Wetterwarnung. Die Warnung
 * ist der Grund, aus dem es sie gibt – sie wegzuräumen, weil man gerade
 * in einem Zimmer steht, hiesse sie genau dann zu verstecken, wenn man
 * hinschaut.
 *
 * Reines Rechnen, damit «wann steht die Spalte leer da» prüfbar bleibt:
 * Eine Spalte, die ihre 340 Punkte für nichts beansprucht, hatte die
 * Startseite schon einmal (siehe CLAUDE.md).
 */

export interface Spaltenwunsch {
  /** Steht ein Zimmer offen? Auf der Startseite und den Geräteseiten nicht. */
  inRoom: boolean;
  /** Gibt es überhaupt ein Wettergerät? */
  weather: boolean;
  /** Gibt es eine bedienbare Box fürs Haus? */
  housePlayer: boolean;
  /** Gibt es eine eigene Box in diesem Raum? */
  roomPlayer: boolean;
  /** Liegt gerade eine Wetterwarnung vor? */
  alert: boolean;
}

export interface Spalteninhalt {
  weather: boolean;
  housePlayer: boolean;
  roomPlayer: boolean;
  alert: boolean;
  /** Nichts davon? Dann gar keine Spalte, statt einer leeren Fläche. */
  anything: boolean;
}

/** Welche Karten die Spalte zeigt (rein, testbar). */
export function panelContent(wunsch: Spaltenwunsch): Spalteninhalt {
  const inhalt = {
    weather: wunsch.weather && !wunsch.inRoom,
    housePlayer: wunsch.housePlayer && !wunsch.inRoom,
    roomPlayer: wunsch.roomPlayer,
    alert: wunsch.alert,
  };
  return { ...inhalt, anything: Object.values(inhalt).some(Boolean) };
}

/**
 * Zeigt die Spalte eine eigene Karte für den offenen Raum? (rein, testbar)
 *
 * Dieselbe Box zweimal zu zeigen wäre unsinnig – aber nur, solange die
 * Karte des Hauses überhaupt dasteht. Im Zimmer ist sie weg, und dann ist
 * die Box dieses Raums die einzige, auch wenn es dieselbe ist. Ohne diese
 * Ausnahme verschwände die Musik ausgerechnet im Zimmer, in dem sie
 * gerade spielt.
 */
export function showsRoomPlayer(opts: {
  inRoom: boolean;
  roomPlayerId?: string | null;
  housePlayerId?: string | null;
}): boolean {
  if (!opts.roomPlayerId) return false;
  return opts.inRoom || opts.roomPlayerId !== opts.housePlayerId;
}
