/**
 * Weisstöne, die zur Auswahl stehen - und wie man sie ausspricht.
 *
 * Mirek statt Kelvin, weil die Lampen so rechnen (153 = 6500 K,
 * 500 = 2000 K) - auf dem Knopf steht trotzdem das Wort, das man
 * benutzt, wenn man eine Glühbirne kauft.
 *
 * Hier und nicht mehr im Ablauf-Entwurf: Auch die Zeile, die einen
 * gespeicherten Ablauf vorliest (lib/ablaufsatz.ts), braucht die Wörter,
 * und eine Lib soll nichts aus einem Bildschirm holen müssen.
 */

/**
 * Die drei Stufen - und warum genau diese Zahlen.
 *
 * Sie folgen den Wörtern, die auf jeder Lampenpackung stehen:
 * warmweiss unter 3300 K, neutralweiss dazwischen, tageslichtweiss
 * über 5300 K. In Mirek gerechnet (1 000 000 / Kelvin):
 *
 * * **warmweiss** 370 = 2700 K - die klassische Glühbirne.
 * * **neutralweiss** 250 = 4000 K - das Licht über dem Arbeitstisch.
 * * **tageslichtweiss** 153 = 6500 K - und das ist zugleich das
 *   Kälteste, was eine Hue-Lampe kann; kälter geht es nicht.
 *
 * Vorher standen dort 286 (3500 K) und 200 (5000 K), und beides lag zu
 * warm: Aus dem Haus kam «wenn man auf Tageslicht stellt, ist es nicht
 * das Maximum an Kaltweiss» - und das stimmte, es fehlten 1500 Kelvin.
 * Eine Lampe, die 153 nicht schafft, bekommt von ihrer Bridge ohnehin
 * den kältesten Wert, den sie kann; zu hoch zu zielen kostet nichts,
 * zu niedrig verschenkt die halbe Spanne.
 */
export const WEISSTOENE: { key: string; label: string; mirek: number }[] = [
  { key: 'warm', label: 'warmweiss', mirek: 370 },
  { key: 'neutral', label: 'neutralweiss', mirek: 250 },
  { key: 'kalt', label: 'tageslichtweiss', mirek: 153 },
];

/** Ein Weisston in Worten (rein, testbar) - «warmweiss» statt «370».
 *
 *  Was nicht auf der Liste steht (aus einer von Hand geschriebenen
 *  config.yaml), kommt in Kelvin: Das ist die Zahl, die auf der
 *  Packung steht - Mirek kennt ausserhalb der Bridge niemand. */
export function weissWort(mirek: number): string {
  const treffer = WEISSTOENE.find((ton) => ton.mirek === mirek);
  if (treffer) return treffer.label;
  return `${Math.round(1_000_000 / mirek)} K`;
}
