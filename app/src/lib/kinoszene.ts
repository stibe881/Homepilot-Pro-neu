/**
 * Die Szene «Kino» auf der Fernbedienung.
 *
 * Der Fall: Der Film beginnt, das Licht ist noch hell - die
 * Fernbedienung ist offen, die Szene liegt vier Tipps entfernt. Auf der
 * Live-Karte des Fernsehers steht der Griff schon (hub/core/livekarten,
 * kino_knopf); hier dieselbe Regel für das Blatt in der App, damit die
 * beiden nie verschieden entscheiden:
 *
 * Gefunden wird die Szene über ihren Namen - «Kino», Gross- und
 * Kleinschreibung egal. Kein eigenes Einstellfeld: Wer die Szene so
 * nennt, hat sie für genau diesen Moment gebaut. Heisst keine so, gibt
 * es keinen Knopf; heissen zwei so, auch nicht - lieber keiner als der
 * falsche.
 */
import { Scene } from '../api/types';

/** Die eine Kino-Szene - oder null (rein, testbar). */
export function kinoSzene(scenes: Scene[]): Scene | null {
  const treffer = (scenes ?? []).filter(
    (scene) => String(scene.name ?? '').trim().toLowerCase() === 'kino'
  );
  return treffer.length === 1 ? treffer[0] : null;
}
