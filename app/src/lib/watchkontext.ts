/**
 * Was das iPhone der Uhr mitgibt.
 *
 * Die Watch-App redet selbst mit dem Hub (im WLAN oder über das
 * gekoppelte Telefon) - aber woher soll sie Adresse und Token kennen?
 * Eine eigene Anmeldung auf der Uhr wäre die Antwort aus der Hölle:
 * ein 40-Zeichen-Token, gedreht am Digital-Crown. Stattdessen schickt
 * das Telefon seine Zugangsdaten samt der Haustüre als Anwendungs-
 * Kontext hinüber (WatchConnectivity) - einmal, und bei jeder Änderung
 * wieder.
 *
 * Rein und testbar: *Welche* Türe die richtige ist und *was* hinüber
 * soll, ist die entscheidbare Logik. Das Schicken selbst macht der
 * Haken (hooks/useWatchSync.ts).
 */

import { Entity, HubSettings } from '../api/types';

/** Nur Plist-taugliche Werte: WatchConnectivity überträgt Zeichenketten
 *  problemlos, beliebige Objekte nicht - der Türbefehl reist darum als
 *  JSON-Text. */
export interface WatchKontext {
  hubUrl: string;
  token: string;
  doorLabel: string;
  doorPath: string;
  doorBody: string;
  [key: string]: string;
}

/**
 * Dieselbe Wahl wie beim Sperrbildschirm-Link (DashboardScreen,
 * homepilot://door): das Schloss, das wirklich die Türe öffnet, sonst
 * irgendein Schloss. Zwei Stellen mit zwei Meinungen darüber, was «die
 * Haustüre» ist, wären eine Stelle zu viel.
 */
export function haustuerFuerWatch(entities: Entity[]): Entity | null {
  return (
    entities.find(
      (entity) => entity.kind === 'lock' && entity.commands.includes('open_door')
    ) ??
    entities.find((entity) => entity.kind === 'lock') ??
    null
  );
}

/** Der Kontext für die Uhr - oder null, wenn (noch) nichts zu schicken
 *  ist. Ohne Türe geht der Rest trotzdem hinüber: Blick und Timer
 *  funktionieren auch in einem Haus ohne smartes Schloss. */
export function watchKontext(
  settings: Pick<HubSettings, 'url' | 'token'>,
  entities: Entity[]
): WatchKontext | null {
  const url = String(settings.url ?? '').replace(/\/+$/, '');
  const token = String(settings.token ?? '');
  if (!url || !token) return null;
  const tuer = haustuerFuerWatch(entities);
  return {
    hubUrl: url,
    token,
    doorLabel: tuer ? tuer.name : '',
    doorPath: tuer ? `/api/entities/${encodeURIComponent(tuer.id)}/command` : '',
    doorBody: tuer
      ? JSON.stringify({
          command: tuer.commands.includes('open_door') ? 'open_door' : 'unlatch',
        })
      : '',
  };
}
