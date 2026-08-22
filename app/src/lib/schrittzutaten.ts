/**
 * Welche Zutaten meint dieser Kochschritt? (Punkt 142 der Werkbank)
 *
 * Im Kochmodus will man meist nur wissen, wieviel von dem, was DIESER
 * Schritt verlangt - nicht die ganze Liste aufklappen. Hier wird der
 * Schritttext nach den Zutatennamen abgesucht.
 *
 * Deutsch dekliniert: Im Rezept stehen «Zwiebeln», im Schritt «die
 * Zwiebel anbraten» - darum vergleichen wir Wortstämme (Endungen -en,
 * -e, -n, -s fallen weg), nicht ganze Wörter.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Zutat = Record<string, any>;

/** Wortstamm: klein, ohne die häufigen deutschen Endungen (rein). */
function stamm(wort: string): string {
  const klein = wort.toLowerCase();
  for (const endung of ['en', 'e', 'n', 's']) {
    if (klein.length - endung.length >= 4 && klein.endsWith(endung)) {
      return klein.slice(0, -endung.length);
    }
  }
  return klein;
}

/** Die Wörter eines Texts, die als Erkennungsmerkmal taugen (≥ 4 Zeichen -
 *  «Ei» und «TL» stecken in zu vielen anderen Wörtern). */
function woerter(text: string): string[] {
  return String(text ?? '')
    .split(/[^A-Za-zÄÖÜäöüß]+/)
    .filter((wort) => wort.length >= 4);
}

/** Die Zutaten, die im Schritttext vorkommen (rein, testbar). */
export function zutatenImSchritt(stepText: string, ingredients: Zutat[]): Zutat[] {
  const schrittStaemme = new Set(woerter(stepText).map(stamm));
  if (schrittStaemme.size === 0) return [];
  return ingredients.filter((zutat) =>
    woerter(String(zutat?.name ?? '')).some((wort) => schrittStaemme.has(stamm(wort)))
  );
}
