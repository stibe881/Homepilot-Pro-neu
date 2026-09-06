import { Entity } from '../api/types';

/**
 * Favoriten gehören der Person – beim Hub abgelegt, nicht im Telefon.
 * Punkt 249 der Werkbank.
 *
 * Die Geschichte in drei Schritten, weil jeder eine Falle war:
 *
 * 1. Zuerst lagen sie im Speicher der App auf genau diesem Telefon. Das
 *    hielt so lange wie die Installation: Neue App, neues Gerät,
 *    Weboberfläche – jedes Mal eine leere Startseite.
 * 2. Dann stand der Stern am Gerät selbst (`entity.favorite`, beim Hub)
 *    und galt für alle im Haus. Robust, aber falsch herum: Griffbereit
 *    ist eine persönliche Frage. Was Stefan jeden Abend braucht, ist für
 *    Livia nur eine Kachel im Weg – und jeder gesetzte Stern räumte
 *    allen anderen die Startseite um.
 * 3. Heute sind sie persönlich UND beim Hub: `favorites` in den eigenen
 *    Einstellungen (usePrefs, /api/prefs). Die Sterne am Gerät gibt es
 *    noch – als Startbestand für alle, die noch keine eigene Liste
 *    haben; der erste eigene Stern schreibt die Liste fest
 *    (DashboardScreen).
 *
 * Haushaltsweit geblieben sind dagegen ausgeblendete und gesperrte
 * Geräte (usePrefs): Was gefährlich oder unerwünscht ist, ist es für
 * alle.
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
