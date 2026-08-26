/**
 * Die Durchsage als Favoritenkachel – was in ihrem Fenster steht.
 *
 * Sie lag als breite Karte unter Einstellungen → Lautsprecher: ein
 * leeres Textfeld und darunter fünfzehn Lautsprechernamen als Chips.
 * Wer «Essen ist fertig» rufen wollte, ging drei Ecken weit, tippte den
 * Satz und suchte die richtige Box aus einer Wand von Namen – jedes
 * Mal denselben Satz, jedes Mal dieselbe Box.
 *
 * Hier steht die Mechanik für den kurzen Weg: eine Kachel bei den
 * Favoriten, dahinter ein Ziel und eine Handvoll fertiger Sätze. Zwei
 * Tipper statt Tippen.
 */
import { Box, ZIEL_ALLE, sprecherFuer } from './vorlesen';

export type { Box };
export { ZIEL_ALLE, sprecherFuer };

/**
 * Die mitgelieferten Sätze.
 *
 * Was in einem Haushalt tatsächlich über die Boxen geht, und zwar in
 * der Reihenfolge, in der es gebraucht wird: erst das Essen, dann das
 * Aufbrechen, dann der Rest. Wer etwas anderes sagen will, tippt es
 * weiterhin - und findet es beim nächsten Mal oben in der Liste.
 */
export const STANDARDTEXTE = [
  'Essen ist fertig!',
  'Bitte zum Essen kommen.',
  'Wir gehen los.',
  'Besuch ist da.',
  'Bitte einmal ans Telefon.',
  'Gute Nacht!',
] as const;

/** So viele Sätze stehen höchstens im Fenster – darunter wird es eine Liste. */
export const HOECHSTENS_TEXTE = 8;

/** So viele selbst getippte Sätze merkt sich die App. */
export const HOECHSTENS_GEMERKT = 4;

/** Ein Satz für den Vergleich: ohne Rand, ohne Gross- und Kleinschreibung. */
function schluessel(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Die Sätze im Fenster (rein, testbar).
 *
 * Selbst getippte zuerst: Wer einmal «Der Znüni steht bereit» gesagt
 * hat, sagt es wieder, und dann soll es nicht hinter sechs
 * mitgelieferten Sätzen stehen. Doppelte fallen weg - «Essen ist
 * fertig!» soll nicht zweimal dastehen, nur weil es einmal von Hand
 * getippt wurde.
 */
export function vorschlaege(gemerkte: string[] | undefined): string[] {
  const raus: string[] = [];
  const gesehen = new Set<string>();
  for (const text of [...(gemerkte ?? []), ...STANDARDTEXTE]) {
    const sauber = String(text ?? '').trim();
    if (!sauber || gesehen.has(schluessel(sauber))) continue;
    gesehen.add(schluessel(sauber));
    raus.push(sauber);
    if (raus.length >= HOECHSTENS_TEXTE) break;
  }
  return raus;
}

/**
 * Was nach einer selbst getippten Durchsage gemerkt wird (rein, testbar).
 *
 * Nur das Selbstgetippte: Die mitgelieferten Sätze stehen ohnehin da,
 * und sie in die Merkliste zu schreiben verdrängte genau das, wofür
 * sie da ist. `null` heisst: nichts zu ändern.
 */
export function merken(
  gemerkte: string[] | undefined,
  text: string
): string[] | null {
  const sauber = String(text ?? '').trim();
  if (!sauber) return null;
  const key = schluessel(sauber);
  if (STANDARDTEXTE.some((eintrag) => schluessel(eintrag) === key)) return null;
  // Ein schon gemerkter Satz wandert nach vorn, statt ein zweites Mal
  // in der Liste zu stehen.
  const bisher = (gemerkte ?? []).filter((eintrag) => schluessel(eintrag) !== key);
  return [sauber, ...bisher].slice(0, HOECHSTENS_GEMERKT);
}

/**
 * Die Boxen, die eine Durchsage abspielen können (rein, testbar).
 *
 * Nach Namen sortiert - die Reihenfolge, in der der Hub sie liefert,
 * ist die seiner Integrationen und für einen Menschen keine.
 */
export function boxen(
  entities: { id: string; name: string; commands: string[]; available?: boolean }[]
): Box[] {
  return entities
    .filter((entity) => entity.commands?.includes('play_url') && entity.available !== false)
    .map((entity) => ({ id: entity.id, name: entity.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
}

/**
 * Die Auswahlliste des Fensters (rein, testbar).
 *
 * «Alle Boxen» zuoberst und als Vorgabe: Das ist der Regelfall einer
 * Durchsage. Anders als beim Vorlesen im Rezept gibt es hier kein
 * «dieses Gerät» - eine Durchsage geht durchs Haus, sonst wäre sie
 * keine.
 */
export function zieleFuer(alle: Box[]): Box[] {
  return [{ id: ZIEL_ALLE, name: 'Alle Boxen' }, ...alle];
}

/** Was auf der Kachel und im Auswahlknopf steht (rein, testbar). */
export function zielText(ziel: string, alle: Box[]): string {
  if (!ziel || ziel === ZIEL_ALLE) return 'Alle Boxen';
  const box = alle.find((eintrag) => eintrag.id === ziel);
  // Eine Box, die es nicht mehr gibt - umbenannt, abgehängt, offline.
  // Dann lieber wieder «alle» als ein Name, den niemand wiederfindet.
  return box ? box.name : 'Alle Boxen';
}

/**
 * Ist das gemerkte Ziel noch da? (rein, testbar)
 *
 * Eine Box, die aus dem Netz verschwunden ist, bliebe sonst als
 * Vorauswahl stehen - und die Durchsage ginge ins Leere, ohne dass
 * jemand sähe, warum.
 */
export function gueltigesZiel(ziel: string | undefined, alle: Box[]): string {
  if (!ziel || ziel === ZIEL_ALLE) return ZIEL_ALLE;
  return alle.some((box) => box.id === ziel) ? ziel : ZIEL_ALLE;
}

/**
 * Was nach dem Senden dasteht (rein, testbar).
 *
 * Der Hub meldet, welche Boxen er erreicht hat und welche nicht. Beides
 * gehört hin: Eine Durchsage, die eine Box verpasst hat, sieht sonst
 * genauso aus wie eine, die durchkam.
 */
export function bestaetigung(antwort: {
  sent?: string[];
  errors?: string[];
}): string {
  const erreicht = antwort?.sent ?? [];
  const daneben = antwort?.errors ?? [];
  const kopf =
    erreicht.length === 0
      ? 'Keine Box erreicht'
      : erreicht.length === 1
        ? `Läuft auf ${erreicht[0]}`
        : `Läuft auf ${erreicht.length} Boxen`;
  return daneben.length > 0 ? `${kopf} · nicht erreicht: ${daneben.join(', ')}` : kopf;
}
