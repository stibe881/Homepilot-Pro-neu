/**
 * Wie sich eine Taste der Fernbedienung anfühlt.
 *
 * Eine Fernbedienung bedient man, ohne hinzusehen – im Dunkeln, mit dem
 * Telefon halb in der Hand. Ohne Rückmeldung weiss man nicht, ob der
 * Druck ankam, und drückt zweimal; beim Steuerkreuz springt die Auswahl
 * dann zwei Felder weiter.
 *
 * Zwei Stärken, weil eine Fernbedienung zweierlei Tasten hat: Das
 * Steuerkreuz drückt man in Serie, fünfmal nach unten durch ein Menü –
 * da will man ein feines Ticken, kein Stampfen. «OK» und die
 * Ein-/Aus-Taste sind Entscheidungen, und die dürfen sich schwerer
 * anfühlen. Genau das unterscheidet eine echte Fernbedienung von einer
 * Fläche aus Knöpfen.
 *
 * Nur die Zuordnung steht hier; das Auslösen selbst in lib/haptics.ts.
 */

export type Staerke = 'leicht' | 'kraeftig';

/** Tasten, die eine Entscheidung sind – nicht eine von vielen in Serie. */
const KRAEFTIG: readonly string[] = ['ok', 'toggle', 'turn_on', 'turn_off'] as const;

/** Wie stark darf es sich anfühlen? (rein, testbar) */
export function tastenStaerke(command: string): Staerke {
  return KRAEFTIG.includes(command) ? 'kraeftig' : 'leicht';
}
