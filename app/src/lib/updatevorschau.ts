/**
 * Was der Update-Dialog statt des Erklärtexts zeigt.
 *
 * «Update wirklich starten?» stand über einem Absatz, der erklärte, wie
 * das Update funktioniert - aber nicht, was es bringt. Genau das will
 * man vor dem Knopfdruck wissen. Die Liste holt der Update-Dienst auf
 * dem Host bei GitHub (Betreffzeilen seit dem laufenden Stand); hier
 * wird daraus, was der Dialog zeigt.
 */

export interface UpdateVorschau {
  available?: boolean;
  commits?: string[];
  /** True: Liste seit dem laufenden Stand. False: nur die jüngsten
   *  Zeilen des Zweigs - GitHub kannte den laufenden Stand nicht. */
  exact?: boolean;
}

/** Mehr liest vor einem Knopfdruck niemand - der Rest wird gezählt. */
export const HOECHSTENS_ZEILEN = 8;

export type VorschauArt =
  /** Liste seit dem laufenden Stand. */
  | 'genau'
  /** Nur die jüngsten Zeilen - Vergleich war nicht möglich. */
  | 'ungefaehr'
  /** Es gibt nachweislich nichts Neues. */
  | 'nichts'
  /** Keine Auskunft (alter Dienst, keine Antwort) - alter Erklärtext. */
  | 'keine';

/** Die Zeilen für den Dialog (rein, testbar). */
export function vorschauZeilen(vorschau: UpdateVorschau | null | undefined): {
  art: VorschauArt;
  zeilen: string[];
  /** Wie viele Zeilen der Deckel abgeschnitten hat. */
  mehr: number;
} {
  if (!vorschau || vorschau.available !== true) {
    return { art: 'keine', zeilen: [], mehr: 0 };
  }
  const alle = (vorschau.commits ?? []).filter(
    (zeile) =>
      typeof zeile === 'string' &&
      zeile.trim() &&
      // Zusammenführungen («Merge remote-tracking branch …») sind
      // Buchhaltung des Zweige-Abgleichs, keine Änderung. Der
      // Update-Dienst filtert sie inzwischen selbst - aber er frischt
      // sich erst beim übernächsten Update auf, und hier ist der Filter
      // sofort da. Eigene Commits beginnen nie mit «Merge ».
      !zeile.trim().startsWith('Merge ')
  );
  if (alle.length === 0) {
    // Nur die genaue Antwort darf «nichts Neues» behaupten - eine
    // leere Näherungsliste heisst bloss, dass GitHub nichts hergab.
    return { art: vorschau.exact ? 'nichts' : 'keine', zeilen: [], mehr: 0 };
  }
  return {
    art: vorschau.exact ? 'genau' : 'ungefaehr',
    zeilen: alle.slice(0, HOECHSTENS_ZEILEN),
    mehr: Math.max(0, alle.length - HOECHSTENS_ZEILEN),
  };
}
