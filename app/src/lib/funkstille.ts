/**
 * «Nicht erreichbar» heisst nicht überall dasselbe.
 *
 * Bei einer Lampe am Netz heisst es: Der Hub kommt nicht hin, Drücken
 * bringt nichts. Bei einer Store am Funk (io-homecontrol, RTS) heisst es
 * bloss: Sie hat sich länger nicht gemeldet. Empfangen kann sie
 * trotzdem - genau deshalb funktioniert die Handfernbedienung an einer
 * Store, die in der TaHoma-App als nicht erreichbar steht.
 *
 * Der Hub schickt den Befehl in beiden Fällen hinaus; einen Riegel auf
 * die Verfügbarkeit gibt es nirgends. Nur die Beschriftung behauptete
 * das Gegenteil und hielt Leute davon ab, es überhaupt zu versuchen.
 */

/** Integrationen, bei denen «still» nicht «taub» heisst. */
export const FUNK_INTEGRATIONEN = ['overkiz'];

export function offlineSatz(
  entity: { integration: string; commands: string[] },
  zuletzt: string | null,
): string {
  const funk =
    FUNK_INTEGRATIONEN.includes(entity.integration) && entity.commands.length > 0;
  const kopf = funk ? 'meldet sich nicht · steuern geht trotzdem' : 'nicht erreichbar';
  return zuletzt ? `${kopf} · zuletzt ${zuletzt}` : kopf;
}
