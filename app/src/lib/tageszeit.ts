/**
 * Ansichten nach Tageszeit.
 *
 * Morgens will man Storen und Kaffee, abends Licht und Türe. Dieselbe
 * Startseite, andere Reihenfolge – automatisch, aber nur wenn jemand das
 * ausdrücklich einschaltet. Eine Wohnung, die sich von selbst umsortiert,
 * ohne dass man es bestellt hat, ist keine eingerichtete Wohnung, sondern
 * eine, in der man morgens sucht.
 *
 * Reines Rechnen: hinein die Uhrzeit und die Geräte, heraus die
 * Reihenfolge.
 */
import type { Entity } from '../api/types';

export type Tageszeit = 'morgen' | 'tag' | 'abend' | 'nacht';

export interface Abschnitt {
  key: Tageszeit;
  label: string;
  /** Von welcher Stunde an (Ortszeit). */
  ab: number;
  /** Welche Gerätearten hier nach vorne kommen, in dieser Reihenfolge. */
  arten: string[];
}

/**
 * Die vier Abschnitte des Tages.
 *
 * Geschnitten nach dem, was man tut – nicht nach Sonnenstand: Um sieben
 * im Dezember ist es dunkel und man macht trotzdem die Storen hoch.
 */
export const ABSCHNITTE: Abschnitt[] = [
  {
    key: 'morgen',
    label: 'Morgen',
    ab: 5,
    // Storen hoch, Kaffee, Radio - und die Heizung, die man in der
    // ersten halben Stunde bemerkt.
    arten: ['cover', 'switch', 'media_player', 'climate', 'light'],
  },
  {
    key: 'tag',
    label: 'Tag',
    ab: 10,
    // Untertags fasst man am ehesten Haushalt und Sauger an.
    arten: ['appliance', 'vacuum', 'cover', 'switch', 'light'],
  },
  {
    key: 'abend',
    label: 'Abend',
    ab: 17,
    // Licht, Musik, Fernseher - und die Storen wieder herunter.
    arten: ['light', 'media_player', 'cover', 'switch'],
  },
  {
    key: 'nacht',
    label: 'Nacht',
    ab: 22,
    // Was man vor dem Schlafen prüft: Türe, Alarm, Fenster.
    arten: ['lock', 'alarm', 'binary_sensor', 'light'],
  },
];

/** Welcher Abschnitt gilt zu dieser Stunde? (rein, testbar) */
export function abschnittFuer(stunde: number): Abschnitt {
  const wert = Math.max(0, Math.min(23, Math.floor(stunde)));
  // Rückwärts suchen: Der erste Abschnitt, dessen Beginn erreicht ist.
  for (let i = ABSCHNITTE.length - 1; i >= 0; i -= 1) {
    if (wert >= ABSCHNITTE[i].ab) return ABSCHNITTE[i];
  }
  // Vor fünf Uhr ist noch Nacht - die des Vortags.
  return ABSCHNITTE[ABSCHNITTE.length - 1];
}

/** Der Abschnitt zu einem Zeitpunkt (rein, testbar). */
export function jetzigerAbschnitt(jetzt: number = Date.now()): Abschnitt {
  return abschnittFuer(new Date(jetzt).getHours());
}

/**
 * Geräte nach Tageszeit sortieren (rein, testbar).
 *
 * Die Reihenfolge innerhalb einer Art bleibt, wie sie war: Wer seine
 * Kacheln gezogen hat, findet sie in derselben Abfolge wieder – nur die
 * Blöcke stehen anders. Alles, was der Abschnitt nicht nennt, hängt
 * hinten an, statt zu verschwinden.
 */
export function nachTageszeit<T extends { kind: string }>(
  geraete: T[],
  abschnitt: Abschnitt,
): T[] {
  const rang = new Map(abschnitt.arten.map((art, index) => [art, index]));
  const spaeter = abschnitt.arten.length;
  return geraete
    .map((geraet, index) => ({ geraet, index }))
    .sort((a, b) => {
      const ra = rang.get(a.geraet.kind) ?? spaeter;
      const rb = rang.get(b.geraet.kind) ?? spaeter;
      return ra !== rb ? ra - rb : a.index - b.index;
    })
    .map((eintrag) => eintrag.geraet);
}

/** Was oben auf der Seite steht, wenn die Sortierung greift (rein, testbar). */
export function hinweis(abschnitt: Abschnitt): string {
  return `${abschnitt.label}: ${abschnitt.arten
    .slice(0, 3)
    .map(artWort)
    .join(', ')} zuerst`;
}

const WORT: Record<string, string> = {
  light: 'Licht',
  switch: 'Schalter',
  cover: 'Storen',
  lock: 'Schlösser',
  media_player: 'Musik',
  climate: 'Heizung',
  vacuum: 'Sauger',
  appliance: 'Haushalt',
  alarm: 'Alarm',
  binary_sensor: 'Melder',
};

export function artWort(kind: string): string {
  return WORT[kind] ?? kind;
}

/** Sortiert nur, wo es etwas zu sortieren gibt (rein, testbar). */
export function lohntSich(geraete: { kind: string }[]): boolean {
  const arten = new Set(geraete.map((geraet) => geraet.kind));
  // Eine Seite mit lauter Lampen sieht nach dem Sortieren genauso aus.
  return arten.size > 1 && geraete.length > 3;
}

export type { Entity };
