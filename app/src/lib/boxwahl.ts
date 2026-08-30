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

/** Was der Wähler weiss, wenn eine Box angetippt wird. */
export interface WechselQuelle {
  id: string;
  /** Kann die gezeigte Quelle umziehen (`play_on`)? */
  kannUmziehen: boolean;
  /** Boxen, die die Quelle gerade kennt. */
  devices: string[];
  spielt: boolean;
}

/**
 * Umzug oder nur Ansichtswechsel? (rein, testbar)
 *
 * Die Entscheidung stand als Bedingungskette im SidePanel - und genau
 * diese Kette trug schon einmal den Terrassen-Fehler (siehe Kopf der
 * Datei). Seit der Player auch als Blatt über der Raumkachel steht,
 * braucht es sie zweimal; zweimal hingeschrieben wäre der nächste
 * Auseinanderlauf.
 */
export function boxWechsel(
  quelle: WechselQuelle | null,
  ziel: { id: string; name: string }
): { art: 'umzug'; device: string; play: boolean } | { art: 'ansicht' } {
  if (
    quelle &&
    ziel.id !== quelle.id &&
    quelle.kannUmziehen &&
    quelle.devices.includes(ziel.name)
  ) {
    return { art: 'umzug', device: ziel.name, play: quelle.spielt };
  }
  return { art: 'ansicht' };
}
