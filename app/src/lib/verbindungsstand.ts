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
  paused: 'pausiert',
};

/** Grün, gelb, rot - dieselbe Ampel wie in der Begrüssungskarte. */
export function verbindungsFarbe(colors: Colors, status: ConnectionStatus): string {
  if (status === 'connected') return colors.on;
  // Feierabend ist kein Fehler: Das Kind sieht eine Pause, kein rotes
  // Licht (Punkt 624 der Werkbank).
  if (status === 'connecting' || status === 'paused') return colors.warn;
  return colors.danger;
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
/** Gültiges Token, aber ausserhalb des Zeitfensters (Punkt 624 der
 *  Werkbank). Im Grund steht als ISO-Zeit, ab wann es wieder gilt. */
export const CODE_FENSTER_ZU = 4403;

/** Länger wartet die App zwischen zwei Versuchen nie. */
export const WARTEZEIT_MAX_MS = 15000;
/** Was gilt, wenn der Hub eine Zeit nennt, die nicht zu lesen ist -
 *  oder eine, die schon vorbei ist: in einer Minute noch einmal. */
const FALLBACK_MS = 60000;

export interface NachSchliessen {
  status: 'disconnected' | 'signed_out' | 'paused';
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
 * `code` und `reason` kommen aus dem Close-Ereignis; ein HTTP-401 des
 * Clients meldet sich mit demselben Code 4401, ein 403 mit `gilt_ab`
 * als 4403 - dieselbe Entscheidung für beide Wege.
 *
 * - 4401: abgemeldet, kein Wiederverbinden. Der nächste Versuch
 *   bekäme dieselbe Antwort; zurück führt nur eine neue Anmeldung.
 * - 4403: pausiert bis zur genannten Zeit, dann wieder verbinden
 *   (Punkt 624). Ist die Zeit nicht lesbar oder schon vorbei, in
 *   einer Minute - besser als nie.
 * - alles andere: getrennt, wieder nach der üblichen Wartezeit.
 */
export function nachSchliessen(
  code: number | undefined,
  reason: string | undefined,
  versuch: number,
  jetzt: number
): NachSchliessen {
  if (code === CODE_ABGEMELDET) return { status: 'signed_out', wiederAb: null };
  if (code === CODE_FENSTER_ZU) {
    const ab = Date.parse(String(reason ?? ''));
    const wiederAb = Number.isFinite(ab) && ab > jetzt ? ab : jetzt + FALLBACK_MS;
    return { status: 'paused', wiederAb };
  }
  return { status: 'disconnected', wiederAb: jetzt + wartezeit(versuch) };
}

/**
 * Der Satz auf dem ruhigen Blatt ausserhalb des Zeitfensters (rein,
 * testbar). Punkt 624 der Werkbank.
 *
 * «Gute Nacht - ab 07:00 geht's weiter»: Das Kind um 20:01 sieht
 * Feierabend, kein kaputtes Haus. Liegt der Zeitpunkt mehr als einen
 * Tag voraus - die Putzhilfe am Freitag, deren Fenster erst am
 * Donnerstag wieder aufgeht -, steht das Datum dabei; «ab 08:00»
 * hiesse sonst morgen früh.
 */
export function pausenSatz(wiederAb: number | null, jetzt: number): string {
  if (wiederAb === null) return 'Gerade ausserhalb der Zugangszeit.';
  const ab = new Date(wiederAb);
  const zeit = ab.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  const wann =
    wiederAb - jetzt > 24 * 3600 * 1000
      ? `${ab.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' })} ${zeit}`
      : zeit;
  return `Gute Nacht - ab ${wann} geht's weiter.`;
}

// ── Ob die Verbindung noch trägt ─────────────────────────────────────────
//
// Punkt 592 der Werkbank: Das iPad im Flur geht nie in den Hintergrund.
// Nach einem Neustart des Accesspoints oder einem NAT-Timeout bleibt sein
// Socket halboffen - der Punkt grün, der Stand alt, und ein Tipp endet
// nach sechs Sekunden in «antwortet nicht», ohne dass je neu verbunden
// würde. Ein Ping im Takt deckt das auf; bleibt der Pong aus, ist die
// Verbindung tot, und die App baut sie neu.

/** So oft fragt die App nach, solange sie verbunden ist. */
export const PING_INTERVALL_MS = 30000;
/** So lange darf der Pong ausbleiben. Zehn Sekunden: Ein Hub, der
 *  gerade einen Schwall Zustände verarbeitet, antwortet darunter; ein
 *  toter Socket antwortet nie. */
export const PONG_FRIST_MS = 10000;

/**
 * Ist der Pong zum Ping ausgeblieben? (rein, testbar)
 *
 * `pongAt` ist der letzte empfangene Pong. Ein älterer als der Ping
 * zählt nicht - er hat eine frühere Frage beantwortet.
 */
export function pongAusgeblieben(pingAt: number, pongAt: number | null): boolean {
  return pongAt === null || pongAt < pingAt;
}
