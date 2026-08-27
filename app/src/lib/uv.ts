/**
 * Der UV-Index in Worten – dieselben Stufen wie beim Hub.
 *
 * Die Zahl allein deutet niemand richtig («ist 6 viel?»); die
 * WHO-Stufen schon. Unter «mässig» sagt die Karte nichts – eine Zahl,
 * die immer dasteht, liest bald niemand mehr.
 */
export function uvWort(index: unknown): string | null {
  const wert = Number(index);
  if (!Number.isFinite(wert)) return null;
  if (wert >= 11) return 'extrem';
  if (wert >= 8) return 'sehr hoch';
  if (wert >= 6) return 'hoch';
  if (wert >= 3) return 'mässig';
  return null;
}
