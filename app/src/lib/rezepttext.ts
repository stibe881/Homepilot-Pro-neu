/**
 * Ein Rezept als Text fürs Teilen-Blatt (Punkt 149 der Werkbank).
 *
 * «Schickst du mir das Rezept?» endete vorher in Screenshots. Hier
 * entsteht die Textform für WhatsApp, Mail und Notizen – mit den
 * *eingestellten* Portionen: Wer für 6 statt 4 kocht und dann teilt,
 * meint die 6er-Mengen.
 */

import { scaledAmount } from './mengen';

// Dieselbe offene Form wie im Rezeptbuch: Die Felder wachsen mit dem
// Modul, und sie hier abschliessend zu tippen hiesse, das Hub-Schema zu
// duplizieren.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rezept = Record<string, any>;

/** Rezept als lesbarer Text (rein, testbar). */
export function rezeptAlsText(recipe: Rezept, factor: number, servings: number): string {
  const zeilen: string[] = [String(recipe.text ?? '')];
  if (servings > 0) zeilen.push(`Für ${servings} ${servings === 1 ? 'Portion' : 'Portionen'}`);
  const ingredients: Rezept[] = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  if (ingredients.length > 0) {
    zeilen.push('', 'Zutaten:');
    for (const zutat of ingredients) {
      const menge = [scaledAmount(zutat?.amount, factor), zutat?.unit].filter(Boolean).join(' ');
      zeilen.push(`- ${[menge, String(zutat?.name ?? '')].filter(Boolean).join(' ')}`);
    }
  }
  const steps = (Array.isArray(recipe.instructions) ? recipe.instructions : [])
    .map((step: unknown) =>
      typeof step === 'string' ? step : String((step as Rezept)?.text ?? '')
    )
    .map((text: string) => text.trim())
    .filter(Boolean);
  if (steps.length > 0) {
    zeilen.push('', 'Zubereitung:');
    steps.forEach((text: string, index: number) => zeilen.push(`${index + 1}. ${text}`));
  }
  if (recipe.source) zeilen.push('', `Quelle: ${String(recipe.source)}`);
  return zeilen.join('\n');
}
