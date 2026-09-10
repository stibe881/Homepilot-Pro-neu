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
 * Was blieb, war die Box **dieses** Raums - und auch die steht jetzt
 * woanders: oben im Raumkopf, als Streifen neben den Szenen
 * (components/Raumspieler.tsx). Im Zimmer bleibt die Spalte damit ganz
 * weg, und die Kacheln bekommen die Breite.
 *
 * Die Wetterwarnung stand hier lange mit dem Argument, sie sei der
 * Grund, aus dem es die Spalte gibt. Sie steht aber längst oben in der
 * Kopfzeile – rot und blinkend (components/TopStrip.tsx,
 * lib/warnzeile.ts) –, und damit war sie auf jedem Bildschirm zweimal
 * zu sehen: einmal oben und einmal als grosse Karte «Wetterlage · 1
 * Warnungen» darunter. Zweimal dasselbe liest niemand zweimal.
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
}

export interface Spalteninhalt {
  weather: boolean;
  housePlayer: boolean;
  /** Nichts davon? Dann gar keine Spalte, statt einer leeren Fläche. */
  anything: boolean;
}

/** Welche Karten die Spalte zeigt (rein, testbar). */
export function panelContent(wunsch: Spaltenwunsch): Spalteninhalt {
  const inhalt = {
    weather: wunsch.weather && !wunsch.inRoom,
    housePlayer: wunsch.housePlayer && !wunsch.inRoom,
  };
  return { ...inhalt, anything: Object.values(inhalt).some(Boolean) };
}
