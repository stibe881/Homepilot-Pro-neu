/**
 * Was auf der Fernsehkachel steht und was darauf zu sehen ist.
 *
 * Die Kachel entstand als Musikkachel, und ein Fernseher ist keine
 * Musikbox. Das sah man ihr an:
 *
 * - Der Android-TV meldet die laufende App als `track` *und* als `app`.
 *   Also stand «Plex» gross oben – und gleich darunter noch einmal in
 *   der App-Auswahl. Zwei Zeilen, eine Auskunft.
 * - Abgeschaltet zeigte sie trotzdem Zurück, Pause, Weiter, einen
 *   Einschlaf-Timer und ein Steuerkreuz. Nichts davon tut an einem
 *   dunklen Fernseher etwas.
 * - Lauter/leiser lag hinter der Fernbedienung, zwei Griffe entfernt –
 *   dabei ist es das, was man vom Sofa aus am häufigsten will.
 *
 * Ein Chromecast am Fernseher meldet dagegen einen echten Titel samt
 * Fortschritt. Deshalb wird hier nicht nach Integration unterschieden,
 * sondern danach, was das Gerät tatsächlich meldet.
 */

import { Entity } from '../api/types';

export interface TvKopf {
  /** Die grosse Zeile. */
  text: string;
  /** Die kleine darunter – oder nichts. */
  unter: string | null;
}

/**
 * Was oben auf der Kachel steht (rein, testbar).
 *
 * Läuft ein Film über Chromecast, ist sein Titel die Auskunft und die App
 * die Nebensache. Beim Android-TV gibt es nur die App – und die steht
 * dann allein oben, nicht zweimal.
 */
export function tvKopf(entity: Entity): TvKopf {
  const zustand = String(entity.state.state ?? '');
  if (zustand === 'off') return { text: 'Aus', unter: null };
  const app = entity.state.app ? String(entity.state.app) : null;
  const track = entity.state.track ? String(entity.state.track) : null;
  if (track && track !== app) return { text: track, unter: app };
  if (app) return { text: app, unter: null };
  return { text: 'An', unter: null };
}

export interface TvTeile {
  /** Zurück / Pause / Weiter. */
  transport: boolean;
  /** Lauter, leiser, stumm – direkt auf der Kachel. */
  lautstaerke: boolean;
  /** Die App-Auswahl. */
  apps: boolean;
  /** Der Einschlaf-Timer. */
  timer: boolean;
  /** Der Knopf zur vollen Fernbedienung. */
  fernbedienung: boolean;
}

/**
 * Welche Blöcke die Fernsehkachel zeigt (rein, testbar).
 *
 * Der abgeschaltete Fernseher ist der eigentliche Grund für diese
 * Funktion: Er kann genau zwei Dinge – angehen, und zwar auf Wunsch
 * gleich in eine App. Alles andere wäre ein Knopf, der nichts tut.
 *
 * Die App-Auswahl bleibt deshalb auch im Aus stehen: «Netflix» weckt den
 * Fernseher und startet Netflix, das ist ein Griff statt drei.
 */
export function tvTeile(entity: Entity): TvTeile {
  const kann = (befehl: string) =>
    Array.isArray(entity.commands) && entity.commands.includes(befehl);
  const an = String(entity.state.state ?? '') !== 'off';
  return {
    transport: an && kann('next'),
    // Nur wo es keinen Schieber gibt: Wer die Lautstärke setzen kann,
    // bekommt weiterhin den Balken – er sagt mehr als zwei Knöpfe.
    lautstaerke: an && kann('volume_up') && !kann('set_volume'),
    apps: kann('launch_app'),
    timer: an && kann('sleep_timer'),
    fernbedienung: an && kann('dpad_up'),
  };
}
