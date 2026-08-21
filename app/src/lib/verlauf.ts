import { epochAgo } from './zeit';

/** Wie weit das Gedächtnis des Hubs zurückreicht. */
export interface LogSpan {
  started: number;
  oldest: number | null;
  count: number;
  limit: number;
  full: boolean;
}

/**
 * Der Satz unter der Liste: bis wann reicht sie, und warum nicht weiter?
 * (rein, testbar)
 *
 * Ohne ihn ist eine kurze Liste nicht zu deuten – «zwei Einträge» heisst
 * entweder «hier passiert wenig» oder «der Hub lief erst zehn Minuten».
 * Ist der Ringpuffer voll, ist der Anfang nicht mehr der Start des Hubs,
 * sondern die Kante des Puffers; älteres ist dann endgültig weg, und das
 * soll dastehen statt stillschweigend zu fehlen.
 */
export function reichweiteText(span: LogSpan | null, jetzt = Date.now()): string {
  if (!span) return '';
  const seit = epochAgo(span.full && span.oldest ? span.oldest : span.started, jetzt);
  if (!seit) return '';
  return span.full
    ? `Das Protokoll reicht ${seit} zurück – ältere Einträge sind aus dem Speicher gefallen.`
    : `Das Protokoll läuft seit dem Start des Hubs ${seit} und beginnt nach jedem Neustart leer.`;
}
