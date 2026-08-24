/**
 * Was als Nächstes läuft – die Warteschlange des Players.
 *
 * Die Musikkarte zeigt, was gerade spielt. «Und danach?» stand nirgends,
 * obwohl Spotify die Warteschlange liefert und der Hub sie seit Kurzem
 * mitschickt. Wer eine Playlist laufen lässt, will genau das wissen,
 * bevor er zum Überspringen greift.
 *
 * Reines Rechnen: hinein der Zustand des Geräts, heraus die Zeilen.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Zustand = Record<string, any>;

export interface WarteZeile {
  key: string;
  /** «läuft» für den aktuellen Titel, sonst «1», «2» … */
  nummer: string;
  track: string;
  artist: string;
  laeuft: boolean;
  /** Womit sich der Titel anspringen lässt – `null` heisst «nur lesen».
   *
   *  Podcast-Folgen bringen keine mit, und ältere Hub-Fassungen schickten
   *  die Warteschlange ohne URIs. Die Zeile steht dann trotzdem da; sie
   *  reagiert bloss nicht auf einen Tipp. */
  uri: string | null;
}

/**
 * Der laufende Titel und was danach kommt (rein, testbar).
 *
 * Der laufende steht mit dabei und ist als solcher gekennzeichnet: Eine
 * Liste, die mitten im Album anfängt, lässt einen suchen, wo man gerade
 * ist.
 */
export function warteschlange(state: Zustand | undefined): WarteZeile[] {
  const zeilen: WarteZeile[] = [];
  const track = String(state?.track ?? '').trim();
  if (track) {
    zeilen.push({
      key: 'jetzt',
      nummer: 'läuft',
      track,
      artist: String(state?.artist ?? '').trim(),
      laeuft: true,
      // Der laufende Titel ist kein Ziel: Er läuft ja schon, und ein
      // Tipp darauf würde ihn von vorn beginnen lassen.
      uri: null,
    });
  }
  const roh = Array.isArray(state?.queue) ? state.queue : [];
  roh.forEach((eintrag: Zustand, index: number) => {
    const name = String(eintrag?.track ?? '').trim();
    if (!name) return;
    zeilen.push({
      // Derselbe Titel kann zweimal in der Schlange stehen – der Index
      // gehört deshalb in den Schlüssel.
      key: `${index}-${name}`,
      nummer: String(index + 1),
      track: name,
      artist: String(eintrag?.artist ?? '').trim(),
      laeuft: false,
      uri: String(eintrag?.uri ?? '').trim() || null,
    });
  });
  return zeilen;
}

/**
 * Die Überschrift des Fensters (rein, testbar).
 *
 * Der Name der Playlist, wo der Hub ihn kennt – sonst die Frage, die man
 * sich gerade stellt.
 */
export function warteTitel(state: Zustand | undefined): string {
  const playlist = String(state?.playlist ?? '').trim();
  return playlist || 'Als Nächstes';
}

/** Gibt es überhaupt etwas zu zeigen? (rein, testbar)
 *
 * Nur der laufende Titel allein ist kein Fenster wert – das steht schon
 * auf der Karte. */
export function hatWarteschlange(state: Zustand | undefined): boolean {
  return warteschlange(state).some((zeile) => !zeile.laeuft);
}
