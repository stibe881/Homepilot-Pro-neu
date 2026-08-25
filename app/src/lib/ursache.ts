/**
 * «Warum ist das an?»
 *
 * Die Frage stellt man um drei Uhr nachts im Flur, nicht am Schreibtisch.
 * Die Antwort stand bisher im Verlauf – ein Abruf und zwei Griffe weiter.
 * Seit der Hub sie am Zustand mitführt (`last_change`, `last_source`),
 * steht sie da, wo man das Gerät ohnehin in der Hand hat.
 *
 * Absichtlich ein Satzteil und kein Datum: «vor 20 Minuten durch Ablauf
 * «Bewegung Flur»» beantwortet die Frage; «1787694063.7» nicht.
 */

/** Was der Hub am Zustand mitführt. */
export interface Quelle {
  kind?: string | null;
  label?: string | null;
}

/** Wer war es – als lesbarer Satzteil (rein, testbar).
 *
 *  Dieselben Worte wie im Verlauf (components/EntityHistory.tsx): Wer
 *  beides sieht, soll nicht zweimal dasselbe in anderen Worten lesen. */
export function quellenWort(quelle: Quelle | null | undefined): string {
  const kind = quelle?.kind ?? '';
  const label = quelle?.label ?? '';
  if (kind === 'user') return label || 'Benutzer';
  if (kind === 'automation') return `Ablauf «${label}»`;
  if (kind === 'scene') return `Szene «${label}»`;
  if (kind === 'simulation') return label || 'Anwesenheitssimulation';
  // Ohne Quelle kam der Wechsel nicht über den Hub: Wandschalter,
  // Hersteller-App oder eine Zeitschaltung im Gerät selbst.
  return 'am Gerät / von aussen';
}

/** Wie lange das schon so ist (rein, testbar). */
export function seitWann(sekunden: number): string {
  if (sekunden < 90) return 'gerade eben';
  const minuten = Math.round(sekunden / 60);
  if (minuten < 60) return `seit ${minuten} Min`;
  const stunden = Math.round(minuten / 60);
  if (stunden < 24) return `seit ${stunden} Std`;
  const tage = Math.round(stunden / 24);
  return tage === 1 ? 'seit gestern' : `seit ${tage} Tagen`;
}

/**
 * Die ganze Antwort – oder nichts (rein, testbar).
 *
 * Nichts, solange der Hub keinen Wechsel gesehen hat: Nach einem
 * Neustart ist das Gedächtnis leer, und «gerade eben, am Gerät» wäre
 * dann eine Behauptung über etwas, das der Hub gar nicht miterlebt hat.
 */
export function ursacheSatz(
  entity: { last_change?: number | null; last_source?: Quelle | null },
  jetzt: number
): string | null {
  if (!entity.last_change) return null;
  const alter = Math.max(0, jetzt / 1000 - entity.last_change);
  return `${seitWann(alter)} · ${quellenWort(entity.last_source)}`;
}
