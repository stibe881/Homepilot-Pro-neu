/**
 * Die Reihenfolge der Favoritenkacheln – auch der, die kein Gerät sind.
 *
 * Der Fall aus dem Haus: «Durchsagen kann man nicht sortieren bei den
 * Favoriten.» Stimmt – und der Grund war, dass die Durchsage gar keine
 * Kachel *in* der Liste war, sondern fest hinter ihr stand. Die Liste
 * enthielt Entitäten, und die Durchsage hängt an keiner: Sie hängt
 * daran, ob es überhaupt eine Box gibt, die etwas abspielen kann.
 *
 * Sie bekommt darum hier eine eigene Kennung und reiht sich ein wie
 * jede andere. Was sie nicht verliert, ist ihr Platz von Haus aus:
 * Unbekannte Kennungen hängen sich hinten an, und ohne eigene
 * Reihenfolge steht sie damit weiterhin zuletzt – die Favoriten sind
 * persönlich gewählt, die Durchsage steht immer da, und vorn schöbe sie
 * jeden Abend das weg, wofür jemand den Stern gesetzt hat.
 */

/**
 * Die Kennung der Durchsage-Kachel in der Reihenfolge.
 *
 * Mit Doppelpunkt, damit sie mit keiner Entitätskennung kollidieren
 * kann: Die heissen ``integration.objekt`` und haben nie einen.
 */
export const DURCHSAGE_ID = 'kachel:durchsage';

/**
 * Kacheln in die gespeicherte Reihenfolge bringen (rein, testbar).
 *
 * Was in der Reihenfolge steht, kommt zuerst und in deren Abfolge. Was
 * nicht darin steht, hängt sich hinten an und behält dort seine
 * ursprüngliche Ordnung – neu hinzugekommene Favoriten sollen die
 * gewachsene Reihung nicht durcheinanderbringen.
 *
 * Kennungen in der Reihenfolge, zu denen es keine Kachel (mehr) gibt,
 * werden übergangen: Ein entsterntes Gerät soll keine Lücke lassen.
 */
export function favoritenOrdnen<T extends { id: string }>(
  kacheln: T[],
  reihenfolge?: readonly string[] | null
): T[] {
  const rang = new Map((reihenfolge ?? []).map((id, index) => [id, index]));
  return [...kacheln].sort((a, b) => {
    const ai = rang.has(a.id) ? (rang.get(a.id) as number) : Infinity;
    const bi = rang.has(b.id) ? (rang.get(b.id) as number) : Infinity;
    return ai !== bi ? ai - bi : kacheln.indexOf(a) - kacheln.indexOf(b);
  });
}
