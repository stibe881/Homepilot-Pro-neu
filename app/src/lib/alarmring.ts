/**
 * Der Ring um die Alarm-Frist: wie voll er ist, 0…1.
 *
 * Ein Countdown als Zahl ist nur eine Zahl, die kleiner wird – ob 20
 * Sekunden viel oder wenig sind, sagt erst der Ring. Er leert sich mit
 * der Zeit: Was übrig bleibt, ist das, was man noch hat.
 *
 * Hier statt im Bildschirm, weil sich der Bildschirm nicht prüfen
 * lässt – er zieht die Symbolschriften von Expo mit, und Jest lädt sie
 * nicht (dieselbe Lehre wie bei lib/batterien.ts).
 */
export function ringAnteil(state: {
  seconds_left?: number | null;
  seconds_total?: number | null;
}): number | null {
  const left = state.seconds_left;
  const total = state.seconds_total;
  if (left == null || total == null || total <= 0) return null;
  return Math.max(0, Math.min(1, left / total));
}
