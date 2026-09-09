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
 * Lässt sich dieses Gerät überhaupt koppeln? (rein, testbar)
 *
 * Am Vorhandensein des Schlüssels, nicht an seinem Wert: `paired` setzt
 * einzig die Android-TV-Integration, und zwar auf jedem ihrer Geräte.
 *
 * Der Grund für diese zweite Frage: Zuerst gab es nur `brauchtKopplung`,
 * und damit stand «Fernseher koppeln» ausschliesslich da, wo der Hub die
 * Kopplung schon als abgelehnt erlebt hatte. Aus dem Haus kam prompt
 * «Wo finde ich nun das Verbinden zu einem Android TV?» - zu Recht: Ein
 * Weg, den man nur sieht, wenn es bereits zu spät ist, ist keiner. Und
 * es gibt den Fall, in dem der Fernseher verbindet und trotzdem keine
 * Taste wirkt (Daten des Remote-Dienstes am Gerät gelöscht); dann steht
 * `paired` auf «ja» und man käme sonst nie an den Ausweg.
 */
export function kannKoppeln(entity: Entity): boolean {
  return typeof entity?.state?.paired === 'boolean';
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
