/**
 * Was heute auf den Tisch kommt – als eine Zeile für die Startseite.
 *
 * Punkt 587 der Werkbank: Das Abendessen stand im Wochenplan und
 * nirgends sonst. Wer um 17 Uhr am Wandpanel steht, ging vier Tipps
 * tief, um zu sehen, was heute kochen heisst. Hier steht rein und
 * testbar, welcher Eintrag des Essensplans «heute» ist und ab wann die
 * Zeile überhaupt etwas zu sagen hat.
 *
 * Ab 15 Uhr und nicht den ganzen Tag: Am Morgen ist das Abendessen
 * keine Frage, und eine Zeile, die immer da ist, liest bald niemand
 * mehr – dieselbe Regel wie beim UV-Hinweis auf der Wetterkarte.
 */

/** Ein Eintrag des Essensplans, so offen wie der Hub ihn speichert. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Eintrag = Record<string, any>;

/** Ab dieser Stunde steht die Zeile auf der Startseite. */
export const AB_STUNDE = 15;

/** Die Tage, wie der Essensplan sie nennt (screens/family/bausteine.tsx,
 *  WEEK_DAYS) – hier noch einmal, weil lib/ nichts aus screens/ zieht. */
const TAGE_LANG = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
];

/** Der Name des heutigen Tages im Essensplan (rein, testbar). */
export function planTag(jetzt: Date): string {
  return TAGE_LANG[(jetzt.getDay() + 6) % 7];
}

/**
 * Der Eintrag des Essensplans für heute (rein, testbar) – oder null.
 *
 * Unabhängig von der Uhrzeit: Wer die Zeile nur ab einer Stunde will,
 * nimmt `tagesgerichtZeile`. Die Kennung des Rezepts reist mit, damit
 * der Tipp dorthin führen kann.
 */
export function tagesgericht(
  meals: Eintrag[] | null | undefined,
  jetzt: Date
): { text: string; recipeId: string | null } | null {
  const tag = planTag(jetzt);
  const eintrag = (meals ?? []).find(
    (meal) => meal && String(meal.day ?? '') === tag && String(meal.text ?? '').trim()
  );
  if (!eintrag) return null;
  return {
    text: String(eintrag.text).trim(),
    recipeId: eintrag.recipe_id ? String(eintrag.recipe_id) : null,
  };
}

/** «Heute: Lasagne» – ab 15 Uhr, sonst null (rein, testbar). */
export function tagesgerichtZeile(
  meals: Eintrag[] | null | undefined,
  jetzt: Date,
  abStunde = AB_STUNDE
): string | null {
  if (jetzt.getHours() < abStunde) return null;
  const gericht = tagesgericht(meals, jetzt);
  return gericht ? `Heute: ${gericht.text}` : null;
}
