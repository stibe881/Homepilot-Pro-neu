/**
 * Das Einschaltverhalten nach Stromausfall (Punkt 630 der Werkbank).
 *
 * Kommt der Strom zurück, gehen die meisten Lampen von selbst an - um
 * drei Uhr nachts steht das Haus in vollem Licht. Der Auslöser «Nach
 * Stromausfall» räumt *nachher* auf; das hier verhindert den Blitz
 * *vorher*: Die Einstellung steckt im Leuchtmittel selbst, und der Hub
 * stellt sie über `set_power_on {mode}` - bei Zigbee
 * (`power_on_behavior`), Hue (`powerup`) und Homematic (`putParamset
 * MASTER`). Der Stand steht als `power_on` im Zustand.
 *
 * Drei Wörter für alle drei Anbindungen: `previous`, `off`, `on`. Was
 * ein Gerät sonst noch kennt (Umschalten), meldet der Hub als `other`.
 */
import { Entity } from '../api/types';

export type Einschalten = 'previous' | 'off' | 'on';

export const EINSCHALT_WAHL: { key: Einschalten; label: string }[] = [
  { key: 'previous', label: 'Wie vorher' },
  { key: 'off', label: 'Aus' },
  { key: 'on', label: 'An' },
];

/** Das Wort zum gemeldeten Stand (rein, testbar). */
export function einschaltWort(value: unknown): string {
  const wahl = EINSCHALT_WAHL.find((eintrag) => eintrag.key === value);
  if (wahl) return wahl.label.toLowerCase();
  if (value === 'other') return 'anders eingestellt';
  return 'noch nicht gelesen';
}

/** Kennt dieses Gerät ein Einschaltverhalten, das der Hub stellen kann? (rein, testbar) */
export function kannEinschalten(entity: Entity): boolean {
  return entity.commands.includes('set_power_on');
}

/**
 * Die Lampen des Hauses, nach Stromausfall sortiert (rein, testbar).
 *
 * Für den Knopf unter System: `umzustellen` sind die, die nach einem
 * Ausfall etwas anderes täten als «wie vorher» - oder deren Stand der
 * Hub noch nicht kennt. `koennenNicht` sind die Lampen, denen die
 * Anbindung den Schalter nicht gibt; die Liste sagt, wo man es am
 * Gerät selbst einstellen muss. Gezählt werden Lichter, nicht
 * Steckdosen: Ein Kühlschrank an der Messsteckdose soll nach dem
 * Ausfall wieder laufen.
 */
export function lampenNachStromausfall(entities: Entity[]): {
  stellbar: Entity[];
  umzustellen: Entity[];
  koennenNicht: Entity[];
} {
  const lampen = entities.filter(
    (entity) => entity.kind === 'light' && !entity.combined_into
  );
  const stellbar = lampen.filter(kannEinschalten);
  return {
    stellbar,
    umzustellen: stellbar.filter((entity) => entity.state?.power_on !== 'previous'),
    koennenNicht: lampen.filter((entity) => !kannEinschalten(entity)),
  };
}

/** Der Satz über dem Knopf (rein, testbar). */
export function stromausfallSatz(stellbar: number, umzustellen: number): string {
  if (stellbar === 0) return 'Keine Lampe im Haus lässt sich vom Hub aus einstellen.';
  if (umzustellen === 0) {
    return stellbar === 1
      ? 'Die eine Lampe bleibt nach einem Stromausfall, wie sie war.'
      : `Alle ${stellbar} Lampen bleiben nach einem Stromausfall, wie sie waren.`;
  }
  return `${umzustellen} von ${stellbar} Lampen ${
    umzustellen === 1 ? 'ginge' : 'gingen'
  } nach einem Stromausfall an oder verhalten sich anders.`;
}
