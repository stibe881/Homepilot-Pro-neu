/**
 * Die kleine Linie unter dem Messwert – wird es wärmer oder kühler?
 *
 * «21.5 °C» allein sagt nicht, wohin es geht. Die Linie zeigt die
 * letzten Stunden (hub/core/kurzverlauf.py) – ohne Achsen, ohne Zahlen:
 * Die Zahl steht gross darüber, die Linie beantwortet nur die Richtung
 * und die Form. Wer Zahlen zur Kurve will, öffnet den Verlauf.
 */

/** Ein Punkt der Reihe: [Unix-Sekunden, Wert]. */
export type Reihe = [number, number][];

/**
 * SVG-Punkte für eine Polyline (rein, testbar).
 *
 * Die Zeitachse ist echt (ein Loch in der Reihe bleibt ein Loch), die
 * Wertachse spannt zwischen Minimum und Maximum der Reihe – mit einem
 * kleinen Polster, damit eine fast flache Linie nicht am Rand klebt.
 * Eine ganz flache Reihe wird zur Mittellinie: flach ist eine Antwort.
 */
export function linienPunkte(
  reihe: Reihe | undefined,
  breite: number,
  hoehe: number
): string {
  const punkte = (reihe ?? []).filter(
    (punkt) => Array.isArray(punkt) && Number.isFinite(punkt[0]) && Number.isFinite(punkt[1])
  );
  if (punkte.length < 2) return '';
  const zeiten = punkte.map((punkt) => punkt[0]);
  const werte = punkte.map((punkt) => punkt[1]);
  const t0 = Math.min(...zeiten);
  const t1 = Math.max(...zeiten);
  const min = Math.min(...werte);
  const max = Math.max(...werte);
  const spanne = max - min || 1;
  const polster = hoehe * 0.15;
  return punkte
    .map(([at, wert]) => {
      const x = t1 === t0 ? 0 : ((at - t0) / (t1 - t0)) * breite;
      const y =
        max === min
          ? hoehe / 2
          : polster + (1 - (wert - min) / spanne) * (hoehe - 2 * polster);
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    })
    .join(' ');
}
