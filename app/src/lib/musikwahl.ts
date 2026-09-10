import { Entity } from '../api/types';
import { boxWechsel } from './boxwahl';
import { hatEigeneAuswahl, pickPlayer } from './geraeteart';

/**
 * Wer im Player gezeigt wird - und was ein Tipp auf eine Box bewirkt.
 *
 * Dieselbe Karte steht an drei Stellen: rechts auf der Startseite, als
 * Blatt über der Raumkachel und oben im Raumkopf. Sie soll sich überall
 * gleich verhalten - dieselben Boxen zur Wahl, dieselbe Regel beim
 * Umziehen. Dreimal dieselben zwanzig Zeilen waren der Weg dorthin, dass
 * es eben *nicht* so ist: Der Umzug per `play_on` stand nur an zwei von
 * drei Stellen, und den Wunsch (lib/boxwahl.ts) merkte sich nur eine.
 *
 * Unterschiedlich ist genau eines: **was zuerst gezeigt wird.** Auf der
 * Startseite die naheliegende Box des Hauses, im Zimmer die des Zimmers.
 *
 * Reines Rechnen; den Zustand hält der Haken darüber
 * (hooks/useMusikwahl.ts).
 */

/** Die gezeigte Quelle, wie `boxWechsel` sie braucht (rein, testbar). */
export function wechselQuelle(quelle: Entity) {
  return {
    id: quelle.id,
    kannUmziehen: quelle.commands.includes('play_on'),
    devices: Array.isArray(quelle.state.devices) ? (quelle.state.devices as string[]) : [],
    spielt: quelle.state.state === 'playing',
  };
}

/**
 * Welche Quelle die Karte zeigt (rein, testbar).
 *
 * Von Hand gewählt sticht alles - solange es die Box noch gibt. Danach
 * die Vorwahl: im Zimmer dessen eigene Box, denn deswegen steht man ja
 * dort. Und sonst die naheliegende des Hauses (pickPlayer: was spielt,
 * sonst was Playlisten kann).
 */
export function gezeigteQuelle(
  players: Entity[],
  gewaehltId: string | null,
  vorwahl: Entity | null | undefined,
  alle: Entity[]
): Entity | undefined {
  return (
    (gewaehltId ? players.find((entity) => entity.id === gewaehltId) : undefined) ??
    vorwahl ??
    pickPlayer(alle)
  );
}

/**
 * Der Wunsch, wie ihn der Wähler anschreibt (rein, testbar).
 *
 * Ohne eigene Wahl gilt die Hausbox als Wunsch - für die Startseite, die
 * anders als ein Zimmer keine naheliegende Box hat und ohne das leer
 * «Box wählen» zeigte, bis jemand selbst tippt. Eine einmal getroffene
 * Wahl sticht das immer, und die Hausbox gilt nur, solange sie wirklich
 * unter den Boxen steht - eine, die es (noch) nicht gibt oder nicht mehr
 * gibt, soll nicht als Ziel gelten.
 */
export function effektiverWunsch(
  gewaehlterWunsch: string | null,
  hausbox: string | null | undefined,
  players: Entity[]
): string | null {
  if (gewaehlterWunsch) return gewaehlterWunsch;
  if (hausbox && players.some((box) => box.name === hausbox)) return hausbox;
  return null;
}

/** Was ein Tipp im Wähler bewirkt. */
export type Wahlwirkung =
  | {
      /** Die Musik zieht um; gezeigt bleibt die Quelle. */
      art: 'umzug';
      quelle: string;
      device: string;
      play: boolean;
      wunsch: string | null;
    }
  | {
      /** Nur die Ansicht wechselt. */
      art: 'ansicht';
      zeigt: string;
      wunsch: string | null;
    };

/**
 * Was passiert, wenn jemand im Wähler etwas antippt (rein, testbar).
 *
 * Kennt die gezeigte Quelle die Box, zieht die Musik dorthin um (wie
 * früher die «Abspielen auf»-Chips) und die Karte der Quelle bleibt
 * stehen. Fremde Boxen wechseln nur die Ansicht.
 *
 * `wunsch` ist die Box, auf der der nächste Griff spielen soll -
 * `null` heisst «unverändert lassen». Eine gewählte *Box* ist immer
 * eine Ansage, wohin die Musik soll, auch wenn die gezeigte Quelle
 * gerade nicht umziehen kann; eine gewählte *Quelle* (Spotify, Radio)
 * sagt darüber nichts und lässt den Wunsch stehen. Genau daran hing der
 * gemeldete Fall: «Oben Büro gewählt, dann Radio getippt - es spielt
 * auf der Terrasse.»
 */
export function wahlWirkung(player: Entity | undefined, ziel: Entity): Wahlwirkung {
  const wunsch = hatEigeneAuswahl(ziel) ? null : ziel.name;
  const quelle = player && hatEigeneAuswahl(player) ? player : undefined;
  const wechsel = boxWechsel(quelle ? wechselQuelle(quelle) : null, ziel);
  if (wechsel.art === 'umzug' && quelle) {
    return {
      art: 'umzug',
      quelle: quelle.id,
      device: wechsel.device,
      play: wechsel.play,
      wunsch,
    };
  }
  return { art: 'ansicht', zeigt: ziel.id, wunsch };
}
