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

/**
 * Ob die Kachel überhaupt eine Fernbedienung *haben kann* (rein, testbar).
 *
 * Ausdrücklich ohne den gemeldeten Zustand – und das ist der ganze
 * Zweck. `tvTeile().fernbedienung` sagt, ob der *Knopf* dasteht, und der
 * darf im Aus verschwinden: Ein Steuerkreuz für einen ausgeschalteten
 * Fernseher wäre ein Knopf, der nichts tut.
 *
 * Ob das Blatt im Baum *hängt*, ist eine andere Frage, und sie darf nicht
 * so beantwortet werden. Ein Android TV meldet nach jedem Tastendruck
 * seinen Zustand neu, und dazwischen steht dort für einen Moment «off».
 * Hing das offene Blatt an dieser Bedingung, wurde es bei jedem Druck
 * abgeräumt und neu aufgebaut – auf dem iPhone als kurzes Wegblinken zu
 * sehen, im Browser als Aushängen aus dem Dokument gemessen.
 *
 * Die Befehlsliste dagegen kommt beim Anlegen des Geräts vom Hub und
 * ändert sich im Betrieb nie. Wer die Fernbedienung offen hat, behält
 * sie deshalb – auch wenn der Fernseher zwischendurch «aus» sagt. Gerade
 * dann braucht man sie: Die Ein-Taste liegt darin.
 */
export function fernbedienungMoeglich(entity: Entity): boolean {
  return Array.isArray(entity.commands) && entity.commands.includes('dpad_up');
}
