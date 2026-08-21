import { Entity } from '../api/types';

/**
 * Favoriten gehören dem Haus, nicht dem Telefon.
 *
 * Lange lagen sie in den Geräte-Einstellungen – im Speicher der App auf
 * genau diesem Telefon. Das hielt genau so lange, wie die Installation
 * hielt: Neue App, neues Gerät, Weboberfläche, andere Person – jedes Mal
 * eine leere Startseite, und niemand konnte sagen, warum.
 *
 * Jetzt steht der Stern beim Gerät selbst (`entity.favorite`), der Hub
 * legt ihn in der homepilot-data.json ab, und alle sehen dasselbe. Der
 * Preis: Wer einen Stern setzt, setzt ihn für alle. Das ist die
 * ausdrückliche Absicht – eine Startseite, auf der bei jedem etwas
 * anderes steht, war nie gewollt. Die *Reihenfolge* der Favoriten bleibt
 * dagegen persönlich (siehe usePrefs), denn die kostet niemanden etwas.
 */

/**
 * Was von den alten, gerätelokalen Favoriten in den Hub gehört.
 *
 * Nur wenn dort noch gar keiner steht: Sonst füllte ein altes Telefon,
 * das seit Monaten in der Schublade liegt, beim ersten Öffnen eine
 * längst aufgeräumte Startseite wieder auf.
 *
 * Und nur, was es noch gibt – eine Kennung aus einer Integration, die
 * inzwischen weg ist, ist kein Favorit mehr, sondern Altpapier.
 */
export function zuUebernehmen(lokal: string[] | undefined, entities: Entity[]): string[] {
  if (!lokal || lokal.length === 0) return [];
  if (entities.length === 0) return [];
  if (entities.some((entity) => entity.favorite)) return [];
  const bekannt = new Set(entities.map((entity) => entity.id));
  return lokal.filter((id) => bekannt.has(id));
}

/** Die Favoriten, wie der Hub sie kennt. */
export function favoritenVon(entities: Entity[]): string[] {
  return entities.filter((entity) => entity.favorite).map((entity) => entity.id);
}
