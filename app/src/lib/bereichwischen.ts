/**
 * Die Wischgeste zwischen den Bereichen (Punkt 433) - das Rechnen.
 *
 * Anders als die Zurück-Geste (lib/zurueckwischen.ts) beginnt sie
 * überall, nicht nur an der Kante: Sie meint kein «zurück», sondern
 * «weiter». Dafür verlangt sie einen deutlich waagrechten Weg - eine
 * Bewegung, die auch nur halb senkrecht ist, gehört der Liste darunter.
 */

/** So weit muss der Finger waagrecht, bevor die Geste zählt. */
export const WEG = 72;

/** So viel waagrechter als senkrecht muss der Weg sein. */
export const WAAGRECHT = 2.2;

/** In welche Richtung der Bereich wechselt: nach links gewischt heisst
 *  «der nächste» (+1), nach rechts «der vorige» (-1); null heisst kein
 *  Wechsel (rein, testbar). */
export function bereichsRichtung(dx: number, dy: number): 1 | -1 | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.abs(dx) < WEG || Math.abs(dx) < Math.abs(dy) * WAAGRECHT) return null;
  return dx < 0 ? 1 : -1;
}
