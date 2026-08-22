/**
 * Skalierte Zutatenmengen so schreiben, wie man in einer Küche spricht
 * (Punkt 147 der Werkbank).
 *
 * Wer von 4 auf 3 Portionen stellt, soll «¾ TL» und «190 g» lesen, nicht
 * «0,75 TL» und «187,5 g». Niemand wiegt 187,5 Gramm ab – die Anzeige
 * täte nur so, als ginge das.
 *
 * Gerundet wird nur beim Skalieren: Was jemand selbst erfasst hat, wird
 * unverändert angezeigt (und beim Bearbeiten unverändert zurückgegeben).
 */

// Die Brüche, die auf Messlöffeln und in Rezepten wirklich vorkommen.
// Achtel bewusst nicht: «⅜ TL» liest niemand flüssig.
const BRUECHE: [number, string][] = [
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.5, '½'],
  [2 / 3, '⅔'],
  [0.75, '¾'],
];

/** Eine skalierte Menge küchentauglich schreiben (rein, testbar). */
export function kuechenMenge(wert: number): string {
  if (!Number.isFinite(wert) || wert < 0) return String(wert);
  // Grosse Mengen: auf Waagen-Schritte runden. Ab 100 auf 5er (187,5 g
  // → 190 g), ab 20 auf ganze - feiner misst in einer Küche niemand.
  if (wert >= 100) return String(Math.round(wert / 5) * 5);
  if (wert >= 20) return String(Math.round(wert));

  // Kleine Mengen: ganzer Anteil plus nächstliegender Bruch, wenn einer
  // nahe genug liegt («nahe genug» = 0,05 - mehr wäre gelogen).
  const ganz = Math.floor(wert);
  const rest = wert - ganz;
  if (rest < 0.05) return ganz === 0 && wert > 0 ? naturbelassen(wert) : String(ganz);
  if (rest > 0.95) return String(ganz + 1);
  for (const [bruch, zeichen] of BRUECHE) {
    if (Math.abs(rest - bruch) <= 0.05) {
      return ganz > 0 ? `${ganz}${zeichen}` : zeichen;
    }
  }
  return naturbelassen(wert);
}

/** Ohne passenden Bruch: zwei Stellen, Komma statt Punkt. */
function naturbelassen(wert: number): string {
  const gerundet = Math.round(wert * 100) / 100;
  return String(gerundet).replace('.', ',');
}

/** Menge skaliert auf die gewählten Portionen, hübsch formatiert (rein).
 *
 *  Küchenrundung nur beim wirklichen Skalieren: Bei Faktor 1 bleibt
 *  stehen, was jemand erfasst hat – sonst veränderte schon das
 *  Bearbeiten-Formular die Mengen. */
export function scaledAmount(amount: unknown, factor: number): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return String(amount ?? '');
  const scaled = value * factor;
  if (factor !== 1) return kuechenMenge(scaled);
  const rounded = Math.round(scaled * 100) / 100;
  return String(Number.isInteger(rounded) ? rounded : rounded).replace('.', ',');
}
