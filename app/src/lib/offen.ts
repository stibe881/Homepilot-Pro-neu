import { Entity } from '../api/types';

/**
 * Was «offen» heisst – die eine Fassung für alle, die es zählen.
 *
 * Kopfzeile, Begrüssungshinweis, Raumzeile und (als Python-Zwilling in
 * core/watchdog.py) Wächter und Widget. Zwei Zählungen für dieselbe
 * Frage waren der Fehler, mit dem das Widget «Alles zu» behauptete,
 * während das Küchenfenster offen stand.
 */

const OPENING_NAME = /t(ü|ue)r|door|fenster|window|balkon|terrasse|garage|tor\b/i;

/** Geräteklassen, bei denen «on» wirklich «offen» heisst. Ein
 *  Bewegungsmelder ist auch ein binary_sensor, meldet aber keine
 *  Öffnung – er darf hier nicht mitzählen. */
const OPEN_CLASSES = new Set(['contact', 'door', 'window', 'garage']);

/** Fenster oder Tür? Entscheidet allein der Gerätename. */
export function isWindow(name: string): boolean {
  return /fenster|window/i.test(name);
}

/**
 * Alle offenen Türen und Fenster – Kontaktsensoren plus Türsensor im
 * Schloss.
 *
 * Die eine Fassung für beide Stellen, an denen es steht: die Kopfzeile
 * und der Hinweis neben der Begrüssung. Vorher gab es zwei Funktionen
 * dieses Namens mit verschiedenen Regeln – die Kopfzeile zählte
 * Schlösser nicht mit, der Hinweis kannte nur eine Geräteklasse. Zwei
 * Zahlen für dieselbe Frage sind schlimmer als eine falsche.
 */
export function openContacts(entities: Entity[]): Entity[] {
  return entities.filter((entity) => {
    if (!entity.available) return false;
    // Ein Schloss mit Türsensor: Der Riegel sagt nichts darüber, ob die
    // Türe offen steht.
    if (entity.kind === 'lock') return entity.state.door === 'open';
    if (entity.kind !== 'binary_sensor') return false;
    const klasse = String(entity.state.device_class ?? '');
    // Wo die Integration keine Geräteklasse liefert, entscheidet der Name.
    const isContact = klasse
      ? OPEN_CLASSES.has(klasse)
      : OPENING_NAME.test(entity.name);
    return isContact && entity.state.state === 'on';
  });
}

/**
 * Steht eine Türe offen – nicht bloss ein Fenster? (rein, testbar)
 *
 * Der Unterschied ist keiner der Genauigkeit, sondern der Dringlichkeit:
 * Ein gekipptes Fenster ist eine Notiz, eine offene Wohnungstüre etwas,
 * das man jetzt wissen will.
 */
export function hasOpenDoor(entities: Entity[]): boolean {
  return openContacts(entities).some(
    (entity) => entity.kind === 'lock' || !isWindow(entity.name)
  );
}
