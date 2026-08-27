/**
 * Die Kamera-Zeitleiste filtern: nur Personen, nur tagsüber.
 *
 * Eine Aussenkamera sammelt nachts Dutzende Katzen und Äste. Wer
 * wissen will, ob jemand am Haus war, musste an ihnen vorbeiscrollen.
 * Zwei Schalter reichen: «nur Personen» (was Protect selbst erkennt)
 * und «nur tagsüber» – die Nacht voller Bewegungen ist meistens die
 * Frage, die man gerade nicht stellt.
 *
 * Wie viel der Filter verschluckt, wird mitgezählt und angezeigt:
 * Eine Leiste, die still kürzt, sähe aus wie ein ruhiger Tag.
 */

export interface FilterLage {
  nurPersonen: boolean;
  nurTagsueber: boolean;
}

/** Tagsüber heisst 7 bis 22 Uhr Ortszeit (rein, testbar). */
export function istTagsueber(startIso: string): boolean {
  const stunde = new Date(startIso).getHours();
  return Number.isFinite(stunde) && stunde >= 7 && stunde < 22;
}

/** Was die Leiste zeigt – und wie viel der Filter verschluckt (rein). */
export function gefiltert<E extends { start: string; detected: string[] }>(
  events: E[],
  lage: FilterLage
): { sichtbar: E[]; verborgen: number } {
  const sichtbar = events.filter(
    (event) =>
      (!lage.nurPersonen || event.detected.includes('person')) &&
      (!lage.nurTagsueber || istTagsueber(event.start))
  );
  return { sichtbar, verborgen: events.length - sichtbar.length };
}
