/**
 * Was das Klingel-Vollbild anbietet, und wie lange es stehen bleibt.
 *
 * Wer klingelt, steht vor der Haustüre – aber hineinkommen muss er
 * durch zwei: unten die Haustüre, oben die Wohnungstüre. Bisher bot das
 * Vollbild nur die erste an, und für die zweite musste man das Bild
 * wegwischen und in den Geräten suchen, während der Besuch im
 * Treppenhaus wartet.
 */
import { Entity } from '../api/types';

/** So lange bleibt das Vollbild stehen, wenn niemand etwas tut.
 *
 *  Es von Hand wegwischen zu müssen ist die schlechtere Vorgabe: Am
 *  Wandpanel bliebe sonst ein Kamerabild der Strasse stehen, bis es
 *  jemand bemerkt. */
export const AUTO_SCHLIESSEN_SEKUNDEN = 60;

/** Welcher Befehl diese Türe tatsächlich öffnet (rein, testbar).
 *
 *  Die Reihenfolge ist kein Geschmack: `unlock` macht bei einem Nuki
 *  bloss den Riegel auf, die Türe bleibt zu. Wer im Treppenhaus steht,
 *  kommt erst mit `unlatch` herein – die Falle wird gezogen. */
export function oeffnungsBefehl(entity: Entity): string | null {
  for (const befehl of ['open_door', 'unlatch', 'unlock']) {
    if (entity.commands.includes(befehl)) return befehl;
  }
  return null;
}

/** Ob dieser Befehl die Türe wirklich aufmacht oder nur entriegelt. */
export function befehlLabel(entity: Entity): string {
  const befehl = oeffnungsBefehl(entity);
  return befehl === 'unlock' ? `${entity.name} entriegeln` : `${entity.name} öffnen`;
}

/**
 * Die Türen, die beim Klingeln zur Auswahl stehen (rein, testbar).
 *
 * Zuerst die Türe der Klingel selbst – sie gehört zum Bild, das man
 * gerade ansieht. Danach die übrigen, denn die Wohnungstüre steht
 * nirgends als «zur Klingel gehörig» geschrieben.
 *
 * Höchstens drei: Ein Vollbild mit sieben Knöpfen ist keine Hilfe,
 * sondern eine Suchaufgabe unter Zeitdruck.
 */
export function tuerenFuerKlingel(entities: Entity[], camera?: Entity): Entity[] {
  const tueren = entities.filter(
    (entity) => entity.kind === 'lock' && oeffnungsBefehl(entity) !== null
  );
  const eigene = (entity: Entity) =>
    !!camera &&
    (entity.integration === camera.integration ||
      (!!entity.room && entity.room === camera.room));
  return [...tueren.filter(eigene), ...tueren.filter((entity) => !eigene(entity))].slice(
    0,
    3
  );
}

/** Wie viele Sekunden noch bleiben (rein, testbar).
 *
 *  Aus der Uhr gerechnet, nicht aus gezählten Takten: Der Takt der App
 *  hält an, solange sie im Hintergrund ist. Wer eine halbe Stunde später
 *  zurückkommt, hätte sonst noch 59 Sekunden vor sich. */
export function restSekunden(frist: number, jetzt: number): number {
  return Math.max(0, Math.ceil((frist - jetzt) / 1000));
}

/** Der Zeitpunkt, an dem das Vollbild von selbst geht. */
export function neueFrist(jetzt: number): number {
  return jetzt + AUTO_SCHLIESSEN_SEKUNDEN * 1000;
}
