import { kurz, WidgetButton } from './widgetButtons';

/**
 * Eigener Name und eigenes Symbol je Widget-Knopf (Punkt 647).
 *
 * Bis hierher hiess ein Knopf, wie das Gerät oder die Szene heisst, und
 * trug das Symbol seiner Art: jedes Licht eine Glühbirne, jede Szene
 * Funken. Auf dem Homescreen stehen sie nebeneinander, klein, ohne
 * weiteren Zusammenhang - und «Smart Lock Pro» neben «Haustüre», beide
 * mit demselben Schlüssel, beantwortet die Frage nicht, welcher von
 * beiden die Wohnungstüre ist. Ein Widget-Knopf ist keine Geräteliste;
 * er ist die Abkürzung, die man sich selbst legt.
 *
 * Deshalb hier je Schlüssel ein Name und ein Symbol - beide freiwillig.
 * Was nicht gesetzt ist, bleibt wie bisher: Der Knopf heisst nach dem
 * Gerät und trägt dessen Symbol. Das ist wichtiger, als es klingt - ein
 * umbenanntes Gerät soll seinen Knopf weiter mitziehen, solange niemand
 * ausdrücklich etwas anderes wollte.
 *
 * Reines Rechnen; wer es anzeigt, ist components/Widgets.tsx, und wer
 * es speichert, hooks/usePrefs.ts.
 */

export interface Knopfstil {
  /** Eigener Name, oder nichts - dann gilt der des Geräts. */
  name?: string;
  /** Eigenes SF-Symbol, oder nichts - dann das der Geräteart. */
  symbol?: string;
}

/** Je Knopfschlüssel, was daran eigen ist. */
export type Knopfstile = Record<string, Knopfstil>;

/**
 * Die Symbole zur Wahl - SF-Symbol fürs Widget, Ionicon für die App.
 *
 * Bewusst eine kurze, handverlesene Liste und kein Suchfeld über alle
 * fünftausend SF-Symbole: Ein Symbol, das die iOS-Fassung auf dem
 * Telefon nicht kennt, zeichnet im Widget **nichts** - der Knopf wäre
 * leer, und man sähe es erst auf dem Homescreen. Alle hier gibt es seit
 * iOS 14 - lange vor der ältesten Fassung, die HomePilot verlangt -, und
 * zu jedem steht das Ionicon daneben, mit dem die App denselben Knopf
 * zeigt. Zwei Listen wären zwei Stellen zum Vergessen.
 */
export const SYMBOLWAHL: { sf: string; ionicon: string; wort: string }[] = [
  { sf: 'lightbulb.fill', ionicon: 'bulb', wort: 'Licht' },
  { sf: 'power', ionicon: 'power', wort: 'Strom' },
  { sf: 'key.fill', ionicon: 'key', wort: 'Schlüssel' },
  { sf: 'lock.fill', ionicon: 'lock-closed', wort: 'Schloss' },
  { sf: 'shield.fill', ionicon: 'shield', wort: 'Alarm' },
  { sf: 'house.fill', ionicon: 'home', wort: 'Haus' },
  { sf: 'sparkles', ionicon: 'sparkles', wort: 'Szene' },
  { sf: 'bed.double.fill', ionicon: 'bed', wort: 'Schlafen' },
  { sf: 'music.note', ionicon: 'musical-note', wort: 'Noten' },
  { sf: 'film.fill', ionicon: 'film', wort: 'Kino' },
  { sf: 'tv.fill', ionicon: 'tv-outline', wort: 'Fernseher' },
  { sf: 'speaker.wave.2.fill', ionicon: 'volume-high', wort: 'Musik' },
  { sf: 'arrow.up.arrow.down', ionicon: 'swap-vertical', wort: 'Storen' },
  { sf: 'thermometer', ionicon: 'thermometer', wort: 'Wärme' },
  { sf: 'flame.fill', ionicon: 'flame', wort: 'Feuer' },
  { sf: 'drop.fill', ionicon: 'water', wort: 'Wasser' },
  { sf: 'wind', ionicon: 'cloudy', wort: 'Lüften' },
  { sf: 'sun.max.fill', ionicon: 'sunny', wort: 'Sonne' },
  { sf: 'moon.fill', ionicon: 'moon', wort: 'Nacht' },
  { sf: 'leaf.fill', ionicon: 'leaf', wort: 'Garten' },
  { sf: 'car.fill', ionicon: 'car', wort: 'Auto' },
  { sf: 'fork.knife', ionicon: 'restaurant', wort: 'Küche' },
  { sf: 'wand.and.stars', ionicon: 'color-wand', wort: 'Sauger' },
  { sf: 'star.fill', ionicon: 'star', wort: 'Stern' },
];

/** Wie die App ein SF-Symbol zeichnet (rein, testbar).
 *
 * Der Rückfall ist absichtlich ein sichtbares Zeichen und kein leeres
 * Feld: Ein Knopf ohne Bild sieht in der Liste aus wie ein Fehler. */
export function ionicon(sf: string): string {
  const treffer = SYMBOLWAHL.find((eintrag) => eintrag.sf === sf);
  if (treffer) return treffer.ionicon;
  // Was aus der Geräteart kommt und nicht in der Wahl steht - die Liste
  // zum Aussuchen ist kürzer als die, die `resolveButton` vergibt.
  if (sf.startsWith('lightbulb')) return 'bulb';
  if (sf.startsWith('key') || sf.startsWith('lock')) return 'key';
  if (sf.startsWith('shield')) return 'shield';
  if (sf.startsWith('speaker') || sf.startsWith('music')) return 'volume-high';
  if (sf.startsWith('arrow.up.arrow.down') || sf.startsWith('blinds')) {
    return 'swap-vertical';
  }
  if (sf.startsWith('thermometer')) return 'thermometer';
  if (sf.startsWith('wind')) return 'cloudy';
  if (sf.startsWith('wand')) return 'color-wand';
  if (sf.startsWith('sparkles')) return 'sparkles';
  if (sf === 'power') return 'power';
  return 'ellipse-outline';
}

/**
 * Einen Stil auf einen Knopf legen (rein, testbar).
 *
 * Der eigene Name wird wie jeder andere gekürzt: Im Widget ist die
 * Zeile schmal, und ein Name, der dort abgeschnitten wird, hilft
 * niemandem mehr als einer, der von Anfang an passt.
 */
export function stilAnwenden(
  knopf: WidgetButton,
  stil: Knopfstil | undefined
): WidgetButton {
  if (!stil) return knopf;
  const name = (stil.name ?? '').trim();
  const symbol = (stil.symbol ?? '').trim();
  if (!name && !symbol) return knopf;
  return {
    ...knopf,
    title: name ? kurz(name) : knopf.title,
    symbol: symbol || knopf.symbol,
  };
}

/** Dasselbe für die ganze Liste (rein, testbar). */
export function mitStil(
  buttons: WidgetButton[],
  stile: Knopfstile | undefined
): WidgetButton[] {
  if (!stile) return buttons;
  return buttons.map((knopf) => stilAnwenden(knopf, stile[knopf.key]));
}

/**
 * Einen Stil ändern und dabei aufräumen (rein, testbar).
 *
 * Wer den Namen wieder leert, bekommt den des Geräts zurück - und der
 * Eintrag verschwindet ganz, statt als leere Hülle liegen zu bleiben.
 * Sonst sammelte die Einstellung mit der Zeit Schlüssel von Geräten, die
 * es längst nicht mehr gibt.
 */
export function stilSetzen(
  stile: Knopfstile | undefined,
  key: string,
  patch: Knopfstil
): Knopfstile {
  const alt = (stile ?? {})[key] ?? {};
  const name = (patch.name ?? alt.name ?? '').trim();
  const symbol = (patch.symbol ?? alt.symbol ?? '').trim();
  const next: Knopfstile = { ...(stile ?? {}) };
  if (!name && !symbol) {
    delete next[key];
    return next;
  }
  const eintrag: Knopfstil = {};
  if (name) eintrag.name = name;
  if (symbol) eintrag.symbol = symbol;
  next[key] = eintrag;
  return next;
}

/** Alles Eigene an einem Knopf zurücknehmen (rein, testbar). */
export function stilLoeschen(
  stile: Knopfstile | undefined,
  key: string
): Knopfstile {
  const next: Knopfstile = { ...(stile ?? {}) };
  delete next[key];
  return next;
}
