/**
 * Der Doppeldosis-Schutz beim Abhaken einer Gabe.
 *
 * Der gefährliche Fall ist nicht das doppelte Häkchen – das zweite
 * Tippen nimmt das erste ja zurück. Gefährlich ist die Reihenfolge
 * «abgehakt, versehentlich zurückgenommen, von jemand anderem wieder
 * abgehakt»: Für die dritte Person sieht die Gabe offen aus, und das
 * Kind bekommt das Antibiotikum zweimal.
 *
 * Das Protokoll der Gaben (med.log) weiss davon: Steht dort für
 * denselben Tag und dieselbe Gabe schon ein Abhaken, fragt die App
 * nach, statt still zu quittieren. Nachfragen, nicht verbieten –
 * vielleicht war das Zurücknehmen ja richtig, weil zu früh getippt.
 */

export interface GabenEintrag {
  day?: string;
  slot?: string;
  by?: string;
  at?: string;
  /** true, wenn dieses Tippen ein Häkchen zurückgenommen hat. */
  undo?: boolean;
}

/** Das letzte echte Abhaken dieser Gabe heute – oder null (rein, testbar). */
export function fruehereGabe(
  log: GabenEintrag[] | undefined,
  day: string,
  slot: string
): GabenEintrag | null {
  const treffer = (log ?? []).filter(
    (eintrag) => eintrag.day === day && eintrag.slot === slot && !eintrag.undo
  );
  return treffer.length > 0 ? treffer[treffer.length - 1] : null;
}

/**
 * Die Rückfrage vor dem Abhaken – oder null, wenn nichts dagegen
 * spricht (rein, testbar).
 *
 * Nur wenn die Gabe gerade *offen* aussieht: Ein sichtbares Häkchen
 * zurückzunehmen ist ein bewusster Griff und braucht keine Frage.
 */
export function doppeldosisFrage(
  log: GabenEintrag[] | undefined,
  day: string,
  slot: string,
  schon: boolean
): string | null {
  if (schon) return null;
  const vorher = fruehereGabe(log, day, slot);
  if (!vorher) return null;
  const uhr = vorher.at
    ? new Date(vorher.at).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
    : null;
  const wer = vorher.by || 'Jemand';
  return (
    `${wer} hat «${slot}» heute${uhr ? ` um ${uhr}` : ''} schon abgehakt - ` +
    'das Häkchen wurde danach zurückgenommen. Wirklich noch einmal geben?'
  );
}
