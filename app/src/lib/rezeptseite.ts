/**
 * Ein Rezept auf Papier – und die Frage «was koche ich aus dem, was da ist?».
 *
 * Manchmal will man das Blatt neben den Herd legen, statt das iPad in die
 * Küche zu tragen (Punkt 191); und beim Verschenken eines Familienrezepts
 * erst recht. Der Vorschlag aus Punkt 139 fragt nach dem Kalender, nicht
 * nach dem Kühlschrank – die Umkehrung fehlte (Punkt 192).
 *
 * Beides ist reines Rechnen: hinein ein Rezept, hinaus eine Seite oder
 * eine Trefferliste. Wer druckt, ist der Bildschirm.
 */

import { scaledAmount } from './mengen';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rezept = Record<string, any>;

function escape(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Das Rezept als druckbare Seite (rein, testbar).
 *
 * Kein App-Beiwerk: Titel, Portionen, Zutaten, Schritte. Serifen und
 * grosszügige Zeilen, weil das Blatt am Ende auf der Arbeitsfläche liegt
 * und man aus einem Meter Abstand daraufschaut.
 */
export function rezeptAlsSeite(recipe: Rezept, factor: number, servings: number): string {
  const zutaten: Rezept[] = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  const schritte = (Array.isArray(recipe?.instructions) ? recipe.instructions : [])
    .map((step: unknown) =>
      typeof step === 'string' ? step : String((step as Rezept)?.text ?? '')
    )
    .map((text: string) => text.trim())
    .filter(Boolean);
  const notiz = String(recipe?.notes ?? '').trim();

  const teile: string[] = [
    '<!doctype html><html lang="de"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escape(recipe?.text)}</title>`,
    '<style>',
    'body{font:15pt/1.5 Georgia,"Times New Roman",serif;margin:0;padding:2.2cm 2cm;}',
    'h1{font-size:24pt;margin:0 0 .2cm;} .p{opacity:.65;margin:0 0 .8cm;}',
    'h2{font-size:13pt;letter-spacing:.06em;text-transform:uppercase;',
    '   margin:.9cm 0 .25cm;border-bottom:1px solid;padding-bottom:.1cm;}',
    'ul,ol{margin:0;padding-left:1.1cm;} li{margin:0 0 .18cm;break-inside:avoid;}',
    '.n{font-style:italic;opacity:.8;margin-top:.8cm;}',
    '@page{margin:1.5cm;}',
    '</style></head><body>',
    `<h1>${escape(recipe?.text) || 'Rezept'}</h1>`,
  ];
  if (servings > 0) {
    teile.push(
      `<p class="p">Für ${servings} ${servings === 1 ? 'Portion' : 'Portionen'}</p>`
    );
  }
  if (zutaten.length > 0) {
    teile.push('<h2>Zutaten</h2><ul>');
    for (const zutat of zutaten) {
      const menge = [scaledAmount(zutat?.amount, factor), zutat?.unit]
        .filter(Boolean)
        .join(' ');
      teile.push(`<li>${escape([menge, zutat?.name].filter(Boolean).join(' '))}</li>`);
    }
    teile.push('</ul>');
  }
  if (schritte.length > 0) {
    teile.push('<h2>Zubereitung</h2><ol>');
    for (const schritt of schritte) teile.push(`<li>${escape(schritt)}</li>`);
    teile.push('</ol>');
  }
  if (notiz) teile.push(`<p class="n">${escape(notiz)}</p>`);
  teile.push('</body></html>');
  return teile.join('');
}

/**
 * Welche Rezepte mit den vorhandenen Zutaten auskommen (rein, testbar).
 *
 * Zwei, drei Zutaten antippen («Hackfleisch, Rahm») und sehen, was
 * daraus wird – samt der ehrlichen Angabe, was noch fehlt. Sortiert
 * nach «am wenigsten fehlt»: Ein Rezept mit sieben fehlenden Zutaten
 * beantwortet die Frage nicht.
 *
 * Verglichen wird auf Wortstamm-Ebene wie in `schrittzutaten`: «Rahm»
 * findet «Vollrahm», «Zwiebel» findet «Zwiebeln».
 */
export function ausVorrat(
  recipes: Rezept[],
  vorrat: string[],
  maxFehlend = 3
): { recipe: Rezept; fehlt: string[]; trifft: number }[] {
  const gesucht = (vorrat ?? [])
    .map((name) => String(name ?? '').trim().toLowerCase())
    .filter((name) => name.length >= 3);
  if (gesucht.length === 0) return [];
  const ergebnis: { recipe: Rezept; fehlt: string[]; trifft: number }[] = [];
  for (const recipe of recipes ?? []) {
    const zutaten: string[] = (Array.isArray(recipe?.ingredients) ? recipe.ingredients : [])
      .map((zutat: Rezept) => String(zutat?.name ?? '').trim())
      .filter(Boolean);
    if (zutaten.length === 0) continue;
    const trifft = gesucht.filter((name) =>
      zutaten.some((zutat) => zutat.toLowerCase().includes(name))
    ).length;
    if (trifft === 0) continue;
    // Was fehlt: alles, was keine der genannten Zutaten ist. Salz und
    // Pfeffer zählen nicht – die hat jeder, und sie machten jedes
    // Ergebnis unbrauchbar.
    const fehlt = zutaten.filter(
      (zutat) =>
        !gesucht.some((name) => zutat.toLowerCase().includes(name)) &&
        !GRUNDVORRAT.some((basis) => zutat.toLowerCase().includes(basis))
    );
    if (fehlt.length > maxFehlend) continue;
    ergebnis.push({ recipe, fehlt, trifft });
  }
  return ergebnis.sort(
    (a, b) => a.fehlt.length - b.fehlt.length || b.trifft - a.trifft
  );
}

/** Was in jedem Haushalt steht und darum nie als «fehlt» zählt. */
export const GRUNDVORRAT = [
  'salz', 'pfeffer', 'wasser', 'öl', 'oel', 'essig', 'zucker', 'mehl',
  'butter', 'senf', 'paprika', 'muskat', 'bouillon',
];

/** Was noch fehlt, in einem Satz (rein, testbar). */
export function fehltText(fehlt: string[]): string {
  if (fehlt.length === 0) return 'alles da';
  if (fehlt.length === 1) return `ohne ${fehlt[0]}`;
  return `ohne ${fehlt.slice(0, 2).join(' und ')}${fehlt.length > 2 ? ` (+${fehlt.length - 2})` : ''}`;
}

/**
 * Eine Kategorie überall umbenennen (rein, testbar).
 *
 * Der Import aus der alten App brachte «dinner», «drink» und «dessert»
 * mit, von Hand entstand daneben Deutsches – die Filterleiste zeigt
 * beide Welten (Punkt 216). Die Auswahl-Chips verhindern Neues, heilen
 * aber den Bestand nicht.
 *
 * Zurück kommen nur die geänderten Rezepte: Der Aufrufer schickt genau
 * die an den Hub und nicht die ganze Sammlung.
 */
export function kategorieUmbenennen(
  recipes: Rezept[],
  alt: string,
  neu: string
): Rezept[] {
  const gesucht = String(alt ?? '').trim().toLowerCase();
  const ziel = String(neu ?? '').trim();
  if (!gesucht || !ziel) return [];
  return (recipes ?? [])
    .filter((recipe) => String(recipe?.category ?? '').trim().toLowerCase() === gesucht)
    .map((recipe) => ({ ...recipe, category: ziel }));
}

/** Alle vorkommenden Kategorien mit ihrer Anzahl (rein, testbar). */
export function kategorien(recipes: Rezept[]): { name: string; anzahl: number }[] {
  const zaehler = new Map<string, number>();
  for (const recipe of recipes ?? []) {
    const name = String(recipe?.category ?? '').trim();
    if (!name) continue;
    zaehler.set(name, (zaehler.get(name) ?? 0) + 1);
  }
  return [...zaehler.entries()]
    .map(([name, anzahl]) => ({ name, anzahl }))
    .sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name));
}

/**
 * Die Namen aus dem Vorrat, die als Zutat taugen (rein, testbar).
 *
 * Rezeptbuch und Vorrat standen nebeneinander, ohne voneinander zu
 * wissen: «Was geht mit dem, was da ist» hiess bisher, die Zutaten von
 * Hand anzutippen – und wer schon weiss, was er hat, braucht die Frage
 * nicht mehr zu stellen.
 *
 * Zu kurze Einträge fallen weg: `ausVorrat` sucht auf Wortstamm-Ebene,
 * und ein zweibuchstabiges «Ei» träfe «Eintopf», «Eisberg» und
 * «Eiweiss» gleich mit. Doppelte ebenso – im Vorrat steht «Milch»
 * vielleicht zweimal, in den Chips soll sie einmal stehen.
 */
export function vorratsNamen(artikel: { text?: unknown }[]): string[] {
  const gesehen = new Set<string>();
  const namen: string[] = [];
  for (const eintrag of artikel ?? []) {
    const name = String(eintrag?.text ?? '').trim();
    if (name.length < 3) continue;
    const schluessel = name.toLowerCase();
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    namen.push(name);
  }
  return namen;
}
