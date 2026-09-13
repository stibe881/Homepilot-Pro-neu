/**
 * Welche Blätter gerade übereinander offen sind (Punkt 581 der Werkbank).
 *
 * Fehler- und Bestätigungs-Einblendungen lagen im Wurzel-View der
 * Startseite. Ein natives Modal deckt den Wurzel-View aber ganz zu -
 * die Absage des Hubs stand also da, verdeckt von genau der Fläche, auf
 * der man gerade tippte. Die Fernbedienung bekam deshalb die Absage
 * als Prop hineingereicht; Klingel, Grill, Musik und Kamera nicht, und
 * ein abgelehnter Türöffner bei laufender Klingel blieb unsichtbar.
 *
 * Jetzt meldet sich jedes Blatt beim Öffnen an und beim Schliessen ab,
 * und das Band mit den Meldungen zeichnet sich nur im *obersten* Blatt
 * - sonst stünde dieselbe Absage in drei Ebenen, auf dem Web sogar
 * sichtbar durch den durchscheinenden Hintergrund hindurch. Ist kein
 * Blatt offen, gehört das Band dem Wurzel-View.
 *
 * Nebenbei weiss der Stapel, ob ein Blatt das Gerät wach halten will
 * (Punkt 582): Der Kochmodus, die laufende Klingel und das Grillblatt
 * setzen die Drei-Minuten-Rückkehr des Wandpanels aus.
 */

export interface Blatt {
  /** Eine laufende Nummer je eingehängtem Blatt. */
  kennung: number;
  /** Setzt die Rückkehr zur Startseite aus, solange es offen ist. */
  haeltWach: boolean;
}

/** Ein Blatt kommt obendrauf (rein, testbar). Dieselbe Kennung ein
 *  zweites Mal ersetzt den alten Eintrag an Ort und Stelle - ein Blatt,
 *  das «hält wach» umschaltet, soll dabei nicht nach oben rutschen. */
export function dazu(stapel: Blatt[], blatt: Blatt): Blatt[] {
  if (stapel.some((eintrag) => eintrag.kennung === blatt.kennung)) {
    return stapel.map((eintrag) => (eintrag.kennung === blatt.kennung ? blatt : eintrag));
  }
  return [...stapel, blatt];
}

/** Ein Blatt geht zu (rein, testbar). Unbekannte Kennungen sind kein
 *  Fehler: Ein Blatt, das vor dem Anmelden schon wieder weg war, meldet
 *  sich trotzdem ab. */
export function ohne(stapel: Blatt[], kennung: number): Blatt[] {
  return stapel.filter((eintrag) => eintrag.kennung !== kennung);
}

/** Die Kennung des obersten Blatts, oder null, wenn keines offen ist
 *  (rein, testbar). Dort zeichnet sich das Meldungsband. */
export function oberstes(stapel: Blatt[]): number | null {
  return stapel.length > 0 ? stapel[stapel.length - 1].kennung : null;
}

/** Hält gerade irgendein offenes Blatt das Gerät wach? (rein, testbar) */
export function haeltWach(stapel: Blatt[]): boolean {
  return stapel.some((eintrag) => eintrag.haeltWach);
}
