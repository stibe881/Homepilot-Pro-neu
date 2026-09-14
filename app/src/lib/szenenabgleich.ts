/**
 * Wann sich ein Nachfragen beim Hub lohnt, ob eine Szene noch «gilt».
 *
 * Der Hub weiss es (core/scenes.py, `ist_aktiv`) - die App zeigt es nur
 * an (`GET /api/scenes`). Ein einmaliges Nachfragen 1,2 Sekunden nach
 * dem Auslösen reichte nicht: Ein Fernseher, der länger zum Aufwachen
 * braucht, oder eine Hue-Bridge, deren Bericht erst später ankommt,
 * liessen den Szenen-Knopf dauerhaft als «nicht aktiv» stehen, obwohl
 * die Szene inzwischen galt (Punkt 654 der Werkbank). Die Lösung: bei
 * jeder Zustandsmeldung nachsehen, ob sie eine Szenen-Entität betrifft,
 * und dann erneut beim Hub nachfragen (useHub.ts).
 */
import { Scene } from '../api/types';

/** Alle Entitäten, die in mindestens einer Szene vorkommen (rein, testbar). */
export function szenenEntitaetenMenge(scenes: Scene[]): Set<string> {
  return new Set(scenes.flatMap((szene) => szene.entity_ids ?? []));
}

/** Betrifft eine der gemeldeten Entitäten eine Szene? (rein, testbar) */
export function beruehrtSzene(entityIds: string[], szenenEntitaeten: Set<string>): boolean {
  return entityIds.some((id) => szenenEntitaeten.has(id));
}
