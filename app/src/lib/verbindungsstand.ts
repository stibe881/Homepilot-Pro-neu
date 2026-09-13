/**
 * Wie der Verbindungszustand heisst und aussieht (rein, testbar).
 *
 * Die Wörter standen in components/TopStrip.tsx, wo sie die Ecke der
 * Begrüssungskarte füllen. Seit die Verbindungen-Seite oben dieselbe
 * Auskunft gibt, gehören sie an einen Ort: Zwei Fassungen davon hiessen,
 * dass die Karte «verbunden» sagt, während die Seite «bereit» sagt.
 */
import type { ConnectionStatus } from '../hooks/useHub';
import type { Colors } from '../theme';

export const VERBINDUNGSWORT: Record<ConnectionStatus, string> = {
  connected: 'verbunden',
  connecting: 'verbinde …',
  disconnected: 'getrennt',
  signed_out: 'abgemeldet',
};

/** Grün, gelb, rot - dieselbe Ampel wie in der Begrüssungskarte. */
export function verbindungsFarbe(colors: Colors, status: ConnectionStatus): string {
  if (status === 'connected') return colors.on;
  return status === 'connecting' ? colors.warn : colors.danger;
}

/**
 * Was in der Kopfzeile neben dem Punkt steht - meist nichts
 * (rein, testbar).
 *
 * Das Wort ist dort weg. «verbunden» stand neunundneunzig Prozent der
 * Zeit da und sagte dasselbe wie der grüne Punkt daneben - zwei
 * Zeichen für eine Auskunft, und ausgerechnet die langweiligste nahm
 * den meisten Platz in der Ecke der Begrüssungskarte.
 *
 * Die Wartezahl bleibt, und zwar aus dem Grund, aus dem sie
 * hinzukam: Ohne sie ist ein Tipp im Funkloch nicht von einem
 * verschluckten Befehl zu unterscheiden - beides sieht nach «nichts
 * passiert» aus. Sie ist keine Zustandsbeschreibung, sondern eine
 * Zahl, die man sonst nirgends bekommt.
 */
export function verbindungsZusatz(queued: number): string {
  const wartend = Math.max(0, Math.round(Number(queued) || 0));
  return wartend > 0 ? `${wartend} wartet` : '';
}

/**
 * Was die Vorlesefunktion sagt (rein, testbar).
 *
 * Der Punkt trägt die Auskunft jetzt allein - für das Auge. Wer
 * vorlesen lässt oder Farben schlecht unterscheidet, hätte sonst gar
 * nichts: Ein farbiger Kreis ohne Beschriftung ist für VoiceOver eine
 * leere Fläche. Darum wandert das Wort hierher.
 */
export function verbindungsAnsage(status: ConnectionStatus, queued: number): string {
  const zusatz = verbindungsZusatz(queued);
  return zusatz ? `${VERBINDUNGSWORT[status]} · ${zusatz}` : VERBINDUNGSWORT[status];
}

// ── Was nach dem Schliessen der Verbindung gilt ──────────────────────────
//
// Punkt 579 der Werkbank: Der Hub schliesst den WebSocket mit einem
// Code, und die App las ihn nie. Ein Gerät, das unter «Meine Geräte»
// beendet wurde, verband darum in Endlosschleife neu und sagte dabei
// «Keine Verbindung» - obwohl der Hub erreichbar war und gerade sehr
// deutlich geantwortet hatte. Hier steht, was jeder Code bedeutet;
// der Hub vergibt sie in api/server.py.

/** Das Token gilt nicht (mehr): beendet, widerrufen, Passwort gewechselt. */
export const CODE_ABGEMELDET = 4401;

/** Länger wartet die App zwischen zwei Versuchen nie. */
export const WARTEZEIT_MAX_MS = 15000;

export interface NachSchliessen {
  status: 'disconnected' | 'signed_out';
  /** Wann die App wieder verbindet (ms seit 1970) - null: gar nicht. */
  wiederAb: number | null;
}

/**
 * Wie lange bis zum nächsten Versuch (rein, testbar).
 *
 * Verdoppelnd ab einer Sekunde, gedeckelt: Ein Hub, der gerade neu
 * startet, ist nach wenigen Sekunden zurück; ein Hub, der weg bleibt,
 * soll das Telefon nicht im Sekundentakt beschäftigen.
 */
export function wartezeit(versuch: number): number {
  return Math.min(WARTEZEIT_MAX_MS, 1000 * 2 ** Math.max(0, versuch));
}

/**
 * Was nach einem geschlossenen Socket gilt (rein, testbar).
 *
 * `code` kommt aus dem Close-Ereignis; ein HTTP-401 des Clients meldet
 * sich mit demselben Code 4401 - dieselbe Entscheidung für beide Wege.
 *
 * - 4401: abgemeldet, kein Wiederverbinden. Der nächste Versuch
 *   bekäme dieselbe Antwort; zurück führt nur eine neue Anmeldung.
 * - alles andere: getrennt, wieder nach der üblichen Wartezeit.
 */
export function nachSchliessen(
  code: number | undefined,
  versuch: number,
  jetzt: number
): NachSchliessen {
  if (code === CODE_ABGEMELDET) return { status: 'signed_out', wiederAb: null };
  return { status: 'disconnected', wiederAb: jetzt + wartezeit(versuch) };
}
