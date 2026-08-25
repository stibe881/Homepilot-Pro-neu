/**
 * Zutaten auf die Einkaufsliste bringen.
 *
 * Zwei Dinge, die von Hand jedes Mal nerven: Man schreibt die Zutaten aus
 * dem Rezept ab, und man sortiert sie hinterher nach Ladengang, damit man
 * nicht dreimal durch den Laden läuft. Beides ist Rechnerarbeit.
 *
 * Bewusst reine Funktionen ohne React: Die Zuordnung «Rüebli gehört zu
 * Früchte & Gemüse» ist die Stelle, an der es falsch wird, und sie lässt
 * sich nur prüfen, wenn sie für sich steht.
 */

/** Die Gänge, in der Reihenfolge, in der man durch den Laden geht. */
import { mengenAddieren } from './mengen';

export const SHOP_CATEGORIES = [
  'Früchte & Gemüse',
  'Milchprodukte',
  'Brot & Backwaren',
  'Fleisch & Fisch',
  'Getränke',
  'Tiefkühl',
  'Vorrat',
  'Haushalt',
  'Sonstiges',
];

/**
 * Stichwörter je Gang. Bewusst kleingeschrieben und ohne Endungen, damit
 * «Rüebli», «rüebli» und «Rüeblis» gleich landen. Die Liste muss nicht
 * vollständig sein - was sie nicht kennt, kommt unter «Sonstiges» und
 * lässt sich dort in einem Griff verschieben. Lieber ein paar Einträge
 * unsortiert als ein falsch einsortiertes Poulet in den Milchprodukten.
 */
const KEYWORDS: [string, string[]][] = [
  [
    'Früchte & Gemüse',
    [
      'apfel', 'äpfel', 'banane', 'zitrone', 'limette', 'orange', 'beere',
      'erdbeer', 'himbeer', 'traube', 'birne', 'pfirsich', 'melone', 'kiwi',
      'salat', 'tomate', 'gurke', 'rüebli', 'karotte', 'zwiebel', 'knoblauch',
      'kartoffel', 'peperoni', 'paprika', 'lauch', 'sellerie', 'zucchetti',
      'zucchini', 'aubergine', 'broccoli', 'brokkoli', 'blumenkohl', 'spinat',
      'pilz', 'champignon', 'kürbis', 'randen', 'kohl', 'bohnen', 'erbsen',
      'ingwer', 'petersilie', 'basilikum', 'schnittlauch', 'rucola', 'avocado',
    ],
  ],
  [
    'Milchprodukte',
    [
      'milch', 'rahm', 'sahne', 'butter', 'joghurt', 'quark', 'käse', 'kaese',
      'mozzarella', 'parmesan', 'gruyère', 'gruyere', 'feta', 'mascarpone',
      'crème', 'creme fraiche', 'hüttenkäse', 'ei', 'eier',
    ],
  ],
  [
    'Brot & Backwaren',
    ['brot', 'brötchen', 'weggli', 'gipfeli', 'baguette', 'toast', 'zopf', 'semmel'],
  ],
  [
    'Fleisch & Fisch',
    [
      'poulet', 'huhn', 'hähnchen', 'rind', 'schwein', 'kalb', 'hack',
      'gehacktes', 'speck', 'schinken', 'wurst', 'salami', 'cervelat',
      'lachs', 'fisch', 'thon', 'thunfisch', 'crevette', 'garnele', 'entrecôte',
    ],
  ],
  [
    'Getränke',
    ['wasser', 'saft', 'wein', 'bier', 'cola', 'sirup', 'kaffee', 'tee', 'milchkaffee'],
  ],
  ['Tiefkühl', ['tiefkühl', 'gefroren', 'glace', 'eis', 'pommes']],
  [
    'Vorrat',
    [
      'mehl', 'zucker', 'salz', 'pfeffer', 'öl', 'oel', 'essig', 'reis',
      'teigwaren', 'nudeln', 'spaghetti', 'penne', 'hörnli', 'linsen',
      'konserve', 'dose', 'passata', 'ketchup', 'senf', 'mayonnaise', 'honig',
      'schokolade', 'kakao', 'backpulver', 'hefe', 'bouillon', 'gewürz',
      'paprikapulver', 'curry', 'zimt', 'vanille', 'nuss', 'mandel',
    ],
  ],
  [
    'Haushalt',
    [
      'wc-papier', 'küchenpapier', 'abfallsack', 'waschmittel', 'spülmittel',
      'putzmittel', 'zahnpasta', 'shampoo', 'seife', 'schwamm',
    ],
  ],
];

/**
 * In welchen Gang gehört diese Zutat? (rein, testbar)
 *
 * Es gewinnt das LÄNGSTE passende Stichwort, nicht die erste Kategorie:
 * «Paprikapulver» enthält «paprika» (Gemüse) und «paprikapulver»
 * (Vorrat) - und ein Gewürz gehört nicht ins Gemüseregal. Bei gleicher
 * Länge entscheidet die Reihenfolge der Gänge.
 */
export function shopCategory(name: string): string {
  const needle = String(name ?? '').toLowerCase();
  if (!needle.trim()) return 'Sonstiges';
  let treffer = '';
  let gefunden = 'Sonstiges';
  for (const [category, words] of KEYWORDS) {
    for (const word of words) {
      if (word.length > treffer.length && needle.includes(word)) {
        treffer = word;
        gefunden = category;
      }
    }
  }
  return gefunden;
}

/**
 * Eine Zeile der Einkaufsliste bzw. eine Rezept-Zutat, wie der Hub sie
 * speichert (Punkt 60 der Werkbank) - offen, weil die Felder dem Hub
 * gehören; der Alias ersetzt die verstreuten `any`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EinkaufZeile = Record<string, any>;

export interface ShoppingDraft {
  text: string;
  category: string;
  /** Die Menge als eigene Angabe – «400 ml», «2 EL». Bewusst neben dem
   *  Artikel und nicht in ihm: Im Laden liest man «Milch» und daneben,
   *  wie viel. Fehlt sie, steht auf der Zeile nur der Artikel. */
  amount?: string;
  /** Aus welchem Rezept dieser Posten stammt – «aus Lasagne» (Punkt 208).
   *  Im Laden fragt man sich sonst, wofür die 250 g Kapern waren. */
  from?: string;
  /** Kennung des Rezepts, damit das Antippen es öffnen kann. */
  from_id?: string;
}

/** Masseinheiten, die vor einem Artikel stehen dürfen. Nur diese: Sonst
 *  würde aus «7 Up» ein «Up», sobald jemand eine Zahl davor schreibt. */
const EINHEITEN = new Set([
  'ml', 'l', 'dl', 'cl', 'g', 'kg', 'el', 'tl', 'kl',
  'prise', 'prisen', 'stück', 'stk', 'bund', 'dose', 'dosen',
  'pack', 'packung', 'packungen', 'becher', 'scheibe', 'scheiben',
  'zehe', 'zehen', 'tasse', 'tassen', 'blatt', 'zweig', 'zweige',
]);

/**
 * Der blosse Artikel aus einer Zeile, ohne vorangestellte Menge
 * (rein, testbar).
 *
 * Nur fürs Vergleichen: «steht 400 ml Milch schon drauf?» und «Milch»
 * meinen denselben Posten. Angezeigt wird immer das, was gespeichert ist –
 * hier wird nichts umgeschrieben.
 */
export function artikelName(text: string): string {
  const roh = String(text ?? '').trim();
  const treffer = /^(\d+(?:[.,]\d+)?)\s*([a-zäöüß]+)?\s+(.+)$/i.exec(roh);
  if (!treffer) return roh;
  const einheit = (treffer[2] ?? '').toLowerCase();
  // Ein Wort, das keine Einheit ist, gehört zum Artikel («2 Liter Cola»
  // ja, «2 Bio Eier» nein).
  if (einheit && !EINHEITEN.has(einheit)) return roh;
  const rest = treffer[3].trim();
  // «500 g» ist eine Menge und kein Artikel – davon bliebe sonst «g».
  if (!rest || EINHEITEN.has(rest.toLowerCase())) return roh;
  return rest;
}

/**
 * Menge und Artikel einer Zutat – getrennt (rein, testbar).
 *
 * Bisher wurde beides zu einer Zeile verklebt: «400 ml Milch». Damit
 * stand die Menge im Artikelnamen, und das rächte sich an drei Stellen –
 * das Gedächtnis für die Vervollständigung lernte «400 ml Milch» als
 * Artikel, «steht das schon drauf?» verglich Mengen mit, und die
 * Stückzahl-Knöpfe fassten eine Zahl an, die gar keine Stückzahl war.
 *
 * `faktor` rechnet die Menge auf die gewählte Portionenzahl um – auf eine
 * Nachkommastelle gerundet, weil «666,6667 g Mehl» niemandem hilft.
 */
export function zutatGeteilt(
  ingredient: EinkaufZeile,
  faktor = 1
): { name: string; menge: string } {
  const name = String(ingredient?.name ?? '').trim();
  if (!name) return { name: '', menge: '' };
  const roh = ingredient?.amount;
  const amount =
    typeof roh === 'number' && Number.isFinite(roh)
      ? Math.round(roh * faktor * 10) / 10
      : roh;
  const unit = String(ingredient?.unit ?? '').trim();
  const menge = [
    typeof amount === 'number' && Number.isFinite(amount)
      ? String(amount).replace('.', ',')
      : '',
    unit,
  ]
    .filter(Boolean)
    .join(' ');
  return { name, menge };
}

/** Wie eine Zutat ausgeschrieben heisst: «250 ml Ketchup» (rein).
 *
 * Für das Rezept selbst, wo Menge und Zutat in einer Zeile stehen. Auf
 * der Einkaufsliste stehen sie getrennt – siehe `zutatGeteilt`. */
export function ingredientLabel(ingredient: EinkaufZeile, faktor = 1): string {
  const { name, menge } = zutatGeteilt(ingredient, faktor);
  if (!name) return '';
  return menge ? `${menge} ${name}` : name;
}

/**
 * Menge und Name aus einem Eintrag lesen (rein, testbar).
 *
 * Auf der Liste steht, was jemand getippt hat: «2 Milch», «2x Milch»,
 * «2× Milch», «2 Liter Milch». Für die Anzeige und fürs Zusammenlegen
 * braucht es beides getrennt – sonst sind «Milch» und «2 Milch» zwei
 * Posten, und man steht mit drei Litern zu Hause.
 *
 * Nur die *führende* Zahl zählt, und nur wenn danach noch etwas kommt.
 * «7 Up» wäre sonst sieben Ups, deshalb greift die Regel erst ab einer
 * Zahl mit einem Trennzeichen dahinter (`x`, `×` oder Leerzeichen) und
 * lässt Namen in Ruhe, die mit einer Zahl anfangen und keine Menge
 * meinen. Ganz vermeiden lässt sich das nicht – «7 Up» bleibt der Preis
 * dafür, dass «2 Milch» funktioniert.
 */
export function mengeUndName(text: string): { menge: number; name: string } {
  const roh = String(text ?? '').trim();
  const treffer = /^(\d{1,3})\s*(?:[x×]\s*|\s)(.+)$/i.exec(roh);
  if (!treffer) return { menge: 1, name: roh };
  const menge = Number(treffer[1]);
  const name = treffer[2].trim();
  // «0 Milch» und «1 Milch» sind keine Mengenangaben, die man anzeigen
  // müsste – und ein leerer Name wäre gar keiner.
  if (!name || menge < 2 || menge > 99) return { menge: 1, name: roh };
  return { menge, name };
}

/**
 * Was in einer Zeile der Einkaufsliste steht (rein, testbar).
 *
 * Drei Dinge, die nicht dasselbe sind und lange in einem Textfeld
 * steckten:
 *
 * - die **Stückzahl** («3× Milch») – die verstellen die Plus/Minus-Knöpfe,
 * - die **Menge** («400 ml») – die kommt aus dem Rezept und ist keine
 *   Stückzahl; wer sie mit «+» erhöhte, bekam Unsinn,
 * - der **Artikel** («Milch») – danach wird gesucht und verglichen.
 *
 * Ältere Posten haben die Menge noch im Text stehen; die kommen
 * unverändert durch, damit eine Liste vom letzten Samstag gleich aussieht
 * wie vorher.
 */
export function einkaufZeile(eintrag: EinkaufZeile): {
  anzahl: number;
  artikel: string;
  menge: string;
} {
  const { menge: anzahl, name } = mengeUndName(String(eintrag?.text ?? ''));
  return { anzahl, artikel: name, menge: String(eintrag?.amount ?? '').trim() };
}

/** Wie ein Eintrag mit Menge geschrieben wird: «3× Milch» (rein, testbar). */
export function mitMenge(name: string, menge: number): string {
  const sauber = String(name ?? '').trim();
  return menge > 1 ? `${menge}× ${sauber}` : sauber;
}

/**
 * Steht der Artikel schon auf der Liste? (rein, testbar)
 *
 * Verglichen wird der blosse Name ohne Menge: Wer «Milch» tippt und
 * «2× Milch» liegt schon da, meint den vorhandenen Posten. Zurück kommt
 * der ganze Eintrag, damit der Aufrufer seine Kennung hat.
 */
export function findeArtikel<T extends { text?: unknown }>(
  liste: T[],
  text: string
): T | undefined {
  const gesucht = mengeUndName(text).name.toLowerCase();
  if (!gesucht) return undefined;
  return liste.find(
    (eintrag) => mengeUndName(String(eintrag.text ?? '')).name.toLowerCase() === gesucht
  );
}

/**
 * Zutaten mehrerer Rezepte zu Einkaufs-Einträgen (rein, testbar).
 *
 * Doppelte fallen weg - wer für zwei Gerichte Zwiebeln braucht, will
 * keinen zweiten Eintrag, sondern beim Einkaufen einmal daran denken.
 * Verglichen wird der blosse Name ohne Menge: «2 Zwiebeln» und «1
 * Zwiebel» sind derselbe Posten. Was schon auf der Liste steht, kommt
 * nicht noch einmal dazu.
 */
export function ingredientsToShopping(
  recipes: EinkaufZeile[],
  // Was schon auf der Liste liegt. Texte genügen, wenn nur gefragt wird
  // «was fehlt noch»; ganze Posten (mit id und amount) braucht es, damit
  // sich Mengen zu einem vorhandenen Eintrag dazuzählen lassen.
  vorhanden: (string | EinkaufZeile)[] = [],
  // Eine Zahl für alle Rezepte - oder je Rezept eine (Punkt 145: der
  // Wochenplan kennt für jeden Tag seine eigenen Portionen).
  faktor: number | number[] = 1
): { neu: ShoppingDraft[]; mehr: { id: string; amount: string }[] } {
  // Je Artikel der Posten, der ihn schon abdeckt. Ohne Menge im Namen
  // gesucht: «Milch» und ein altes «400 ml Milch» sind derselbe Artikel.
  const schonDa = new Map<string, EinkaufZeile | null>();
  const merke = (text: string, posten: EinkaufZeile | null) => {
    const sauber = String(text ?? '').trim().toLowerCase();
    if (!sauber) return;
    if (!schonDa.has(sauber)) schonDa.set(sauber, posten);
    const blank = artikelName(sauber).toLowerCase();
    if (!schonDa.has(blank)) schonDa.set(blank, posten);
  };
  for (const eintrag of vorhanden) {
    if (typeof eintrag === 'string') merke(eintrag, null);
    else merke(String(eintrag?.text ?? ''), eintrag);
  }

  const neu: ShoppingDraft[] = [];
  // Je Artikel der Entwurf dieses Durchgangs – damit sich zwei Rezepte
  // mit Milch zu einer Zeile zusammenlegen.
  const entwuerfe = new Map<string, ShoppingDraft>();
  const mehr = new Map<string, string>();

  for (const [index, recipe] of recipes.entries()) {
    const rezeptFaktor = Array.isArray(faktor) ? (faktor[index] ?? 1) : faktor;
    const ingredients: EinkaufZeile[] = Array.isArray(recipe?.ingredients)
      ? recipe.ingredients
      : [];
    for (const ingredient of ingredients) {
      const name = String(ingredient?.name ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const { menge } = zutatGeteilt(ingredient, rezeptFaktor);

      // Schon in diesem Durchgang dabei? Dann zur Menge dazuzählen.
      const entwurf = entwuerfe.get(key);
      if (entwurf) {
        if (menge) entwurf.amount = mengenAddieren(entwurf.amount ?? '', menge);
        continue;
      }

      // Schon auf der Liste? Zur vorhandenen Menge dazu, statt den
      // Posten wortlos fallen zu lassen – genau das liess einen im Laden
      // mit 400 ml dastehen, wo 600 gebraucht wurden.
      if (schonDa.has(key)) {
        const posten = schonDa.get(key);
        if (posten && menge && posten.id) {
          const id = String(posten.id);
          const bisher = mehr.get(id) ?? String(posten.amount ?? '');
          mehr.set(id, mengenAddieren(bisher, menge));
        }
        continue;
      }

      // Die Herkunft bleibt am Posten hängen (Punkt 208): Im Laden
      // entscheidet man damit auch, ob es die teuren Kapern sein müssen.
      const herkunft = String(recipe?.text ?? '').trim();
      const draft: ShoppingDraft = {
        // Der Artikel ohne Menge – so findet ihn die Suche, das
        // Gedächtnis und der nächste Wocheneinkauf wieder.
        text: name,
        ...(menge ? { amount: menge } : {}),
        category: shopCategory(name),
        ...(herkunft ? { from: herkunft } : {}),
        ...(recipe?.id ? { from_id: String(recipe.id) } : {}),
      };
      entwuerfe.set(key, draft);
      neu.push(draft);
    }
  }
  return {
    neu,
    mehr: [...mehr.entries()].map(([id, amount]) => ({ id, amount })),
  };
}

/**
 * Ein Laden: wie er heisst, in welcher Reihenfolge man ihn durchläuft.
 *
 * Die Gänge stehen in jedem Laden anders. Im einen kommt zuerst das
 * Gemüse, im anderen die Getränke – und wer die Liste in der falschen
 * Reihenfolge abarbeitet, läuft dreimal durch. Deshalb gehört die
 * Reihenfolge zum Laden und nicht zur Liste.
 */
export interface Shop {
  id: string;
  name: string;
  /** Kategorien in Laufreihenfolge. Was fehlt, kommt hinten dazu. */
  categories?: string[];
  /** Kennung des Ortes, an dem dieser Laden liegt – damit der Hub weiss,
   *  dass man gerade dort steht. Wird in der App gesetzt: davorstehen,
   *  Knopf drücken. */
  place?: string;
  /** Der alte Weg: eine eigene Geofence-Zone je Laden, von aussen auf
   *  «home» gesetzt (iOS-Kurzbefehl, Tasker). Gilt weiter, wer es so
   *  eingerichtet hat, soll es behalten dürfen. */
  zone?: string;
}

/** Der Laden, der immer da ist: keine eigene Reihenfolge, kein Ort. */
export const ALLGEMEIN: Shop = { id: 'allgemein', name: 'Allgemein' };

/**
 * Die Gänge eines Ladens in Laufreihenfolge (rein, testbar).
 *
 * Was der Laden nennt, kommt zuerst – in seiner Reihenfolge. Alles
 * Übrige hängt hinten an, in der Standardreihenfolge: Ein Gang, den
 * niemand einsortiert hat, soll nicht verschwinden, sondern am Ende
 * auftauchen.
 */
export function shopOrder(shop?: Shop | null): string[] {
  const eigene = (shop?.categories ?? []).filter((name) =>
    SHOP_CATEGORIES.includes(name)
  );
  const rest = SHOP_CATEGORIES.filter((name) => !eigene.includes(name));
  return [...eigene, ...rest];
}

/**
 * Die Gänge eines Ladens in Laufreihenfolge, mit ihrer Nummer (rein,
 * testbar).
 *
 * Der Grund: Die Knöpfe standen in der festen Listenreihenfolge da, die
 * Nummern kamen aber aus der Reihenfolge des Antippens. Auf dem
 * Bildschirm las sich das dann «1. Früchte, 3. Milch / 2. Brot, 4.
 * Fleisch / 7. Getränke, 5. Tiefkühl» – man musste die Nummern suchen,
 * statt sie zu lesen. Stehen die Knöpfe in der Reihenfolge, die sie
 * beschreiben, erübrigt sich das Suchen.
 *
 * `platz` ist `null`, wo noch nichts gewählt wurde. Diese Gänge hängen
 * hinten an – ohne Nummer, denn ihre Reihenfolge ist keine Wahl, sondern
 * ein Rest.
 */
export function gangReihenfolge(
  shop?: Shop | null
): { name: string; platz: number | null }[] {
  const eigene = (shop?.categories ?? []).filter((name) =>
    SHOP_CATEGORIES.includes(name)
  );
  return shopOrder(shop).map((name) => {
    const platz = eigene.indexOf(name);
    return { name, platz: platz >= 0 ? platz + 1 : null };
  });
}

/** So viele Orte stehen da, bevor «alle zeigen» kommt. */
export const ORTE_KURZ = 6;

/**
 * Die Orte zur Auswahl, in einer Reihenfolge, die man lesen kann (rein,
 * testbar).
 *
 * Neunzehn Knöpfe in Anlegereihenfolge sind keine Liste, sondern ein
 * Haufen. Der gewählte steht vorn – er ist die Antwort auf die Frage,
 * die man beim Hinsehen hat –, der Rest alphabetisch. Und zugeklappt
 * nur die ersten paar: Wer den gesuchten Ort nicht sieht, tippt ihn
 * ohnehin schneller ins Suchfeld darunter.
 */
export function orteFuerLaden(
  orte: { id: string; name: string }[],
  gewaehlt: string | undefined,
  alle: boolean
): { id: string; name: string }[] {
  const sortiert = [...(orte ?? [])].sort((a, b) => {
    if (gewaehlt && a.id === gewaehlt) return -1;
    if (gewaehlt && b.id === gewaehlt) return 1;
    return a.name.localeCompare(b.name, 'de');
  });
  return alle ? sortiert : sortiert.slice(0, ORTE_KURZ);
}

/**
 * Einkaufs-Einträge nach den Gängen eines Ladens gruppieren (rein,
 * testbar).
 *
 * Leere Gänge fallen weg – eine Überschrift ohne Einträge ist eine
 * Zeile, die man beim Einkaufen überliest und die trotzdem Platz kostet.
 * Innerhalb eines Gangs bleibt die Reihenfolge, in der die Einträge
 * angelegt wurden: Wer zuletzt «Milch» dazuschreibt, sucht sie unten.
 */
export function groupForShop(
  items: { category?: string }[],
  shop?: Shop | null
): { category: string; items: EinkaufZeile[] }[] {
  const reihenfolge = shopOrder(shop);
  const rang = new Map(reihenfolge.map((name, index) => [name, index]));
  const eimer = new Map<string, EinkaufZeile[]>();
  for (const item of items) {
    // Was keine bekannte Kategorie trägt, landet unter «Sonstiges» statt
    // in einem eigenen Gang, den es im Laden nicht gibt.
    const roh = String((item as EinkaufZeile).category ?? '');
    const category = rang.has(roh) ? roh : 'Sonstiges';
    const liste = eimer.get(category);
    if (liste) liste.push(item);
    else eimer.set(category, [item]);
  }
  return [...eimer.entries()]
    .sort((a, b) => (rang.get(a[0]) ?? 999) - (rang.get(b[0]) ?? 999))
    .map(([category, gruppe]) => ({ category, items: gruppe }));
}

/**
 * Vorschläge fürs Eingabefeld der Einkaufsliste (rein, testbar).
 *
 * Der Hub liefert die schon einmal eingekauften Namen; hier fällt weg,
 * was ohnehin gerade auf der Liste steht - ein Vorschlag, der einen
 * Eintrag verdoppeln würde, ist keiner. Was mit dem Getippten *beginnt*,
 * steht vor dem, was es bloss enthält: Wer «mi» tippt, meint eher Milch
 * als Salami.
 *
 * Ohne Eingabe die zuletzt benutzten - beim leeren Feld ist das der
 * nützlichste Anfang, denn eingekauft wird meistens dasselbe.
 */
export function artikelVorschlaege(
  bekannt: string[],
  eingabe: string,
  schonDrauf: string[] = [],
  limit = 6
): string[] {
  const drauf = new Set(schonDrauf.map((text) => text.trim().toLowerCase()));
  const frei = bekannt.filter((name) => !drauf.has(name.trim().toLowerCase()));
  const suche = eingabe.trim().toLowerCase();
  if (!suche) return frei.slice(0, limit);
  const vorn = frei.filter((name) => name.toLowerCase().startsWith(suche));
  const drin = frei.filter(
    (name) => name.toLowerCase().includes(suche) && !name.toLowerCase().startsWith(suche)
  );
  return [...vorn, ...drin].slice(0, limit);
}

/**
 * Menge am Posten verstellen, ohne den Text zu bearbeiten (rein, testbar).
 *
 * «2 Milch» entstand bisher, indem man den Eintrag antippt, das Feld
 * öffnet, eine Zahl davorschreibt. Für den häufigsten Fall – einen mehr,
 * einen weniger – genügt ein Plus und ein Minus (Punkt 207).
 *
 * Unter zwei fällt die Zahl weg: «1× Milch» schreibt niemand.
 */
export function mengeAendern(text: string, delta: number): string {
  const { menge, name } = mengeUndName(text);
  const neu = Math.max(1, Math.min(99, menge + delta));
  return mitMenge(name, neu);
}

/**
 * Mehrere Posten aus einem Feld (rein, testbar).
 *
 * Nach dem Blick in den Kühlschrank hat man fünf Dinge im Kopf und tippt
 * fünfmal Feld–Plus–Feld. «Milch, Butter, 2 Zwiebeln» soll drei Posten
 * ergeben, jeder mit seinem Gang (Punkt 209). Das Diktieren übers
 * Mikrofon funktioniert damit nebenbei auch – dort kommt ohnehin ein
 * Satz mit Kommas heraus.
 *
 * Getrennt wird an Komma, Semikolon und Zeilenumbruch. Nicht an «und»:
 * «Salz und Pfeffer Mühle» wäre sonst zwei Posten, und das ist es
 * manchmal und manchmal nicht.
 */
export function zeilenAufteilen(eingabe: string): ShoppingDraft[] {
  return String(eingabe ?? '')
    .split(/[,;\n]+/)
    .map((teil) => teil.trim())
    .filter(Boolean)
    .map((text) => ({ text, category: shopCategory(mengeUndName(text).name) }));
}

/**
 * Die offene Liste als Text zum Teilen (rein, testbar).
 *
 * Wer jemanden bittet, unterwegs etwas mitzubringen, schickt heute ein
 * Foto vom Bildschirm (Punkt 177). Nach Gang sortiert, damit der
 * Empfänger nicht dreimal durch den Laden läuft.
 */
export function einkaufsText(
  items: EinkaufZeile[],
  shop?: Shop | null,
  titel = 'Einkaufsliste'
): string {
  const offen = items.filter((item) => !item.done);
  if (offen.length === 0) return `${titel}: nichts offen`;
  const zeilen: string[] = [shop?.name ? `${titel} – ${shop.name}` : titel, ''];
  for (const gruppe of groupForShop(offen, shop)) {
    zeilen.push(`${gruppe.category}:`);
    for (const item of gruppe.items) zeilen.push(`  • ${String(item.text ?? '')}`);
    zeilen.push('');
  }
  return zeilen.join('\n').trim();
}

/**
 * Nur die Posten eines Ladens (rein, testbar).
 *
 * Der Käse vom Hofladen und die Schrauben aus dem Baumarkt stehen sonst
 * zwischen der Migros-Ware (Punkt 175). Ein Posten ohne Laden gehört
 * überallhin: Was man überall bekommt, will man nicht dreimal
 * eintragen.
 */
export function fuerLaden(items: EinkaufZeile[], shopId?: string | null): EinkaufZeile[] {
  const gewaehlt = String(shopId ?? '').trim();
  if (!gewaehlt || gewaehlt === ALLGEMEIN.id) return [...items];
  return items.filter((item) => {
    const eigener = String(item.shop ?? '').trim();
    return !eigener || eigener === gewaehlt;
  });
}

/**
 * Wie viele offene Posten je Laden (rein, testbar).
 *
 * Für die Filterleiste: «Migros (12)», «Baumarkt (2)». Wer im Baumarkt
 * steht, sieht dann zwei Zeilen statt vierzehn.
 */
export function ladenZaehler(
  items: EinkaufZeile[],
  shops: Shop[]
): { shop: Shop; offen: number }[] {
  const offen = items.filter((item) => !item.done);
  return [ALLGEMEIN, ...shops].map((shop) => ({
    shop,
    offen: fuerLaden(offen, shop.id).length,
  }));
}

/**
 * Was beim Eintragen zu tun ist: erhöhen oder neu anlegen (rein, testbar).
 *
 * Zwei Menschen tragen unabhängig «Milch» ein, und im Laden steht sie
 * zweimal auf der Liste (Punkt 174). Steht der Posten schon offen da,
 * wird seine Menge erhöht statt eine zweite Zeile angelegt.
 *
 * Erledigtes zählt nicht als «steht schon drauf»: Wer die Milch heute
 * gekauft hat und sie morgen wieder braucht, meint einen neuen Posten.
 */
export function eintragen(
  liste: EinkaufZeile[],
  text: string,
  category?: string
): { kind: 'neu'; draft: ShoppingDraft } | { kind: 'mehr'; id: string; text: string } {
  const offen = liste.filter((item) => !item.done);
  const vorhanden = findeArtikel(offen, text);
  if (vorhanden && vorhanden.id) {
    const dazu = mengeUndName(text).menge;
    const jetzt = mengeUndName(String(vorhanden.text ?? '')).menge;
    return {
      kind: 'mehr',
      id: String(vorhanden.id),
      text: mitMenge(mengeUndName(String(vorhanden.text ?? '')).name, jetzt + dazu),
    };
  }
  const sauber = String(text ?? '').trim();
  return {
    kind: 'neu',
    draft: {
      text: sauber,
      category: category || shopCategory(mengeUndName(sauber).name),
    },
  };
}
