/**
 * Wohin ein Tipp auf eine Nachricht führt.
 *
 * Bisher wusste die App das für vier Fälle: Kamera, Batterie, Klingel,
 * Alarm. Alle anderen fünfundzwanzig Meldungen öffneten die App auf der
 * Startseite - «Milch steht auf der Einkaufsliste» genauso wie «Wasser
 * im Keller». Man tippt, weil man etwas tun will, und landet dort, wo
 * man ohnehin gelandet wäre.
 *
 * Statt für jede Meldung eine Regel in der App zu schreiben, sagt jede
 * Nachricht selbst, wohin sie gehört: ein Feld `ziel` in den Daten, das
 * der Hub setzt (core/watchdog.py, core/automation.py). Die App muss
 * dafür nichts über Wassermelder wissen - nur, wie man zu einem Raum
 * kommt.
 *
 * Die Schreibweise ist absichtlich schlicht: `art` oder `art:wert`, eine
 * Zeichenkette, die durch JSON und durch die Push-Dienste geht, ohne
 * unterwegs etwas zu verlieren.
 */
import { Section } from '../components/Rail';

export type Ziel =
  /** Die Startseite – wenn nichts Besseres gemeint ist. */
  | { art: 'start' }
  /** Ein Bereich der App: 'system', 'alarm', 'energy', 'personen' … */
  | { art: 'bereich'; bereich: Section }
  /** Ein Raum in der Raumansicht. */
  | { art: 'raum'; raum: string }
  /** Eine Kamera im Vollbild. */
  | { art: 'kamera'; entityId: string }
  /** Ein einzelnes Gerät – die App springt in seinen Raum. */
  | { art: 'geraet'; entityId: string }
  /** Eine Kachel im Familienbereich: 'shopping', 'tasks', 'kalender' … */
  | { art: 'familie'; modul: string }
  /** Die Geräteliste mit aufgeklappten Batterien. */
  | { art: 'batterien' }
  /** Das Blatt «Nicht in Ordnung». */
  | { art: 'sorgen' }
  /** Der Küchen-Timer. */
  | { art: 'timer' }
  /** Das Klingel-Vollbild. */
  | { art: 'klingel'; entityId?: string }
  /** Die Liste der offenen Fenster und Türen. */
  | { art: 'offen' };

/** Bereiche, in die eine Nachricht führen darf. Absichtlich eine Liste
 *  und keine offene Zeichenkette: Was der Hub schickt, kommt aus einer
 *  älteren Fassung, sobald jemand ein Update aufschiebt. */
const BEREICHE: Section[] = [
  'start',
  'home',
  'light',
  'covers',
  'cameras',
  'family',
  'devices',
  'automations',
  'system',
  'energy',
  'alarm',
  'speakers',
  'users',
  'personen',
  'activity',
  'widgets',
  'account',
  'connection',
];

/** Kacheln des Familienbereichs (screens/family/bausteine.tsx). */
const MODULE = [
  'kalender',
  'tasks',
  'shopping',
  'meals',
  'pins',
  'rewards',
  'contacts',
  'routines',
  'packlists',
  'countdowns',
  'reminders',
  'recipes',
  'documents',
  'chores',
  'woche',
  'emergency',
  'medications',
  'babysitter',
  'members',
];

/**
 * Aus dem, was an der Nachricht hängt, ein Ziel machen (rein, testbar).
 *
 * `null` heisst: Es ist nichts Sinnvolles dabei - dann bleibt es beim
 * blossen Öffnen der App, wie bisher.
 *
 * Die alten Felder (`camera`, `type`) werden weiter verstanden: Zwischen
 * einem neuen Hub und einer alten App - oder umgekehrt - liegen bei uns
 * regelmässig ein paar Tage.
 */
export function zielAus(data: {
  ziel?: unknown;
  camera?: unknown;
  entityId?: unknown;
  type?: unknown;
}): Ziel | null {
  const roh = typeof data.ziel === 'string' ? data.ziel.trim() : '';
  const entityId = typeof data.entityId === 'string' ? data.entityId : undefined;
  if (roh) {
    const geparst = ausSchluessel(roh, entityId);
    if (geparst) return geparst;
  }
  // Der alte Weg, unverändert.
  if (typeof data.camera === 'string' && data.camera) {
    return { art: 'kamera', entityId: data.camera };
  }
  if (data.type === 'doorbell') return { art: 'klingel', entityId };
  if (data.type === 'battery') return { art: 'batterien' };
  if (data.type === 'alarm') return { art: 'bereich', bereich: 'alarm' };
  return null;
}

function ausSchluessel(roh: string, entityId?: string): Ziel | null {
  const [art, ...rest] = roh.split(':');
  const wert = rest.join(':').trim();
  switch (art) {
    case 'start':
      return { art: 'start' };
    case 'batterien':
      return { art: 'batterien' };
    case 'sorgen':
      return { art: 'sorgen' };
    case 'timer':
      return { art: 'timer' };
    case 'offen':
      return { art: 'offen' };
    case 'klingel':
      return { art: 'klingel', entityId: wert || entityId };
    case 'bereich':
      return BEREICHE.includes(wert as Section)
        ? { art: 'bereich', bereich: wert as Section }
        : null;
    case 'raum':
      return wert ? { art: 'raum', raum: wert } : null;
    case 'kamera':
      return wert || entityId
        ? { art: 'kamera', entityId: (wert || entityId) as string }
        : null;
    case 'geraet':
      return wert || entityId
        ? { art: 'geraet', entityId: (wert || entityId) as string }
        : null;
    case 'familie':
      return MODULE.includes(wert) ? { art: 'familie', modul: wert } : null;
    default:
      return null;
  }
}
