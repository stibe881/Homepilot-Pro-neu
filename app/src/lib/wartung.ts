/**
 * Wartungen: wie dringend, und wer sie zuletzt gemacht hat.
 *
 * Herausgelöst aus components/Maintenance.tsx – dort lässt sich nichts
 * prüfen: Die Datei zieht die Symbolschriften von Expo mit, und Jest
 * lädt sie deshalb nicht (dieselbe Lehre wie bei lib/batterien.ts).
 *
 * Die Quittung ist der Punkt: «Erledigt» ohne Namen ist in einem
 * Haushalt mit drei Leuten eine Behauptung. Danach weiss niemand, ob
 * der Filter gewechselt wurde oder ob jemand nur die Meldung
 * weggedrückt hat – und beim nächsten Mal ist «wann war das eigentlich
 * zuletzt?» genau die Frage, die man nicht beantworten kann.
 */

export interface Quittung {
  at: string;
  by?: string | null;
}

export interface Wartungszeile {
  id: string;
  text: string;
  interval_days: number;
  due: string;
  last_done?: string | null;
  last_by?: string | null;
  log?: Quittung[];
  days_left?: number;
}

/** Wie dringend es ist – in Worten (rein, testbar). */
export function faelligText(item: Wartungszeile): string {
  const tage = item.days_left;
  if (typeof tage !== 'number') return `fällig am ${datumKurz(item.due)}`;
  if (tage < 0) return `seit ${Math.abs(tage)} Tagen fällig`;
  if (tage === 0) return 'heute fällig';
  return `in ${tage} Tagen`;
}

/** «27.08.2026» aus «2026-08-27» (rein, testbar).
 *
 *  Der Hub schickt Tagesdaten als ISO-Text. Der ist eindeutig und
 *  sortierbar – aber niemand liest so ein Datum vor. */
export function datumKurz(iso: string | null | undefined): string {
  const text = String(iso ?? '').slice(0, 10);
  const teile = text.split('-');
  if (teile.length !== 3) return text;
  return `${teile[2]}.${teile[1]}.${teile[0]}`;
}

/**
 * Die Quittung in einem Satz (rein, testbar).
 *
 * Leer, wenn es noch keine gibt: «noch nie erledigt» stünde bei jeder
 * frisch angelegten Wartung und wäre dort keine Auskunft, sondern eine
 * Verlegenheit – die erste Frist zählt ohnehin ab dem Anlegen.
 */
export function quittungSatz(item: Wartungszeile): string {
  const letzte = item.log?.[0];
  const wann = letzte?.at ?? item.last_done;
  if (!wann) return '';
  const wer = letzte?.by ?? item.last_by;
  return wer ? `zuletzt ${datumKurz(wann)} · ${wer}` : `zuletzt ${datumKurz(wann)}`;
}

/**
 * Die Quittungen davor, als eine Zeile (rein, testbar).
 *
 * Der Abstand ist die eigentliche Auskunft: Ein Filter, der zweimal im
 * Jahr gewechselt wurde, obwohl er ein halbes Jahr halten soll, sagt
 * etwas über das Wasser – und nicht über den Filter.
 */
export function frueherSatz(item: Wartungszeile): string {
  const frueher = (item.log ?? []).slice(1);
  if (frueher.length === 0) return '';
  return `davor: ${frueher
    .map((eintrag) => (eintrag.by ? `${datumKurz(eintrag.at)} (${eintrag.by})` : datumKurz(eintrag.at)))
    .join(', ')}`;
}
