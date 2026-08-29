/**
 * Einen Ablauf von Hand starten.
 *
 * Den Knopf gab es nur im Editor – drei Schritte tief, hinter
 * «Bearbeiten». Wer sehen will, ob «Jemand kommt Nachhause» überhaupt
 * etwas tut, will ihn dort, wo der Ablauf steht.
 *
 * Der Handstart übergeht die Bedingungen: Er führt die Aktionen aus,
 * auch wenn niemand zuhause ist und der Ablauf im Alltag gestoppt
 * hätte. Das ist beim Ausprobieren richtig – man will das Ergebnis
 * sehen, nicht die Bedingung prüfen – und muss deshalb dastehen.
 *
 * **Rückfrage nur, wo es weh tut.** Ein Ablauf, der Licht schaltet oder
 * den Sauger heimschickt, läuft auf einen Tipp: Wer beim Einrichten
 * fünfmal drückt, will nicht fünfmal bestätigen. Ein Ablauf, der die
 * Türe abschliesst oder die Alarmanlage scharf schaltet, fragt vorher –
 * dort ist ein Fehlgriff nicht in einer Sekunde zurückgenommen.
 *
 * Dieselbe Grenze zieht das Suchfeld (lib/suchbefehl.ts): Schloss und
 * Alarm sind die zwei Dinge, die man nicht nebenbei schaltet.
 */

/** Befehle, nach denen gefragt wird, bevor der Ablauf losgeht. */
export const HEIKEL = [
  'lock',
  'unlock',
  'open_door',
  'arm',
  'arm_away',
  'arm_home',
  'arm_night',
  'disarm',
];

/**
 * Braucht dieser Ablauf eine Rückfrage? (rein, testbar)
 *
 * Geprüft werden beide Zweige – der «sonst»-Zweig führt genauso aus,
 * und beim Handstart weiss man vorher nicht, welcher dran ist.
 */
export function brauchtRueckfrage(
  actions: Record<string, unknown>[] | undefined,
  otherwise?: Record<string, unknown>[],
): boolean {
  return [...(actions ?? []), ...(otherwise ?? [])].some((action) =>
    HEIKEL.includes(String(action?.command ?? '')),
  );
}

/**
 * Was in der Rückfrage steht (rein, testbar).
 *
 * Die Zahl der Schritte statt ihrer Aufzählung: Bei sechzig Geräten ist
 * die Liste eine Wand, und die Frage lautet ohnehin «wie viel passiert
 * hier gleich?». Der Satz über die Bedingungen ist der wichtigere Teil
 * – ihn erwartet niemand von selbst.
 */
export function handstartSatz(anzahl: number): string {
  const schritte = anzahl === 1 ? '1 Schritt' : `${anzahl} Schritte`;
  return `${schritte}. Die Bedingungen werden dabei übergangen – der Ablauf läuft auch, wenn er im Alltag gestoppt hätte.`;
}
