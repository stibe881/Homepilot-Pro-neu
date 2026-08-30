/**
 * Was eine Verlaufskurve beantworten soll.
 *
 * Sie war eine Linie auf einem leeren Feld: Man sah, dass es auf und ab
 * ging, aber nicht, ob das viel ist. Die Frage, die man beim Hinsehen
 * wirklich stellt, lautet «mehr oder weniger als sonst?» – und die
 * beantwortet erst der Zeitraum davor.
 *
 * Geholt wird dafür der doppelte Zeitraum und in der Mitte geteilt: Die
 * ältere Hälfte ist das «sonst», die jüngere das «jetzt». Das kostet
 * keinen zweiten Abruf und keine neue Schnittstelle – der Hub kennt nur
 * «die letzten n Stunden».
 *
 * Reines Rechnen; das Zeichnen steht in components/HistoryChart.
 */

export interface Punkt {
  at: number;
  value: number;
}

/** So viele Messwerte braucht eine Hälfte, damit sie etwas aussagt. */
export const MIN_PUNKTE = 3;

/** Unterschiede darunter sind Rauschen und keine Nachricht. */
export const MIN_ABWEICHUNG = 3;

/**
 * Den doppelten Zeitraum in «jetzt» und «davor» teilen (rein, testbar).
 *
 * Geschnitten wird an einem gerechneten Zeitpunkt und nicht in der Mitte
 * der Liste: Messwerte kommen nicht gleichmässig, und eine Nacht ohne
 * Bewegung verschöbe den Schnitt sonst um Stunden.
 */
export function teile(
  punkte: Punkt[],
  stunden: number,
  jetzt: number
): { jetzt: Punkt[]; davor: Punkt[] } {
  const grenze = jetzt - stunden * 3600_000;
  return {
    jetzt: punkte.filter((punkt) => punkt.at >= grenze),
    davor: punkte.filter((punkt) => punkt.at < grenze),
  };
}

/**
 * Die frühere Hälfte nach vorn schieben (rein, testbar).
 *
 * Damit beide Kurven übereinanderliegen und man Montag mit Montag
 * vergleicht statt Anfang mit Ende.
 */
export function verschiebe(punkte: Punkt[], stunden: number): Punkt[] {
  const versatz = stunden * 3600_000;
  return punkte.map((punkt) => ({ at: punkt.at + versatz, value: punkt.value }));
}

/**
 * Die gemeinsame Spanne mehrerer Reihen (rein, testbar).
 *
 * Beide Kurven müssen denselben Massstab haben, sonst lägen sie
 * übereinander und behaupteten Gleichheit, wo keine ist. Leere Reihen
 * zählen nicht mit; ohne jeden Wert kommt 0 bis 1 zurück, damit die
 * Rechnung nicht durch null teilt.
 */
export function spanne(reihen: Punkt[][]): { min: number; max: number } {
  const werte = reihen.flat().map((punkt) => punkt.value);
  if (werte.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...werte);
  const max = Math.max(...werte);
  return max === min ? { min, max: min + 1 } : { min, max };
}

/** Der Mittelwert einer Reihe – null bei zu wenigen Werten (rein). */
export function mittel(punkte: Punkt[]): number | null {
  if (punkte.length < MIN_PUNKTE) return null;
  return punkte.reduce((summe, punkt) => summe + punkt.value, 0) / punkte.length;
}

/**
 * «12 % mehr als in der Woche davor» (rein, testbar).
 *
 * `null` heisst: nichts zu sagen. Das gilt für zu kurze Reihen, für
 * einen Nullpunkt davor (ein Prozentwert davon wäre unendlich) und für
 * Unterschiede unter der Rauschschwelle. Lieber keine Zeile als eine,
 * die bei jedem Öffnen etwas anderes behauptet.
 */
export function vergleich(
  jetzt: Punkt[],
  davor: Punkt[],
  wovon: string
): string | null {
  const a = mittel(jetzt);
  const b = mittel(davor);
  if (a === null || b === null || b === 0) return null;
  const prozent = Math.round(((a - b) / Math.abs(b)) * 100);
  if (Math.abs(prozent) < MIN_ABWEICHUNG) return `gleich wie ${wovon}`;
  return `${Math.abs(prozent)} % ${prozent > 0 ? 'mehr' : 'weniger'} als ${wovon}`;
}

/** Womit verglichen wird, in Worten (rein, testbar). */
export function wovon(stunden: number): string {
  if (stunden <= 24) return 'am Vortag';
  if (stunden <= 24 * 7) return 'in der Woche davor';
  return 'im Monat davor';
}

/**
 * Aus einer Linie eine Fläche machen (rein, testbar).
 *
 * Die Fläche unter der Kurve sagt dasselbe wie die Linie, aber sie sagt
 * es auch aus dem Augenwinkel: Man sieht die Menge, nicht nur den
 * Verlauf.
 */
export function flaeche(
  linie: string,
  xStart: number,
  xEnde: number,
  boden: number
): string {
  if (!linie) return '';
  return `${linie} L ${xEnde} ${boden} L ${xStart} ${boden} Z`;
}
