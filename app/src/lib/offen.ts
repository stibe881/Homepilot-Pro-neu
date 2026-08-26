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

/**
 * Die Wohnungstüre unter allen Geräten (rein, testbar).
 *
 * Dieselbe Regel, nach der die Startseite ihre Kachel «Wohnungstüre»
 * wählt – bewusst hier und nicht ein zweites Mal dort: Zwei Antworten
 * auf «welche ist die Wohnungstüre» wären derselbe Fehler wie die zwei
 * Zählungen oben in dieser Datei.
 *
 * Der Name hat Vorrang: Wer ein Schloss «Wohnungstüre» nennt, meint
 * dieses. Sonst das erste echte Schloss – «echt» heisst, es kann
 * abschliessen; ein blosser Türöffner wie die Gegensprechanlage kann
 * das nicht und ist die Haustüre unten.
 */
export function wohnungstuer(
  entities: Entity[],
  /** Die Haustüre; sie scheidet aus. Fehlt sie, wird die Klingel gesucht. */
  haustuerId?: string
): Entity | null {
  const haus =
    haustuerId ??
    entities.find((entity) => entity.kind === 'lock' && entity.integration === 'ring')
      ?.id;
  const kandidaten = entities.filter(
    (entity) => entity.kind === 'lock' && entity.id !== haus
  );
  return (
    kandidaten.find((entity) => /wohnung|wohnungstür/i.test(entity.name)) ??
    kandidaten.find((entity) => entity.commands.includes('lock')) ??
    null
  );
}

/**
 * Steht die Wohnungstüre offen? (rein, testbar)
 *
 * Eine offene Balkontüre ist ärgerlich, eine offene Wohnungstüre ist
 * etwas anderes – deshalb bekommt nur sie das Rot in der Kopfzeile.
 *
 * Zwei Wege dorthin, weil es zwei Bauarten gibt: ein Schloss mit
 * Türsensor (dann meldet es `door: open`) oder ein eigener
 * Kontaktsensor an derselben Türe. Wer nur den zweiten hat, hätte sonst
 * nie ein Rot gesehen.
 */
export function wohnungstuerOffen(entities: Entity[]): boolean {
  const tuer = wohnungstuer(entities);
  return openContacts(entities).some(
    (entity) =>
      (tuer !== null && entity.id === tuer.id) || /wohnung/i.test(entity.name)
  );
}
