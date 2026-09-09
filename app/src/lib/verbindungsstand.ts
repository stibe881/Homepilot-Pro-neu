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
