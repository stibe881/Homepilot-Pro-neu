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

// Es gab hier einen Deckel von acht Zeilen und darunter «… und 6
// weitere». Aus dem Haus kam dazu: Genau die sechs will man sehen. Der
// Deckel sparte Platz an der einzigen Stelle, an der jemand freiwillig
// liest - vor einem Knopf, der das Haus für ein paar Minuten
// durchstartet. Die Liste ist jetzt vollständig; gedeckelt wird die
// Höhe des Kastens, nicht der Inhalt (SystemScreen.tsx).

export type VorschauArt =
  /** Liste seit dem laufenden Stand. */
  | 'genau'
  /** Der Vergleich war nicht möglich - es wird bewusst nichts aufgezählt. */
  | 'ungefaehr'
  /** Es gibt nachweislich nichts Neues. */
  | 'nichts'
  /** Keine Auskunft (alter Dienst, keine Antwort) - alter Erklärtext. */
  | 'keine';

/** Die Zeilen für den Dialog (rein, testbar). */
export function vorschauZeilen(vorschau: UpdateVorschau | null | undefined): {
  art: VorschauArt;
  zeilen: string[];
} {
  if (!vorschau || vorschau.available !== true) {
    return { art: 'keine', zeilen: [] };
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
    return { art: vorschau.exact ? 'nichts' : 'keine', zeilen: [] };
  }
  // Ohne genauen Vergleich wird nichts aufgezählt. Die Liste hiess
  // «die jüngsten Änderungen» und zeigte die zehn neusten Commits des
  // Zweigs - ob sie schon laufen oder nicht. Aus dem Haus kam dazu:
  // «momentan stehen da auch Sachen drin, die bereits im letzten Update
  // gemacht wurden.» Genau so ist es, und die Klammer daneben («liess
  // sich nicht genau vergleichen») liest niemand als Warnung. Wer vor
  // dem Knopf steht, will wissen, was *noch* kommt; eine Liste, die im
  // Zweifel schon Ausgeliefertes nennt, beantwortet das nicht, sondern
  // führt in die Irre. Dann lieber ein ehrlicher Satz und keine Liste.
  if (!vorschau.exact) return { art: 'ungefaehr', zeilen: [] };
  return { art: 'genau', zeilen: alle };
}
