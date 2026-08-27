/**
 * Gästemodus: was die App vom Stand des Hubs ablesen muss.
 *
 * Die Frist ist der Punkt: Der Modus endet von selbst, und die
 * Restzeit soll dastehen, ohne dass jemand rechnet.
 */

export interface Gaestestand {
  active: boolean;
  /** Unix-Sekunden – wann er von selbst endet. */
  until?: number | null;
  minutes_left?: number;
  by?: string | null;
  /** Die zuletzt gewählten Empfangslichter (nur in der Abfrage). */
  lights?: string[];
  default_hours?: number;
}

/**
 * «2 Std 10 Min», «40 Min» (rein, testbar).
 *
 * Aus der Frist gerechnet und nicht aus ``minutes_left``: Die Zahl aus
 * dem Hub ist von dem Augenblick, in dem sie geholt wurde. Ein Blatt,
 * das eine Viertelstunde offen liegt, zeigte sonst eine Restzeit, die
 * es nicht mehr gibt.
 */
export function restText(stand: Gaestestand | null, jetzt: number): string {
  if (!stand?.active) return '';
  const sekunden = stand.until ? stand.until * 1000 - jetzt : 0;
  const minuten = Math.max(0, Math.ceil(sekunden / 60_000));
  if (minuten <= 0) return 'gleich zu Ende';
  if (minuten < 60) return `${minuten} Min`;
  const stunden = Math.floor(minuten / 60);
  const rest = minuten % 60;
  return rest === 0 ? `${stunden} Std` : `${stunden} Std ${rest} Min`;
}

/** Die Zeile im Menü (rein, testbar). */
export function gaesteSatz(stand: Gaestestand | null, jetzt: number): string {
  if (!stand?.active) {
    return 'WLAN, Licht und Ruhe für die Abläufe – mit Frist';
  }
  return `Läuft noch ${restText(stand, jetzt)}`;
}
