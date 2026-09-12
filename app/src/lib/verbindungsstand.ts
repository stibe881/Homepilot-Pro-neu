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
