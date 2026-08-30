/**
 * Der Hintergrund folgt dem Tag.
 *
 * Der Verlauf hinter den Kacheln sah morgens um sieben aus wie um
 * Mitternacht: dieselben drei Blaugrau-Stufen, den ganzen Tag. Dabei
 * weiss die App den Sonnenstand ohnehin – sie schaltet danach zwischen
 * hell und dunkel um (theme.tsx: `sunHours`).
 *
 * Hier wird daraus eine langsame Bewegung: Um Sonnenauf- und -untergang
 * wandert ein warmer Ton in den oberen Teil des Verlaufs, tief in der
 * Nacht wird er kühler und dunkler, mittags bleibt er, wie er ist. Wer
 * den Bildschirm weckt, sieht ungefähr, wie spät es ist, bevor er die
 * Uhr liest.
 *
 * Drei Regeln, damit daraus keine Kirmes wird:
 *
 * - **Nur der oberste Farbstopp** wandert. Die beiden unteren tragen den
 *   Kontrast für die weisse Schrift der Kopfzeile; färbte man sie mit,
 *   müsste man die Lesbarkeit zu jeder Tageszeit neu prüfen.
 * - **Höchstens ein Drittel Beimischung.** Es soll auffallen, wenn man
 *   zwei Aufnahmen nebeneinander hält, und nicht, wenn man hinsieht.
 * - **Nur die beiden Grundpaletten.** Pink, Mitternacht und Sand sind
 *   bewusst gewählte Bilder – an denen hat die Uhrzeit nichts zu
 *   suchen.
 *
 * Reines Rechnen: hinein die Stunde und der Sonnenstand, heraus drei
 * Farben.
 */

/** Wie stark höchstens beigemischt wird. */
export const MAX_ANTEIL = 0.34;

/** So lange vor und nach dem Ereignis wird gefärbt (Stunden). */
export const FENSTER = 1.25;

/** Morgenrot und Abendrot – der Abend etwas satter, wie draussen auch. */
const MORGEN: Rgb = [255, 186, 120];
const ABEND: Rgb = [255, 148, 106];
/** Tiefe Nacht: kälter und dunkler als der Grundton. */
const NACHT: Rgb = [26, 34, 54];

type Rgb = [number, number, number];

function zuRgb(hex: string): Rgb | null {
  const treffer = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!treffer) return null;
  const zahl = parseInt(treffer[1], 16);
  return [(zahl >> 16) & 255, (zahl >> 8) & 255, zahl & 255];
}

function zuHex(rgb: Rgb): string {
  return `#${rgb
    .map((teil) => Math.max(0, Math.min(255, Math.round(teil))).toString(16).padStart(2, '0'))
    .join('')}`;
}

function mischen(a: Rgb, b: Rgb, anteil: number): Rgb {
  return [
    a[0] + (b[0] - a[0]) * anteil,
    a[1] + (b[1] - a[1]) * anteil,
    a[2] + (b[2] - a[2]) * anteil,
  ];
}

/**
 * Welche Farbe wie stark beigemischt wird (rein, testbar).
 *
 * `stunde` ist die Ortszeit als Bruchzahl (7.5 = halb acht). Ohne
 * Sonnenstand (Polartag, Polarnacht) wird nichts gefärbt: Eine geratene
 * Dämmerung wäre schlimmer als keine.
 */
export function beimischung(
  stunde: number,
  sonne: { sunrise: number; sunset: number } | null
): { farbe: Rgb; anteil: number } | null {
  if (!sonne) return null;
  const nahAufgang = Math.abs(stunde - sonne.sunrise);
  const nahUntergang = Math.abs(stunde - sonne.sunset);
  if (nahAufgang <= FENSTER) {
    // Am nächsten am Ereignis am stärksten, zu den Rändern hin aus.
    return { farbe: MORGEN, anteil: MAX_ANTEIL * (1 - nahAufgang / FENSTER) };
  }
  if (nahUntergang <= FENSTER) {
    return { farbe: ABEND, anteil: MAX_ANTEIL * (1 - nahUntergang / FENSTER) };
  }
  // Tiefe Nacht: von einer Stunde nach Untergang bis eine Stunde vor
  // Aufgang, mit demselben weichen Übergang an beiden Enden.
  if (stunde > sonne.sunset || stunde < sonne.sunrise) {
    const seit = stunde > sonne.sunset ? stunde - sonne.sunset : stunde + 24 - sonne.sunset;
    const bis =
      stunde < sonne.sunrise ? sonne.sunrise - stunde : sonne.sunrise + 24 - stunde;
    const rand = Math.min(seit, bis);
    const anteil = MAX_ANTEIL * Math.min(1, Math.max(0, (rand - FENSTER) / 1.5));
    return anteil > 0 ? { farbe: NACHT, anteil } : null;
  }
  return null;
}

/**
 * Den Verlauf auf die Tageszeit einstellen (rein, testbar).
 *
 * Nur der oberste Farbstopp ändert sich; die Liste kommt sonst
 * unverändert zurück – auch dann, wenn nichts beizumischen ist oder die
 * Farbe kein einfaches `#rrggbb` ist.
 */
export function tagesverlauf(
  basis: readonly string[],
  stunde: number,
  sonne: { sunrise: number; sunset: number } | null
): [string, string, ...string[]] {
  const unveraendert = [...basis] as [string, string, ...string[]];
  if (basis.length < 2) return unveraendert;
  const zusatz = beimischung(stunde, sonne);
  if (!zusatz || zusatz.anteil <= 0.01) return unveraendert;
  const oben = zuRgb(basis[0]);
  if (!oben) return unveraendert;
  return [zuHex(mischen(oben, zusatz.farbe, zusatz.anteil)), ...basis.slice(1)] as [
    string,
    string,
    ...string[],
  ];
}

/** Die Ortszeit als Bruchzahl – 7:30 wird zu 7.5 (rein, testbar). */
export function stundeVon(now: Date): number {
  return now.getHours() + now.getMinutes() / 60;
}
