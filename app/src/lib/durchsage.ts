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
 * Womit die Liste anfängt.
 *
 * Was in einem Haushalt tatsächlich über die Boxen geht, und zwar in
 * der Reihenfolge, in der es gebraucht wird: erst das Essen, dann das
 * Aufbrechen, dann der Rest.
 *
 * **Ein Startbestand, keine Grundausstattung.** Sie standen früher
 * unveränderlich unter den eigenen Sätzen: nicht zu ändern, nicht zu
 * löschen, und im Fenster stand sogar «die mitgelieferten Sätze bleiben
 * immer da». Das war eine Bevormundung - wer «Bitte einmal ans Telefon»
 * nie sagt, will ihn weghaben, und wer «Gute Nacht!» lieber duzt, will
 * ihn umformulieren. Sobald jemand die Liste zum ersten Mal anfasst,
 * werden sie zu ganz normalen Einträgen.
 */
export const STANDARDTEXTE = [
  'Essen ist fertig!',
  'Bitte zum Essen kommen.',
  'Wir gehen los.',
  'Besuch ist da.',
  'Bitte einmal ans Telefon.',
  'Gute Nacht!',
] as const;

/** So viele Sätze darf die Liste führen - mehr scrollt nur. */
export const HOECHSTENS_EIGENE = 12;

/** Ein Satz für den Vergleich: ohne Rand, ohne Gross- und Kleinschreibung. */
function schluessel(text: string): string {
  return text.trim().toLowerCase();
}

/** Was ein Satz gespeichert bringt. */
export interface SatzPrefs {
  /** Der zuletzt getippte Satz aus älteren Fassungen. Er wird beim
   *  ersten Anfassen in die Liste gefaltet und danach nicht mehr
   *  geschrieben - ein Satz, der sich von selbst merkt und den man nicht
   *  löschen kann, ist genau das Ärgernis, das hier weggeht. */
  letzter?: string;
  /** Die Liste. `undefined` heisst «noch nie angefasst» - dann gilt der
   *  Startbestand. Ein leeres Feld heisst «bewusst leer» und bleibt
   *  leer: Zurückkommende Sätze wären derselbe Fehler wie eine Kachel,
   *  die man nicht ausgeblendet bekommt. */
  texte?: string[];
}

function sauberListe(roh: string[]): string[] {
  const raus: string[] = [];
  const gesehen = new Set<string>();
  for (const text of roh) {
    const sauber = String(text ?? '').trim();
    if (!sauber || gesehen.has(schluessel(sauber))) continue;
    gesehen.add(schluessel(sauber));
    raus.push(sauber);
  }
  return raus.slice(0, HOECHSTENS_EIGENE);
}

/**
 * Die Sätze im Fenster - alle gleichrangig (rein, testbar).
 *
 * Eine Liste, nicht zwei. Vorher lagen die eigenen über den
 * mitgelieferten, und nur die eigenen liessen sich ändern; die
 * mitgelieferten waren gesetzt. Jetzt sind sie der Anfang derselben
 * Liste, und ab dem ersten Handgriff gehört sie ganz dem Haushalt.
 */
export function saetze(prefs: SatzPrefs): string[] {
  const grundlage = prefs.texte ?? [...STANDARDTEXTE];
  // Der alte «letzter» wandert vorne hinein - dort stand er auch bisher.
  return sauberListe([prefs.letzter ?? '', ...grundlage]);
}

/** Nur der Name von früher; die Liste ist jetzt eine (rein, testbar). */
export const vorschlaege = saetze;

/**
 * Was nach einer selbst getippten Durchsage in die Liste kommt
 * (rein, testbar).
 *
 * `null` heisst: nichts zu tun - der Satz steht schon da oder ist leer.
 * Vorher landete er in einem eigenen Feld, das genau einen Satz hielt
 * und beim nächsten überschrieben wurde; wer ihn behalten wollte,
 * musste ihn ein zweites Mal von Hand eintragen.
 */
export function nachDemSenden(prefs: SatzPrefs, text: string): string[] | null {
  const sauber = String(text ?? '').trim();
  if (!sauber) return null;
  const bisher = saetze(prefs);
  if (bisher.some((eintrag) => schluessel(eintrag) === schluessel(sauber))) {
    // Schon da - aber wenn die Liste noch der Startbestand ist, muss sie
    // trotzdem einmal festgeschrieben werden, sonst bliebe sie flüchtig.
    return prefs.texte === undefined ? bisher : null;
  }
  return sauberListe([...bisher, sauber]);
}

/** Einen Satz aufnehmen (rein, testbar).
 *
 *  Hinten an: Die Liste ist die Reihenfolge, die jemand angelegt hat -
 *  ein Neuzugang drängelt sich nicht vor. Doppelte und Leeres ändern
 *  nichts. */
export function satzHinzufuegen(prefs: SatzPrefs, neu: string): string[] {
  const sauber = String(neu ?? '').trim();
  const bisher = saetze(prefs);
  if (!sauber) return bisher;
  if (bisher.some((eintrag) => schluessel(eintrag) === schluessel(sauber))) return bisher;
  return sauberListe([...bisher, sauber]);
}

/** Einen Satz umformulieren (rein, testbar).
 *
 *  An Ort und Stelle, nicht löschen-und-anhängen: Der Satz behält
 *  seinen Platz. Ein leerer neuer Text ist ein Löschen - dafür gibt es
 *  den Papierkorb, hier ändert er nichts. */
export function satzAendern(prefs: SatzPrefs, alt: string, neu: string): string[] {
  const sauber = String(neu ?? '').trim();
  const bisher = saetze(prefs);
  if (!sauber) return bisher;
  return sauberListe(
    bisher.map((eintrag) => (schluessel(eintrag) === schluessel(alt) ? sauber : eintrag))
  );
}

/** Einen Satz herauswerfen (rein, testbar). Auch einen mitgelieferten. */
export function satzLoeschen(prefs: SatzPrefs, alt: string): string[] {
  return saetze(prefs).filter((eintrag) => schluessel(eintrag) !== schluessel(alt));
}

/** Den Startbestand zurückholen (rein, testbar).
 *
 *  Der Weg zurück, wenn jemand die Liste leergeräumt hat und es bereut.
 *  Was schon dasteht, bleibt stehen - zurückgeholt wird nur, was fehlt.
 */
export function standardZurueck(prefs: SatzPrefs): string[] {
  return sauberListe([...saetze(prefs), ...STANDARDTEXTE]);
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
