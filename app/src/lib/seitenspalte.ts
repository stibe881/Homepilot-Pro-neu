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
 * Dasselbe gilt auf der Raumliste selbst: «Räume» ist die Seite, auf
 * der man ein Zimmer sucht, nicht die, auf der man stehen bleibt. Die
 * Spalte stand dort neben den Raumkacheln - und die leben von ihren
 * Fotos, denen die 340 Punkte fehlten. Die Startseite behält sie.
 *
 * Und aus demselben Grund nicht auf der Geräteliste (Einstellungen →
 * Geräte, Punkt 549): Dort sucht man ein bestimmtes Gerät, mit Suchfeld
 * und Filtern darüber. Auf dem Telefon standen Wetter und Musik unter
 * der Liste und schoben sie unter den Rand.
 *
 * Was blieb, war die Box **dieses** Raums - und auch die steht jetzt
 * woanders: oben im Raumkopf, als kompletter Medienplayer unter den
 * Szenen des Zimmers (DashboardScreen, components/SidePanel.tsx:
 * MediaPanel). Im Zimmer bleibt die Spalte damit ganz weg, und die
 * Kacheln bekommen die Breite.
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
  /** Die Raumliste («Räume», ohne geöffnetes Zimmer)? Dort gilt
   *  dasselbe wie im Zimmer: Wer die Räume ansieht, sucht ein Zimmer -
   *  Wetter und Hausmusik beantworten keine Frage, die er dabei
   *  stellt. Und die Raumkacheln tragen Fotos, die von der Breite
   *  leben; 340 Punkte daneben kosteten auf dem iPad eine ganze
   *  Kachelspalte. Die Startseite behält die Spalte: Sie ist die
   *  Seite, auf der man stehen bleibt. */
  roomList?: boolean;
  /** Die Geräteliste (Einstellungen → Geräte)? Dieselbe Überlegung
   *  wie bei der Raumliste, nur schärfer: Dort sucht man ein
   *  *bestimmtes* Gerät, mit Suchfeld und Filtern. Das Wetter von Zell
   *  und die Musik der Wohnung beantworten keine Frage, die man dabei
   *  stellt - auf dem Telefon standen sie unter der Liste und schoben
   *  sie unter den Rand, auf dem iPad kosteten sie eine Kachelspalte. */
  deviceList?: boolean;
  /** Eine der Geräteseiten - Licht, Storen, Kameras (Punkt 577)? Auch
   *  dort steht man nicht, um das Wetter zu lesen oder Musik zu wählen:
   *  Man will die Storen fahren, und auf dem Telefon standen Wetter
   *  und Musik unter den Kacheln. Damit bleibt die Spalte nur noch auf
   *  der Startseite - der einen Seite, auf der man stehen bleibt. */
  geraeteseite?: boolean;
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
  const weg =
    wunsch.inRoom || !!wunsch.roomList || !!wunsch.deviceList || !!wunsch.geraeteseite;
  const inhalt = {
    weather: wunsch.weather && !weg,
    housePlayer: wunsch.housePlayer && !weg,
  };
  return { ...inhalt, anything: Object.values(inhalt).some(Boolean) };
}
