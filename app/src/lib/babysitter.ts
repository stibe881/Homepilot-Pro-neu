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
 *
 * **Die Frist** kam aus dem früheren Gästemodus. Der stand daneben,
 * für «Besuch kommt», und tat fast dasselbe – nur gröber: Er pausierte
 * *alle* Abläufe, auch die hier freigegebenen. Zwei Modi für einen
 * Fall waren zwei Stellen zum Nachsehen und eine zum Vergessen. Was
 * der andere wirklich konnte, steht jetzt hier: eine Frist, mit der
 * der Modus von selbst endet. (Sein «Licht zum Empfang» gab es hier
 * eine Weile auch; es wurde nicht gebraucht und ist zurückgebaut.)
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
  /** Unix-Sekunden – wann er von selbst endet. `null`: keine Frist,
   *  er läuft dann, bis jemand ausschaltet. */
  until?: number | null;
  minutes_left?: number;
  default_hours?: number;
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
  // Mit Vorspann, solange der Modus aus ist: Der Satz steht unter der
  // Zeile mit «1 Stunde pausieren» und «Bis morgen» und las sich darum
  // wie eine Auskunft übers Pausieren. Er handelt aber vom Babysitter -
  // und was er beschreibt, ist noch gar nicht passiert.
  if (frei === 0) {
    return `Babysitter-Modus: noch nichts freigegeben – beim Einschalten würden alle ${gesamt} Abläufe ruhen.`;
  }
  return `Babysitter-Modus: beim Einschalten laufen ${frei} von ${gesamt} Abläufen weiter, ${ruhend} ruhen.`;
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


/**
 * «2 Std 10 Min», «40 Min» (rein, testbar).
 *
 * Aus der Frist gerechnet und nicht aus ``minutes_left``: Die Zahl aus
 * dem Hub ist von dem Augenblick, in dem sie geholt wurde. Ein Blatt,
 * das eine Viertelstunde offen liegt, zeigte sonst eine Restzeit, die
 * es nicht mehr gibt.
 */
export function restText(stand: BabysitterStand | null, jetzt: number): string {
  if (!stand?.active || !stand.until) return '';
  const minuten = Math.max(0, Math.ceil((stand.until * 1000 - jetzt) / 60_000));
  if (minuten <= 0) return 'gleich zu Ende';
  if (minuten < 60) return `${minuten} Min`;
  const stunden = Math.floor(minuten / 60);
  const rest = minuten % 60;
  return rest === 0 ? `${stunden} Std` : `${stunden} Std ${rest} Min`;
}

/**
 * Die Zeile im Menü (rein, testbar).
 *
 * Drei Fälle, weil es drei gibt: aus, mit Frist, ohne Frist. Ein Modus
 * ohne Frist läuft, bis jemand ausschaltet – das gehört dann dort zu
 * stehen und nicht eine Restzeit, die es nicht gibt.
 */
export function modusZeile(stand: BabysitterStand | null, jetzt: number): string {
  if (!stand?.active) return 'Licht und Ruhe für die Abläufe – wahlweise mit Frist';
  const rest = restText(stand, jetzt);
  return rest ? `Läuft noch ${rest}` : `Läuft${seitText(stand.since)} – ohne Frist`;
}
