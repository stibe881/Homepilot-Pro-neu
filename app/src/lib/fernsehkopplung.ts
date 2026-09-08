/**
 * Die Kopplung des Fernsehers – die Rechnerei dazu.
 *
 * Ein Android-TV-Gerät lässt sich nur fernbedienen, wenn es einmal eine
 * sechsstellige Zahl auf dem Bildschirm gezeigt hat und jemand sie
 * eingetippt hat. Das bleibt so und ist richtig: Wer den Fernseher
 * bedienen darf, soll ihn auch sehen können.
 *
 * Falsch war nur der Weg dorthin. Die Absage des Hubs lautete «die
 * Kopplung muss einmal am Gerät bestätigt werden (siehe Hub-Protokoll)»,
 * und im Protokoll stand ein Aufruf für die Kommandozeile des
 * Hub-Rechners. Gemeldet wurde es abends beim Einschlaf-Timer – da hat
 * niemand ein Terminal offen.
 */
import { Entity } from '../api/types';

/** So viele Stellen hat der Code auf dem Fernseher. */
export const CODE_LAENGE = 6;

/**
 * Fehlt diesem Gerät die Kopplung? (rein, testbar)
 *
 * Nur ein ausdrückliches «nein» des Hubs zählt. Fehlt der Wert ganz –
 * ältere Hub-Fassung, anderes Gerät –, wird nichts behauptet: Eine
 * Aufforderung zum Koppeln auf einer Hue-Lampe wäre schlimmer als gar
 * keine.
 */
export function brauchtKopplung(entity: Entity): boolean {
  return entity?.state?.paired === false;
}

/**
 * Was von der Tastatur als Code übrig bleibt (rein, testbar).
 *
 * Der Fernseher zeigt sechs Zeichen, gern als «A1B2C3»; getippt wird auf
 * einem Telefon, mit Leerzeichen und Kleinbuchstaben. Beides ist
 * derselbe Code – nur der Fernseher wäre anderer Meinung.
 */
export function codeSauber(text: string): string {
  return String(text ?? '')
    .replace(/[^0-9a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, CODE_LAENGE);
}

/** Darf der Knopf «Bestätigen» drücken? (rein, testbar) */
export function codeVollstaendig(text: string): boolean {
  return codeSauber(text).length === CODE_LAENGE;
}
