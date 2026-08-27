/**
 * Räume nach Nutzung sortieren – für die, die es wollen.
 *
 * Die Reihenfolge aus der config.yaml ist eine Setzung; was man wirklich
 * oft anfasst, weiss nur die Hand. Wer den Schalter umlegt, bekommt den
 * meistbedienten Raum zuoberst – gezählt wird auf diesem Gerät, denn am
 * Wandpanel im Flur bedient man anderes als auf dem Telefon im Bett.
 *
 * Die Zählung verblasst: Ein Wert halbiert sich alle zwei Wochen. Ohne
 * das stünde das Gästezimmer nach einem einzigen Besuchswochenende
 * monatelang oben – Gewohnheit ist, was man *zurzeit* tut.
 *
 * Aus, bis jemand es einschaltet – dieselbe Regel wie bei der
 * Tageszeit-Sortierung: Eine Wohnung, die sich von selbst umsortiert,
 * ist keine eingerichtete Wohnung.
 */

/** Halbwertszeit der Zählung. */
export const HALBWERT_MS = 14 * 24 * 3600 * 1000;

export interface Nutzung {
  [raum: string]: { wert: number; at: number };
}

/** Den verblassten Wert eines Eintrags lesen (rein, testbar). */
export function verblasst(eintrag: { wert: number; at: number } | undefined, jetzt: number): number {
  if (!eintrag || !Number.isFinite(eintrag.wert)) return 0;
  const alter = Math.max(0, jetzt - eintrag.at);
  return eintrag.wert * Math.pow(0.5, alter / HALBWERT_MS);
}

/** Eine Bedienung in diesem Raum mitzählen (rein, testbar). */
export function merken(zaehler: Nutzung, raum: string, jetzt: number): Nutzung {
  const alt = verblasst(zaehler[raum], jetzt);
  return { ...zaehler, [raum]: { wert: alt + 1, at: jetzt } };
}

/**
 * Räume nach Nutzung, unbenutzte in der gegebenen Reihenfolge (rein).
 *
 * Stabil bei Gleichstand: Zwei Räume, die man gleich oft anfasst,
 * sollen nicht bei jedem Öffnen die Plätze tauschen.
 */
export function reihenfolge(raeume: string[], zaehler: Nutzung, jetzt: number): string[] {
  const werte = new Map(raeume.map((raum) => [raum, verblasst(zaehler[raum], jetzt)]));
  return [...raeume].sort((a, b) => (werte.get(b) ?? 0) - (werte.get(a) ?? 0));
}
