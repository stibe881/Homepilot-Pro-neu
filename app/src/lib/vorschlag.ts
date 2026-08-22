/**
 * «Was koche ich heute?» (Punkt 139 der Werkbank).
 *
 * Das Rezeptbuch weiss, was Favorit ist und wann jedes Gericht zuletzt
 * gekocht wurde - aber die Antwort auf die tägliche Frage musste man
 * sich selbst zusammensuchen. Hier steht die Gewichtung; die Bildschirme
 * zeigen nur an, was sie liefert.
 *
 * Der Zufall kommt als Funktion herein, damit die Tests würfeln können,
 * ohne zu würfeln.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rezept = Record<string, any>;

/** Tage seit dem letzten Kochen - nie gekocht zählt als sehr lange her. */
function tageSeit(lastCooked: unknown, heute: string): number {
  const datum = String(lastCooked ?? '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(datum)) return 9999;
  const dann = Date.parse(datum.slice(0, 10));
  const jetzt = Date.parse(heute);
  if (!Number.isFinite(dann) || !Number.isFinite(jetzt)) return 9999;
  return Math.max(0, Math.round((jetzt - dann) / 86_400_000));
}

/**
 * Die n besten Kandidaten für heute (rein, testbar).
 *
 * Gewichtung: lange nicht gekocht wiegt am meisten (gedeckelt bei 60
 * Tagen, sonst gewinnt immer das älteste), Favoriten bekommen einen
 * Bonus, und etwas Zufall sorgt dafür, dass nicht jeden Abend dieselben
 * drei erscheinen.
 */
export function kochVorschlaege(
  recipes: Rezept[],
  anzahl: number,
  heute: string,
  zufall: () => number = Math.random
): Rezept[] {
  return recipes
    .filter((recipe) => String(recipe?.text ?? '').trim())
    .map((recipe) => ({
      recipe,
      punkte:
        Math.min(60, tageSeit(recipe.last_cooked, heute)) +
        (recipe.favorite ? 25 : 0) +
        zufall() * 30,
    }))
    .sort((a, b) => b.punkte - a.punkte)
    .slice(0, anzahl)
    .map((eintrag) => eintrag.recipe);
}

/** Deterministischer Würfel für Bildschirme ohne useMemo-Halt: gleiche
 *  Saat, gleiche Vorschläge - erst der nächste Wurf mischt neu. Sonst
 *  würfelte jedes Live-Update des Hubs die Liste um. */
export function wuerfel(saat: number): () => number {
  let stand = (saat * 2654435761) % 2 ** 32 || 1;
  return () => {
    stand = (stand * 1103515245 + 12345) % 2 ** 31;
    return stand / 2 ** 31;
  };
}

/** «vor 12 Tagen» / «noch nie gekocht» - die Begründung zum Vorschlag. */
export function vorschlagsGrund(recipe: Rezept, heute: string): string {
  const tage = tageSeit(recipe?.last_cooked, heute);
  if (tage >= 9999) return 'noch nie gekocht';
  if (tage === 0) return 'heute gekocht';
  if (tage === 1) return 'gestern gekocht';
  return `vor ${tage} Tagen gekocht`;
}
