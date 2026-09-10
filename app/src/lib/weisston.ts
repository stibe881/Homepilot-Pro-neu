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

export const WEISSTOENE: { key: string; label: string; mirek: number }[] = [
  { key: 'warm', label: 'warmweiss', mirek: 370 },
  { key: 'neutral', label: 'neutralweiss', mirek: 286 },
  { key: 'kalt', label: 'tageslichtweiss', mirek: 200 },
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
