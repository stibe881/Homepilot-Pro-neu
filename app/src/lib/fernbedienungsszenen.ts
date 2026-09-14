/**
 * Die Szenen unten an der Fernbedienung - bis zu zwei (Punkt 646).
 *
 * Der Wunsch aus dem Haus: «Man soll hier angeben können, welche Szene
 * unten an der Fernbedienung angezeigt werden soll - bis zu zwei
 * Szenen/Abläufe.» Bisher gab es nur einen einzigen, automatisch
 * gefundenen Griff (`kinoszene.ts`): die Szene «Kino», wenn es genau
 * eine mit diesem Namen gibt. Das blieb ein Zufallstreffer - ein Haus
 * ohne genau eine Szene namens «Kino», oder mit einer zweiten für
 * «Zocken», bekam nie einen Knopf.
 *
 * Jetzt lässt sich die Auswahl unter Einstellungen → Verbindungen
 * treffen (Geräte-Metadaten, `entity.remote_scenes`) - ohne Auswahl
 * bleibt es beim alten Verhalten, damit sich für ein bestehendes Haus
 * nichts ändert, bis jemand die Wahl trifft.
 */
import { Entity, Scene } from '../api/types';
import { kinoSzene } from './kinoszene';

/** Höchstens so viele Szenen an der Fernbedienung - zwei, damit der
 *  Filmabend und das Zocken beide Platz haben, ohne dass die Reihe zu
 *  einer zweiten Geräteliste wird. Dieselbe Zahl wie beim Hub
 *  (core/entity.py, REMOTE_SCENES_MAX). */
export const REMOTE_SZENEN_MAX = 2;

/**
 * Die Szenen, die als Knopf unten an der Fernbedienung stehen (rein,
 * testbar).
 *
 * Eine getroffene Auswahl gewinnt immer, auch wenn sie auf inzwischen
 * gelöschte Szenen zeigt - solche fallen einfach weg, statt die Regel
 * auf «Kino» zurückfallen zu lassen: Wer die Auswahl auf «keine» stellt
 * (beide abgewählt), soll auch keine bekommen, nicht überraschend doch
 * eine automatisch gefundene.
 */
export function fernbedienungsSzenen(
  entity: Pick<Entity, 'remote_scenes'> | undefined,
  scenes: Scene[]
): Scene[] {
  const gewaehlt = entity?.remote_scenes;
  if (Array.isArray(gewaehlt)) {
    return gewaehlt
      .map((id) => scenes.find((scene) => scene.id === id))
      .filter((scene): scene is Scene => scene != null)
      .slice(0, REMOTE_SZENEN_MAX);
  }
  const kino = kinoSzene(scenes);
  return kino ? [kino] : [];
}

/**
 * Was ein Tipp auf eine Szene an der Auswahl ändert (rein, testbar).
 *
 * Höchstens zwei: Ein dritter Tipp auf eine neue Szene tut nichts, bis
 * eine der beiden abgewählt ist - kein stilles Ersetzen der ältesten
 * Wahl, das man erst an der Fernbedienung selbst bemerkt.
 */
export function szenenAuswahlUmschalten(gewaehlt: string[], sceneId: string): string[] {
  if (gewaehlt.includes(sceneId)) return gewaehlt.filter((id) => id !== sceneId);
  if (gewaehlt.length >= REMOTE_SZENEN_MAX) return gewaehlt;
  return [...gewaehlt, sceneId];
}
