/**
 * Was der Anlage die Sicht nimmt – die Sätze dazu.
 *
 * Der Hub findet die blinden Flecken (hub/core/alarmwache.py) und
 * schickt sie im Zustand mit. Hier steht nur, wie man sie liest – und
 * das ist mehr als eine Übersetzung: «Kellerfenster» allein liesse
 * offen, ob es offen steht oder ob niemand mehr hinsieht, und das ist
 * der ganze Unterschied.
 */

/** Dieselben Arten wie im Hub (core/alarmwache.py). */
export const SABOTAGE = 'sabotage';
export const FUNKSTILLE = 'funkstille';
export const BATTERIE = 'batterie';

export interface Blindstelle {
  entity_id: string;
  label: string;
  art: string;
}

/** Was dem Sensor fehlt, in einem Wort (rein, testbar). */
export function artWort(art: string): string {
  if (art === SABOTAGE) return 'Sabotage gemeldet';
  if (art === FUNKSTILLE) return 'antwortet nicht mehr';
  if (art === BATTERIE) return 'Batterie fast leer';
  return art;
}

/** Das Symbol dazu (rein, testbar). */
export function artSymbol(art: string): string {
  if (art === SABOTAGE) return 'hand-left-outline';
  if (art === FUNKSTILLE) return 'cloud-offline-outline';
  return 'battery-dead-outline';
}

/**
 * Die Überschrift über der Liste (rein, testbar).
 *
 * Sie richtet sich nach dem Schlimmsten, das dabei ist – dieselbe Regel
 * wie im Hub, aus demselben Grund: Sabotage gehört in die Zeile, die man
 * zuerst liest.
 */
export function blindTitel(stellen: Blindstelle[]): string {
  if (stellen.length === 0) return '';
  const arten = new Set(stellen.map((zeile) => zeile.art));
  if (arten.has(SABOTAGE)) return 'Sabotage gemeldet';
  if (arten.has(FUNKSTILLE)) {
    const anzahl = stellen.filter((zeile) => zeile.art === FUNKSTILLE).length;
    return anzahl === 1 ? 'Ein Sensor antwortet nicht' : `${anzahl} Sensoren antworten nicht`;
  }
  return 'Batterien werden knapp';
}

/**
 * Wie ernst es ist (rein, testbar).
 *
 * Entscheidet über die Farbe. Drei Stufen und nicht zwei: Eine schwache
 * Batterie in Gelb neben einer gemeldeten Sabotage in Rot sagt auf einen
 * Blick, was zuerst drankommt.
 */
export function blindStufe(stellen: Blindstelle[]): 'sabotage' | 'warn' | 'hinweis' | null {
  if (stellen.length === 0) return null;
  const arten = new Set(stellen.map((zeile) => zeile.art));
  if (arten.has(SABOTAGE)) return 'sabotage';
  if (arten.has(FUNKSTILLE)) return 'warn';
  return 'hinweis';
}

/**
 * Die drei Stufen, in denen sich die Anwesenheits-Kopplung einstellen
 * lässt – dieselben Schlüssel wie im Hub (core/alarmanwesenheit.py).
 *
 * Hier und nicht im Bildschirm, weil beide Richtungen (scharf und
 * unscharf) dieselbe Liste brauchen und zwei Listen früher oder später
 * auseinanderlaufen.
 */
export const ANWESENHEIT: { key: string; label: string }[] = [
  { key: 'aus', label: 'Aus' },
  { key: 'vorschlagen', label: 'Vorschlagen' },
  { key: 'automatisch', label: 'Automatisch' },
];
