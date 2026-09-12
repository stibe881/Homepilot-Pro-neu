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

/** Die Stufen, nach denen beim Grillen wirklich gefragt wird. Kein
 *  Zahlenfeld: fettige Finger, keine Tastatur (wie bei den Garstufen). */
export const GRILLTIMER_MINUTEN = [5, 10, 15, 20, 30, 45, 60, 90];

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
