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

/**
 * Was unter dem Namen des Fernsehers steht (rein, testbar).
 *
 * Drei Zustände, drei verschiedene nächste Schritte - und der
 * Unterschied zwischen den letzten beiden ist genau der, den die Absage
 * im Hub schon macht (integrations/androidtv.py, absage): Ein nicht
 * gekoppelter Fernseher braucht einen Menschen davor, ein nicht
 * erreichbarer nur Strom und Netz.
 */
export function kopplungsZeile(entity: Entity): string {
  if (entity?.state?.paired === false) return 'Nicht gekoppelt';
  return entity?.available === false ? 'Gekoppelt · gerade nicht erreichbar' : 'Gekoppelt';
}

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
 * Zwei Bedingungen, und die zweite kam aus dem Haus: «Weshalb sind hier
 * die Timer auch vorhanden zum Koppeln?»
 *
 * 1. Der Hub führt `paired` - das setzt einzig die Android-TV-
 *    Integration, und zwar auf **jedem** ihrer Geräte. Absichtlich:
 *    Auch die Einschlaf-Timer-Kachel soll sagen können, dass die
 *    Kopplung fehlt, denn dort fällt es abends auf.
 * 2. Es ist der Fernseher selbst (`media_player`) und nicht sein
 *    Timer. Gekoppelt wird das Gerät, nicht seine Funktionen - der
 *    Timer hängt an derselben Kopplung wie die Fernbedienung. Auf der
 *    Verbindungen-Seite standen sonst vier Karten für zwei Fernseher,
 *    jede mit «Fernseher koppeln», und man suchte den Unterschied
 *    zwischen «Fernseher Wohnzimmer» und «Fernseher Wohnzimmer Timer».
 *
 * Der Grund für diese zweite Frage überhaupt: Zuerst gab es nur
 * `brauchtKopplung`, und damit stand «Fernseher koppeln» ausschliesslich
 * da, wo der Hub die Kopplung schon als abgelehnt erlebt hatte. Aus dem
 * Haus kam prompt «Wo finde ich nun das Verbinden zu einem Android TV?»
 * - zu Recht: Ein Weg, den man nur sieht, wenn es bereits zu spät ist,
 * ist keiner. Und es gibt den Fall, in dem der Fernseher verbindet und
 * trotzdem keine Taste wirkt (Daten des Remote-Dienstes am Gerät
 * gelöscht); dann steht `paired` auf «ja» und man käme sonst nie an den
 * Ausweg.
 */
export function kannKoppeln(entity: Entity): boolean {
  return typeof entity?.state?.paired === 'boolean' && entity.kind === 'media_player';
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
