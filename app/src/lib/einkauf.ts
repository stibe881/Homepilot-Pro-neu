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

export interface ShoppingDraft {
  text: string;
  category: string;
}

/** Wie eine Zutat auf der Liste heisst: «250 ml Ketchup» (rein). */
export function ingredientLabel(ingredient: any): string {
  const name = String(ingredient?.name ?? '').trim();
  if (!name) return '';
  const amount = ingredient?.amount;
  const unit = String(ingredient?.unit ?? '').trim();
  const menge = [
    typeof amount === 'number' && Number.isFinite(amount)
      ? String(amount).replace('.', ',')
      : '',
    unit,
  ]
    .filter(Boolean)
    .join(' ');
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
  recipes: any[],
  vorhanden: string[] = []
): ShoppingDraft[] {
  const gesehen = new Set(
    vorhanden.map((text) => String(text ?? '').trim().toLowerCase())
  );
  const result: ShoppingDraft[] = [];
  for (const recipe of recipes) {
    const ingredients: any[] = Array.isArray(recipe?.ingredients)
      ? recipe.ingredients
      : [];
    for (const ingredient of ingredients) {
      const name = String(ingredient?.name ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (gesehen.has(key)) continue;
      gesehen.add(key);
      // Auch der volle Text zählt als gesehen, damit ein bereits auf der
      // Liste stehendes «250 ml Ketchup» kein zweites «Ketchup» erzeugt.
      const text = ingredientLabel(ingredient);
      gesehen.add(text.toLowerCase());
      result.push({ text, category: shopCategory(name) });
    }
  }
  return result;
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
  /** Kennung der Geofence-Zone, falls dieser Laden eine hat – damit der
   *  Hub weiss, dass man gerade dort steht. */
  zone?: string;
}

/** Der Laden, der immer da ist: keine eigene Reihenfolge, keine Zone. */
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
): { category: string; items: any[] }[] {
  const reihenfolge = shopOrder(shop);
  const rang = new Map(reihenfolge.map((name, index) => [name, index]));
  const eimer = new Map<string, any[]>();
  for (const item of items) {
    // Was keine bekannte Kategorie trägt, landet unter «Sonstiges» statt
    // in einem eigenen Gang, den es im Laden nicht gibt.
    const roh = String((item as any).category ?? '');
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
