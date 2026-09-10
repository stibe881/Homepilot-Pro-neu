/**
 * Woher eine Lampe im Ablauf ihre Helligkeit nimmt.
 *
 * Drei Möglichkeiten, und der Unterschied entscheidet, ob abends jemand
 * geblendet wird:
 *
 * - eine feste Prozentzahl,
 * - **nach der Raumhelligkeit**: ein Fühler sagt, wie dunkel es dort
 *   gerade ist (hub/core/light.py, brightness_from_lux),
 * - **nach der Tageszeit**: die Uhr entscheidet
 *   (hub/core/light.py, brightness_from_time).
 *
 * Bisher gab es nur die erste und - versteckt - die zweite: Sie stand
 * nur zur Wahl, wenn ein *Auslöser* des Ablaufs Lux misst. Ein Ablauf
 * «um 18:00 das Wohnzimmer an» hat gar keinen Melder, der auslöst, und
 * die halben Räume im Haus haben überhaupt keinen Fühler. Für die ist
 * die Uhr die einzige Auskunft, die immer da ist.
 *
 * Angeboten wird nur, was auch wirkt: Die Raumhelligkeit erscheint nur,
 * wenn irgendwo ein Fühler steht, der sie messen kann. Eine Wahl, die
 * nichts tut, ist schlimmer als eine fehlende.
 */
import { Entity } from '../api/types';

/** Schlüssel der beiden Knöpfe. Keine Prozentzahlen, kollidieren also
 *  mit keiner Stufe. */
export const NACH_RAUM = 'lux';
export const NACH_TAGESZEIT = 'uhr';
/** «Helligkeit lassen, wie sie war» - beim Umschalten die Vorgabe: Ein
 *  Taster, der die Lampe jedes Mal auf 50 % zwingt, nimmt einem das
 *  Dimmen von Hand wieder weg. */
export const UNVERAENDERT = '';

export type Helligkeitsquelle = 'zahl' | 'raum' | 'tageszeit';

/** Misst dieses Gerät die Umgebungshelligkeit? (rein, testbar) */
export function misstLux(entity: Entity): boolean {
  const wert = entity?.state?.illumination;
  return typeof wert === 'number' && Number.isFinite(wert);
}

/**
 * Steht im Raum dieser Lampe ein Helligkeitsfühler? (rein, testbar)
 *
 * Der zweite Weg zu einem Messwert - der erste sind die Auslöser des
 * Ablaufs. Gefragt wird der Raum, in dem die Lampe steht: Ein Fühler
 * zwei Zimmer weiter sagt nichts über das Licht hier.
 */
export function raumHatLux(entities: Entity[], lampe: Entity): boolean {
  if (!lampe?.room) return false;
  return (entities ?? []).some(
    (entity) => entity.room === lampe.room && misstLux(entity)
  );
}

/**
 * Welche Quelle diese Aktion gerade benutzt (rein, testbar).
 *
 * Zwei Schalter statt einem Wort, weil `adaptive` schon im Entwurf und
 * in gespeicherten Abläufen steht: Ein Umbau darauf hätte jede
 * bestehende Lampe still auf «feste Zahl» zurückgesetzt.
 */
export function quelleVon(action: {
  adaptive?: boolean;
  nachTageszeit?: boolean;
}): Helligkeitsquelle {
  if (action?.adaptive) return 'raum';
  if (action?.nachTageszeit) return 'tageszeit';
  return 'zahl';
}

/**
 * Der Wert für die Chip-Reihe (rein, testbar).
 *
 * `standard` ist, was ohne eigene Angabe gilt: bei «ein, gedimmt» die
 * halbe Helligkeit (irgendeine Zahl muss die Lampe bekommen), beim
 * Umschalten dagegen «unverändert» - dort ist die Helligkeit eine
 * Zugabe, keine Pflicht.
 */
export function chipWert(
  action: {
    adaptive?: boolean;
    nachTageszeit?: boolean;
    brightness?: number;
  },
  standard = '50'
): string {
  const quelle = quelleVon(action);
  if (quelle === 'raum') return NACH_RAUM;
  if (quelle === 'tageszeit') return NACH_TAGESZEIT;
  return action?.brightness === undefined ? standard : String(action.brightness);
}

/**
 * Was ein Tipp auf einen Chip am Entwurf ändert (rein, testbar).
 *
 * Die beiden Quellen schliessen einander aus - und beide müssen beim
 * Wechsel auf eine Zahl weg, sonst gewänne die alte Wahl beim
 * Speichern gegen die neue Prozentzahl.
 */
export function chipWahl(key: string): {
  adaptive?: boolean;
  nachTageszeit?: boolean;
  brightness?: number;
} {
  if (key === NACH_RAUM) return { adaptive: true, nachTageszeit: undefined };
  if (key === NACH_TAGESZEIT) return { adaptive: undefined, nachTageszeit: true };
  // `Number('')` wäre 0 - eine Lampe, die auf null Prozent «angeht».
  if (key === UNVERAENDERT) {
    return { adaptive: undefined, nachTageszeit: undefined, brightness: undefined };
  }
  return { adaptive: undefined, nachTageszeit: undefined, brightness: Number(key) };
}

/** Die Stufen und die beiden Quellen, in dieser Reihenfolge (rein, testbar). */
export function helligkeitsOptionen(
  raumMoeglich: boolean,
  mitUnveraendert = false
): { key: string; label: string }[] {
  return [
    // Nur beim Umschalten: Dort ist die Helligkeit eine Zugabe zum
    // «geht an», und wer sie nicht angibt, will sie nicht angerührt
    // haben.
    ...(mitUnveraendert ? [{ key: UNVERAENDERT, label: 'Helligkeit lassen' }] : []),
    { key: '10', label: '10 %' },
    { key: '25', label: '25 %' },
    { key: '50', label: '50 %' },
    { key: '75', label: '75 %' },
    { key: '100', label: '100 %' },
    // Nur wo ein Fühler steht - sonst wäre die Wahl eine Attrappe.
    ...(raumMoeglich ? [{ key: NACH_RAUM, label: 'nach Raumhelligkeit' }] : []),
    // Die Uhr geht immer: Sie braucht kein Gerät.
    { key: NACH_TAGESZEIT, label: 'nach Tageszeit' },
  ];
}
