/**
 * Welche Farben eine Szene setzt – als kleine Punkte auf dem Knopf.
 *
 * «Kino» und «Lesen» sehen als Knöpfe gleich aus, obwohl das eine den
 * Raum rot dimmt und das andere kaltweiss aufdreht. Die Punkte zeigen
 * die Stimmung, bevor man drückt – dieselbe Auskunft, die der Editor
 * beim Anlegen zeigte, nur eben dort, wo ausgelöst wird.
 *
 * Nur was ausdrücklich gewählt wurde: Farben (`set_color`) und
 * Weisstöne (`set_color_temp`). Eine Szene, die bloss schaltet oder
 * dimmt, bekommt keine Punkte – ein geratener Farbton wäre eine
 * Behauptung über eine Lampe, deren Farbe die Szene gar nicht anfasst.
 */

/** Ein Weisston als anzeigbare Farbe (rein, testbar).
 *
 *  Die Grenzen liegen zwischen den drei Weisstönen des Editors
 *  (200/286/370 Mirek) – wer dort «warmweiss» gewählt hat, soll hier
 *  denselben Ton wiedererkennen. */
export function weisstonFarbe(mirek: number): string {
  if (mirek >= 330) return '#FFD9A0'; // warmweiss
  if (mirek >= 240) return '#FFF1D6'; // neutralweiss
  return '#DCEBFF'; // tageslichtweiss
}

/** Die Farbpunkte einer Szene, höchstens vier (rein, testbar). */
export function szenenFarben(
  actions: { command: string; data?: { color?: string; color_temp?: number } }[] | undefined
): string[] {
  const punkte: string[] = [];
  for (const action of actions ?? []) {
    let farbe: string | null = null;
    if (action.command === 'set_color' && typeof action.data?.color === 'string') {
      farbe = action.data.color;
    } else if (
      action.command === 'set_color_temp' &&
      typeof action.data?.color_temp === 'number'
    ) {
      farbe = weisstonFarbe(action.data.color_temp);
    }
    // Doppelte zusammenfassen: Fünf rote Spots sind eine Stimmung,
    // nicht fünf Punkte.
    if (farbe && !punkte.includes(farbe)) punkte.push(farbe);
    if (punkte.length >= 4) break;
  }
  return punkte;
}
