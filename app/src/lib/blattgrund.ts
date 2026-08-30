import { Entity } from '../api/types';

/**
 * Woran ein Blatt hängen darf – und woran nie (alle rein, testbar).
 *
 * Ein Blatt (Modal) verschwindet in dem Moment, in dem die Bedingung
 * falsch wird, unter der es im Baum steht. Steht dort etwas, das sich im
 * Betrieb ändert, räumt sich das offene Blatt selbst ab und baut sich
 * neu auf. Auf dem iPhone sieht man das als Wegblinken; im Browser lässt
 * es sich als Aushängen aus dem Dokument messen (`scripts/probe.sh`).
 *
 * Genau so war die Fernbedienung monatelang unbrauchbar: Sie hing an
 * «der Fernseher meldet an» – und ein Android TV meldet nach jedem
 * Tastendruck kurz «aus».
 *
 * Die Regel für jedes Blatt einer Kachel lautet deshalb:
 *
 *   Was ein Blatt am Leben hält, darf sich im Betrieb nicht ändern
 *   können. Erlaubt sind Geräteart und Befehlsliste – beide kommen beim
 *   Anlegen vom Hub und stehen dann fest. Nichts aus `entity.state`:
 *   nicht an/aus, nicht Lautstärke, nicht Position, nicht erreichbar.
 *
 * Der *Knopf*, der ein Blatt öffnet, darf sehr wohl am Zustand hängen –
 * ein Steuerkreuz am dunklen Fernseher wäre ein Knopf, der nichts tut.
 * Nur das Blatt selbst bleibt stehen, bis jemand es schliesst.
 *
 * Die Fernbedienung hat ihre eigene Antwort in `fernsehkachel.ts`
 * (`fernbedienungMoeglich`) – sie stand dort schon, bevor die Regel
 * einen Namen hatte.
 */

/** Kann diese Kachel überhaupt eine Warteschlange zeigen? */
export function musiklisteMoeglich(entity: Entity): boolean {
  // Die Geräteart, nicht «es läuft gerade etwas»: Wer die Liste offen
  // hat, während das letzte Stück endet, stünde sonst plötzlich wieder
  // vor der Kachel – mitten im Blättern.
  return entity.kind === 'media_player';
}

/**
 * Alle Blätter, die diese Kachel bereithalten muss.
 *
 * An einer Stelle, damit man sie zählen kann: Wer ein neues Blatt
 * anlegt, trägt es hier ein und bekommt vom Test die Frage gestellt, ob
 * seine Bedingung im Betrieb feststeht.
 */
export function blaetterFuer(
  entity: Entity,
  kannFernbedienung: boolean
): { musikliste: boolean; fernbedienung: boolean } {
  return {
    musikliste: musiklisteMoeglich(entity),
    fernbedienung: kannFernbedienung,
  };
}
