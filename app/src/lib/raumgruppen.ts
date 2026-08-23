/**
 * Geräte nach Zimmer gruppieren.
 *
 * Herausgelöst aus DashboardScreen, weil dieselbe Gliederung an zwei
 * Stellen gebraucht wird: auf der Startseite im Modus «Alle» und auf der
 * Licht-Seite. Dort stand vorher das ganze Haus alphabetisch
 * untereinander – «Lina» zwischen «Küche» und «Vorratsraum». Gesucht wird
 * aber nie ein Buchstabe, sondern immer ein Zimmer.
 *
 * Die Reihenfolge der Zimmer kommt aus der Konfiguration, nicht aus dem
 * Alphabet: Wer seine Räume in der config.yaml so ordnet, wie er durch die
 * Wohnung läuft, will sie auch so lesen.
 */

import { Entity } from '../api/types';

export type Raumgruppe = { key: string; label: string; items: Entity[] };

/** Schlüssel der Gruppe für alles ohne Zimmer. */
export const OHNE_RAUM = '__none';
/** Schlüssel der Favoritengruppe. */
export const FAVORITEN = '__fav';

/**
 * Nach Zimmer gliedern, leere Gruppen weglassen (rein, testbar).
 *
 * `favoriten` zieht die markierten Geräte in eine eigene Gruppe ganz nach
 * oben – der schnelle Griff ins andere Zimmer. Wer nach Zimmer sucht, will
 * das nicht: Dann steht die Lampe dort, wo sie hängt. Deshalb ist es eine
 * Entscheidung des Aufrufers und keine Regel der Funktion.
 */
export function raumGruppen(
  items: Entity[],
  raeume: string[],
  favoriten: string[] = []
): Raumgruppe[] {
  const gruppen: Raumgruppe[] = [];
  const istFavorit = (entity: Entity) => favoriten.includes(entity.id);

  if (favoriten.length > 0) {
    const favs = items.filter(istFavorit);
    if (favs.length > 0) gruppen.push({ key: FAVORITEN, label: 'Favoriten', items: favs });
  }

  for (const name of raeume) {
    const drin = items.filter((entity) => entity.room === name && !istFavorit(entity));
    if (drin.length > 0) gruppen.push({ key: name, label: name, items: drin });
  }

  // Zimmer, die zwar an Geräten stehen, aber in der Konfiguration fehlen –
  // sonst verschwänden diese Geräte lautlos aus der Ansicht.
  const bekannt = new Set(raeume);
  for (const entity of items) {
    const raum = entity.room;
    if (!raum || bekannt.has(raum) || istFavorit(entity)) continue;
    bekannt.add(raum);
    gruppen.push({
      key: raum,
      label: raum,
      items: items.filter((other) => other.room === raum && !istFavorit(other)),
    });
  }

  const ohne = items.filter((entity) => !entity.room && !istFavorit(entity));
  if (ohne.length > 0) gruppen.push({ key: OHNE_RAUM, label: 'Weitere', items: ohne });

  return gruppen;
}
