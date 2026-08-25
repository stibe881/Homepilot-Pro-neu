/**
 * Der Einschlaf-Timer des Fernsehers – die Rechnerei dazu.
 *
 * Herausgelöst aus der Kachel, weil derselbe Timer jetzt an drei Stellen
 * auftaucht: auf der Fernsehkachel, im Favoriten-Chip auf der Startseite
 * und im Fenster, das dieser Chip öffnet. Drei Stellen, die dasselbe
 * ausrechnen, sind zwei zu viel.
 *
 * Der Timer selbst läuft im Hub, nicht hier: Wer einschläft, sperrt sein
 * Telefon, und ein Timer, der davon abhinge, wäre keiner. Von dort kommt
 * ein Zeitpunkt – gerechnet wird daraus.
 */
import { Entity } from '../api/types';
import { dauerText } from './format';

/** Vorgabe, falls der Hub noch keine Liste mitschickt (ältere Fassung). */
export const FALLBACK_MINUTEN = [30, 60, 90, 120, 150];

/**
 * Verbleibende Minuten aus dem Zeitpunkt des Hubs (rein, testbar).
 *
 * Aufgerundet: Solange etwas läuft, soll auch etwas dastehen – «0 min»
 * neben einem laufenden Timer liest sich wie ein Fehler. `null` heisst:
 * kein Timer.
 */
export function restMinuten(sleepUntil: unknown, jetzt: number): number | null {
  const bis = typeof sleepUntil === 'number' ? sleepUntil * 1000 : null;
  if (bis === null) return null;
  const rest = bis - jetzt;
  if (rest <= 0) return null;
  return Math.max(1, Math.ceil(rest / 60000));
}

/** Kann dieses Gerät einen Einschlaf-Timer? (rein, testbar) */
export function kannTimer(entity: Entity): boolean {
  return entity.commands.includes('sleep_timer');
}

/** Welche Zeiten zur Auswahl stehen (rein, testbar). */
export function timerAuswahl(entity: Entity): number[] {
  const roh = entity.state.sleep_minutes;
  if (!Array.isArray(roh)) return FALLBACK_MINUTEN;
  const zahlen = roh.filter((m: unknown): m is number => typeof m === 'number');
  return zahlen.length > 0 ? zahlen : FALLBACK_MINUTEN;
}

/**
 * Was auf dem Favoriten-Chip steht (rein, testbar).
 *
 * Der Chip zeigte «An» oder «Aus» – richtig, aber nicht das, wonach man
 * abends schaut. Läuft ein Timer, ist die Restzeit die Auskunft, für die
 * man überhaupt hinsieht.
 */
export function chipZeile(entity: Entity, jetzt: number): string {
  const rest = restMinuten(entity.state.sleep_until, jetzt);
  if (rest !== null) return `Aus in ${dauerText(rest)}`;
  return String(entity.state.state ?? '') === 'on' ? 'An' : 'Aus';
}

/**
 * Die Zeile über den Knöpfen im Timer-Fenster (rein, testbar).
 *
 * Sie beantwortet die Frage, mit der man das Fenster öffnet: Läuft schon
 * einer, und wie lange noch?
 */
export function fensterZeile(entity: Entity, jetzt: number): string {
  const rest = restMinuten(entity.state.sleep_until, jetzt);
  if (rest === null) return 'Kein Timer gestellt';
  return `Der Fernseher geht in ${dauerText(rest)} aus`;
}
