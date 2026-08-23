/**
 * Babysitter-Modus: jemand ist da, den die Anwesenheit nicht kennt.
 *
 * Der Hub schliesst aus «kein Telefon zuhause» auf «niemand zuhause»,
 * und das ist fast immer richtig. Nicht aber an dem Abend, an dem die
 * Eltern weg sind und der Babysitter im Wohnzimmer sitzt: Dann fährt
 * «alles aus» die Storen herunter und schaltet scharf, während jemand
 * darin sitzt.
 *
 * Solange der Modus läuft, ruhen alle Abläufe ausser den ausdrücklich
 * angehakten.
 */

/** Was der Hub über den Modus mitschickt. */
export interface BabysitterStand {
  active: boolean;
  /** Kennungen der freigegebenen Abläufe. */
  allow: string[];
  /** Seit wann er läuft (Unix-Sekunden) – oder null. */
  since?: number | null;
  /** Wie viele Abläufe laufen bzw. ruhen würden. */
  running?: number;
  paused?: number;
}

export const LEERER_BABYSITTER: BabysitterStand = { active: false, allow: [] };

/** Ist dieser Ablauf freigegeben? (rein, testbar) */
export function istFreigegeben(stand: BabysitterStand, id: string): boolean {
  return (stand.allow ?? []).includes(id);
}

/** Wird dieser Ablauf gerade zurückgehalten? (rein, testbar)
 *
 *  Nur bei laufendem Modus. Ausserhalb bleiben die Haken stehen – wer
 *  ihn am nächsten Abend wieder einschaltet, muss nicht neu anhaken. */
export function ruht(stand: BabysitterStand, id: string): boolean {
  return !!stand.active && !istFreigegeben(stand, id);
}

/**
 * Der Satz über dem Schalter (rein, testbar).
 *
 * Vor dem Einschalten zählt die Zahl: «3 laufen weiter, 17 ruhen» ist
 * die Auskunft, die man braucht, bevor man drückt – nicht danach.
 */
export function modusSatz(stand: BabysitterStand, gesamt: number): string {
  const frei = (stand.allow ?? []).length;
  const ruhend = Math.max(0, gesamt - frei);
  if (stand.active) {
    return `Läuft${seitText(stand.since)} – ${frei} von ${gesamt} Abläufen sind freigegeben, ${ruhend} ruhen.`;
  }
  if (frei === 0) {
    return `Noch nichts freigegeben: Beim Einschalten würden alle ${gesamt} Abläufe ruhen.`;
  }
  return `Beim Einschalten laufen ${frei} von ${gesamt} Abläufen weiter, ${ruhend} ruhen.`;
}

/** «seit 19:40» – am nächsten Morgen die Frage, ob jemand vergessen hat
 *  auszuschalten (rein, testbar). */
export function seitText(since?: number | null): string {
  if (!since) return '';
  const datum = new Date(since * 1000);
  if (Number.isNaN(datum.getTime())) return '';
  const uhr = `${String(datum.getHours()).padStart(2, '0')}:${String(
    datum.getMinutes()
  ).padStart(2, '0')}`;
  return ` seit ${uhr}`;
}
