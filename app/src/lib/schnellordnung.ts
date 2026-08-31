/**
 * Die Reihenfolge der Schnellaktionen auf der Startseite.
 *
 * Oben stehen vier Knöpfe: die Szenen, die als Schnellaktion angezeigt
 * werden, und dahinter «Storen hoch» und «Storen runter». Die Abfolge
 * war fest verdrahtet - erst die Szenen in der Reihenfolge des Hubs,
 * dann die Storen. Wer die Storen zuerst braucht, konnte nichts tun.
 *
 * Wie bei den Favoriten bekommen darum auch die zwei Storen-Knöpfe eine
 * Kennung und reihen sich ein wie jede Szene (lib/favoritenordnung.ts
 * sortiert beide Listen, denn es ist dieselbe Frage). Und wie dort
 * gilt: Was in der gespeicherten Reihenfolge nicht vorkommt, hängt
 * hinten an - eine neu angelegte Szene soll die gewachsene Ordnung
 * nicht durcheinanderbringen.
 */
import { favoritenOrdnen } from './favoritenordnung';

/** Kennungen der beiden Storen-Knöpfe. Mit Doppelpunkt, damit sie mit
 *  keiner Szenen-Kennung kollidieren können. */
export const STOREN_AUF = 'kachel:storen-auf';
export const STOREN_ZU = 'kachel:storen-zu';

export interface Schnellposten {
  id: string;
  name: string;
  /** Gesetzt, wenn dieser Knopf eine Szene aktiviert. */
  sceneId?: string;
  /** Gesetzt bei den beiden Storen-Knöpfen. */
  storen?: 'auf' | 'zu';
}

/**
 * Die Knöpfe der Startseite in ihrer Reihenfolge (rein, testbar).
 *
 * Ohne gespeicherte Reihenfolge kommt heraus, was immer dastand: die
 * Szenen, dann die Storen. Das ist Absicht - eine neue Einstellung darf
 * nichts verschieben, solange niemand sie benutzt hat.
 */
export function schnellposten(
  scenes: { id: string; name: string }[],
  reihenfolge?: readonly string[] | null
): Schnellposten[] {
  const posten: Schnellposten[] = [
    ...scenes.map((scene) => ({ id: scene.id, name: scene.name, sceneId: scene.id })),
    { id: STOREN_AUF, name: 'Storen hoch', storen: 'auf' as const },
    { id: STOREN_ZU, name: 'Storen runter', storen: 'zu' as const },
  ];
  return favoritenOrdnen(posten, reihenfolge);
}
