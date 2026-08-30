/**
 * Welche Farbe eine Szene trägt.
 *
 * Die Szenenkachel ist neu ein einziger farbiger Knopf - man soll sie am
 * Bild erkennen, nicht am Text. Nur: Die Bridge liefert keine Farbe mit.
 * Der Hue-Zustand einer Szene kennt `state`, `scene` und `hue_room`,
 * sonst nichts (integrations/hue.py) - eine echte Vorschau der Lampen
 * gäbe es nur über einen zusätzlichen Abruf je Szene, und der lohnt für
 * eine Kachelfläche nicht.
 *
 * Also aus dem Namen. Hue-Szenen heissen selten «Szene 3», sondern
 * «Rubinrotes Leuchten», «Tropendämmerung», «Arktischer Polarkreis» -
 * der Name sagt die Farbe fast immer. Was kein Wort trifft, bekommt eine
 * feste Farbe aus dem Namen gerechnet: Dieselbe Szene ist dann immer
 * gleich, und zwei Szenen nebeneinander sind verschieden.
 *
 * Bewusst rein und testbar: Ob «Nordlicht» grün wird und nicht rot, ist
 * genau die Sorte Entscheidung, die man nur prüfen kann, wenn sie für
 * sich steht.
 */

/** Eine Szenenfarbe: zwei Töne für den Verlauf, plus Tinte darauf. */
export interface Szenenfarbe {
  von: string;
  bis: string;
  /** Schrift auf dieser Fläche - immer hell oder immer dunkel. */
  tinte: string;
}

const HELL = '#1E1A1C';
const DUNKEL = '#FFFFFF';

/** Die Töne, aus denen gewählt wird. Alle in ähnlicher Sättigung, damit
 *  eine Wand voller Szenen nicht schreit. */
const TOENE: Record<string, Szenenfarbe> = {
  rot: { von: '#E0457B', bis: '#8E1350', tinte: DUNKEL },
  orange: { von: '#FFA95C', bis: '#E0682A', tinte: HELL },
  gelb: { von: '#FFD66E', bis: '#E8A317', tinte: HELL },
  gruen: { von: '#7BD88F', bis: '#2E8B57', tinte: HELL },
  tuerkis: { von: '#7BD8D0', bis: '#158D86', tinte: HELL },
  blau: { von: '#7FB2F0', bis: '#2F5FBF', tinte: DUNKEL },
  violett: { von: '#B79BF0', bis: '#5B3FA8', tinte: DUNKEL },
  rosa: { von: '#F3A3C2', bis: '#C2185B', tinte: DUNKEL },
  warm: { von: '#FFD9A0', bis: '#E09A3E', tinte: HELL },
  kalt: { von: '#DCEBFF', bis: '#8CC5FF', tinte: HELL },
  neutral: { von: '#C9D3E2', bis: '#93A1B5', tinte: HELL },
};

/** Stichwörter je Ton. Wie bei den Einkaufs-Kategorien (lib/einkauf.ts):
 *  klein geschrieben, ohne Endungen, und die Liste darf lückenhaft sein -
 *  was sie nicht kennt, bekommt seine Farbe aus dem Namen gerechnet. */
const WOERTER: [string, string[]][] = [
  ['rot', ['rot', 'rubin', 'ruby', 'blut', 'feuer', 'glut', 'lava', 'vulkan', 'kirsch']],
  ['orange', ['orange', 'sonnenunter', 'sunset', 'abendrot', 'herbst', 'kürbis', 'bernstein', 'kamin']],
  ['gelb', ['gelb', 'sonne', 'sonnig', 'gold', 'sand', 'strand', 'wüste', 'savanne']],
  ['gruen', ['grün', 'gruen', 'wald', 'dschungel', 'tropen', 'frühling', 'fruehling', 'wiese', 'moos', 'smaragd']],
  ['tuerkis', ['türkis', 'tuerkis', 'lagune', 'ozean', 'karibik', 'mint', 'oase']],
  ['blau', ['blau', 'meer', 'see', 'nordlicht', 'arktis', 'polar', 'eis', 'gletscher', 'nacht', 'himmel', 'saphir']],
  ['violett', ['violett', 'lila', 'purpur', 'amethyst', 'lavendel', 'galaxie', 'kosmos', 'nebel', 'traum']],
  ['rosa', ['rosa', 'pink', 'blüte', 'bluete', 'kirschblüte', 'magnolie', 'flamingo', 'romantik']],
  ['warm', ['warm', 'gemütlich', 'gemuetlich', 'kerze', 'entspann', 'relax', 'ruhe', 'lesen', 'kuschel', 'dämmer', 'daemmer']],
  ['kalt', ['kalt', 'konzentr', 'hell', 'tageslicht', 'arbeit', 'büro', 'buero', 'fokus', 'frisch', 'energie']],
  ['neutral', ['aus', 'alles aus', 'normal', 'standard', 'grundlicht']],
];

/** Eine feste Zahl aus einem Text (rein). Kein Zufall: Dieselbe Szene
 *  soll morgen dieselbe Farbe haben wie heute. */
function summe(text: string): number {
  let wert = 0;
  for (let i = 0; i < text.length; i += 1) {
    wert = (wert * 31 + text.charCodeAt(i)) % 100000;
  }
  return wert;
}

/** Die Töne in fester Reihenfolge - für den Fall ohne Stichwort. */
const REIHE = ['blau', 'violett', 'gruen', 'orange', 'tuerkis', 'rosa', 'gelb', 'rot'];

/**
 * Die Farbe einer Szene aus ihrem Namen (rein, testbar).
 *
 * Erst die Stichwörter, dann die gerechnete Farbe. Ein leerer Name
 * bekommt Neutral - eine namenlose Szene soll nicht zufällig knallen.
 */
export function szenenfarbe(name: string): Szenenfarbe {
  const text = String(name ?? '').trim().toLowerCase();
  if (!text) return TOENE.neutral;
  for (const [ton, woerter] of WOERTER) {
    if (woerter.some((wort) => text.includes(wort))) return TOENE[ton];
  }
  return TOENE[REIHE[summe(text) % REIHE.length]];
}
