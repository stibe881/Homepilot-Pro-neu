/**
 * Wie weit ist der Titel? – der Fortschritt der Musikkachel.
 *
 * Der Hub schickt die Position, die Länge und den Zeitpunkt der Messung.
 * Den Zeitpunkt braucht es, weil er sich nur bei Änderungen meldet: Ohne
 * ihn stünde der Balken zwischen zwei Meldungen still, statt zu laufen.
 * Also rechnet die App hoch – aber nur, solange etwas spielt. Bei Pause
 * wäre Hochrechnen eine Behauptung.
 *
 * Reines Rechnen: hinein der Zustand und die aktuelle Zeit, heraus die
 * Zahlen für den Balken.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Zustand = Record<string, any> | undefined;

export interface Fortschritt {
  /** Sekunden seit dem Anfang des Titels. */
  position: number;
  /** Gesamtlänge in Sekunden. */
  duration: number;
  /** 0 bis 100 – so, wie der Balken es braucht. */
  anteil: number;
  /** «1:23» */
  gelaufen: string;
  /** «-2:07» – die Antwort auf «wie lange geht der Podcast noch?» */
  rest: string;
}

/** Sekunden als «1:23» oder «1:02:03» (rein, testbar). */
export function mmss(sekunden: number): string {
  const ganz = Math.max(0, Math.floor(sekunden));
  const s = ganz % 60;
  const m = Math.floor(ganz / 60) % 60;
  const h = Math.floor(ganz / 3600);
  const zwei = (wert: number) => String(wert).padStart(2, '0');
  return h > 0 ? `${h}:${zwei(m)}:${zwei(s)}` : `${m}:${zwei(s)}`;
}

function zahl(wert: unknown): number | null {
  const n = typeof wert === 'string' ? Number(wert) : wert;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Der Fortschritt des laufenden Titels (rein, testbar).
 *
 * `null` heisst «kein Balken»: Ein Radiostrom hat kein Ende, und ein
 * Balken ohne Länge wäre eine Anzeige, die nichts anzeigt.
 */
export function fortschritt(state: Zustand, jetzt: number = Date.now() / 1000): Fortschritt | null {
  const dauer = zahl(state?.duration);
  const stand = zahl(state?.position);
  if (dauer === null || dauer <= 0 || stand === null) return null;

  let position = stand;
  const gemessen = zahl(state?.position_at);
  if (gemessen !== null && String(state?.state) === 'playing') {
    // Nur beim Spielen hochrechnen. Bei Pause wäre es eine Behauptung.
    position = stand + Math.max(0, jetzt - gemessen);
  }
  position = Math.min(dauer, Math.max(0, position));
  return {
    position,
    duration: dauer,
    anteil: (position / dauer) * 100,
    gelaufen: mmss(position),
    rest: `-${mmss(dauer - position)}`,
  };
}

/** Wohin ein Tipp auf den Balken springt (rein, testbar). */
export function sprungziel(anteil: number, duration: number): number {
  const teil = Math.min(100, Math.max(0, anteil)) / 100;
  // Eine Sekunde vor Schluss ist das Weiteste, was Sinn ergibt – genau
  // ans Ende zu springen heisst beim Empfänger «Titel vorbei».
  return Math.round(Math.min(duration - 1, teil * duration) * 10) / 10;
}

/** Lässt sich in diesem Titel überhaupt springen? (rein, testbar) */
export function darfSpringen(state: Zustand, commands: string[]): boolean {
  if (!commands.includes('seek')) return false;
  // `can_seek` sagt das Gerät selbst. Fehlt es, gilt: Wer eine Länge
  // meldet, kann in der Regel auch springen.
  if (state?.can_seek === false) return false;
  return fortschritt(state) !== null;
}
