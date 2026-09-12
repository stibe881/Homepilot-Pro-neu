/**
 * Der Timer im Grillblatt (Punkt 561).
 *
 * Gewünscht im Haus: «Wenn man hier den Timer stellt, soll man ihn
 * direkt hier erstellen können inkl. wie lange der Timer noch geht,
 * und nicht auf die Küchen-Timer.» Es *ist* derselbe Timer des Hubs
 * (core/timers.py) - er klingelt als Push und über die Boxen, er liegt
 * als Karte auf dem Sperrbildschirm -, nur gestellt und abgelesen wird
 * er dort, wo man beim Grillen ohnehin hinsieht.
 *
 * Erkannt wird er an seinem Text: Der Hub führt Timer ohne Herkunft,
 * und die einzige Spur, die durch Speichern und Neustart geht, ist der
 * Text. Er ist zugleich das, was die Push beim Klingeln sagt - deshalb
 * ein Satz, der auch ohne das Blatt verständlich ist.
 */

export interface Timer {
  id: string;
  text: string;
  ends_at: number;
}

/** Die Dauer, mit der das Feld aufgeht - eine, die man oft will und
 *  von der aus beide Richtungen kurz sind. */
export const TIMER_VORGABE = 30;

/** Der Schritt der Knöpfe − und + neben dem Feld. */
export const TIMER_SCHRITT = 5;

/** Länger geht der Küchen-Timer des Hubs nicht (core/timers.py,
 *  MAX_MINUTES) - «ein Küchen-Timer ist kein Kalender». */
export const TIMER_HOECHSTENS = 180;

/**
 * Was der Benutzer ins Feld getippt hat, als Minuten (rein, testbar).
 *
 * Gewünscht im Haus (Punkt 568): «Ich will den Timer selber stellen und
 * nicht eine Vorauswahl angeben.» Also ein Feld, kein Chip-Raster. Es
 * nimmt «45», «1:30» und «1h30» - wer am Grill steht, tippt, was ihm
 * einfällt. `null` heisst: daraus wird kein Timer.
 */
export function minutenAusEingabe(text: string): number | null {
  const roh = text.trim().toLowerCase().replace(',', '.');
  if (!roh) return null;
  let minuten: number;
  const doppelpunkt = roh.match(/^(\d+):(\d{1,2})$/);
  const stunden = roh.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+))?$/);
  if (doppelpunkt) {
    minuten = Number(doppelpunkt[1]) * 60 + Number(doppelpunkt[2]);
  } else if (stunden) {
    minuten = Number(stunden[1]) * 60 + Number(stunden[2] ?? 0);
  } else if (/^\d+$/.test(roh)) {
    minuten = Number(roh);
  } else {
    return null;
  }
  minuten = Math.round(minuten);
  if (minuten < 1 || minuten > TIMER_HOECHSTENS) return null;
  return minuten;
}

/** Ein Schritt mit − oder +, innerhalb der Grenzen (rein, testbar). */
export function minutenSchritt(minuten: number, richtung: 1 | -1): number {
  const neu = minuten + richtung * TIMER_SCHRITT;
  return Math.max(1, Math.min(TIMER_HOECHSTENS, neu));
}

/** Der Text, an dem der Grill seinen Timer wiedererkennt (rein, testbar). */
export function grilltimerText(name: string): string {
  return `${name.trim() || 'Grill'} – nachsehen`;
}

/** Die Timer dieses Grills, der nächste zuerst (rein, testbar). */
export function grilltimer<T extends Timer>(timers: T[] | undefined, name: string): T[] {
  const text = grilltimerText(name);
  return (timers ?? [])
    .filter((timer) => timer && timer.text === text)
    .sort((a, b) => a.ends_at - b.ends_at);
}
