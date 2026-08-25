/**
 * Auf welcher Box eine Playlist oder ein Sender starten soll.
 *
 * Der gemeldete Fall: Oben «Büro» gewählt, Playlist gedrückt - Musik
 * läuft auf der Terrasse. Der Wähler zog die Wiedergabe zwar um
 * (`play_on`), aber bei stillem Spotify bleibt so ein Umzug nicht
 * haften: Ohne laufende Wiedergabe meldet Spotify beim nächsten Blick
 * wieder die zuletzt aktive Box. Der Start schickte dann gar kein
 * Gerät mit, der Hub fiel auf «gerade aktiv» zurück - Terrasse.
 *
 * Darum reist die Wahl jetzt als eigener Wunsch bis zum Startbefehl mit
 * und wird dort ausdrücklich genannt. Der Hub behandelt ein genanntes
 * Gerät als Ansage: Er weckt es notfalls und bricht lieber ab, als im
 * falschen Zimmer zu spielen.
 */

/** Die Box für den Start (rein, testbar).
 *
 *  Reihenfolge: im Panel angetippt → oben im Wähler gewünscht → gerade
 *  aktiv → die erste sichtbare. Ein Wunsch zählt nur, solange Spotify
 *  die Box gerade kennt - eine unbekannte würde der Hub zwar wecken,
 *  aber ein veralteter Wunsch soll keinen gültigen aktiven Stand
 *  verdrängen. */
export function zielBox(
  angetippt: string | null,
  wunsch: string | null | undefined,
  aktiv: string | null,
  sichtbar: string[]
): string | null {
  if (angetippt && sichtbar.includes(angetippt)) return angetippt;
  if (wunsch && sichtbar.includes(wunsch)) return wunsch;
  return aktiv ?? sichtbar[0] ?? null;
}
