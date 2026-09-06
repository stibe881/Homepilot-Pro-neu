/**
 * Rezepte ohne Netz: der zuletzt geladene Stand, im Gerät gemerkt
 * (Punkt 250 der Werkbank).
 *
 * Der Fall, der wehtut: In der Küche stehen, die Hände im Teig, das WLAN
 * zickt – und das Rezept verschwindet mitten im Kochen. Die
 * Familienlisten überstehen so einen Ausfall längst
 * (lib/familiecache.ts); die Rezepte fielen durch, weil ihr Stand mit
 * den eingebetteten Fotos zu gross für einen Zwischenspeicher ist.
 *
 * Hier steht nur das Rechnen: was ins Lager kommt, wann es verfällt und
 * wie geladener und gemerkter Stand zusammengehen. Wer speichert und
 * anzeigt, ist der Bildschirm (screens/RecipeBook.tsx).
 *
 * Und mit Absicht KEINE Warteschlange für Rezept-Änderungen: Ein Häkchen
 * auf der Einkaufsliste lässt sich gefahrlos nachtragen – zwei Fassungen
 * desselben Rezepttextes zusammenzuführen kann niemand. Der Konflikt
 * wäre teurer als die seltene Unannehmlichkeit, mit dem Speichern auf
 * den Hub zu warten. Ohne Netz wird ehrlich gemeldet statt still
 * eingereiht.
 */

/** Ein Rezept, so offen wie der Hub es speichert (siehe RecipeBook). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rezept = Record<string, any>;

/** Der gemerkte Stand: die Rezepte samt Zeitpunkt des Ladens. */
export interface RezeptLager {
  recipes: Rezept[];
  at: number;
}

/** Unter diesem Schlüssel liegt das Lager in AsyncStorage. */
export const REZEPT_CACHE_KEY = 'homepilot.rezepte.cache';

/**
 * So lange gilt der gemerkte Stand.
 *
 * Grosszügig, weil Rezepte sich kaum ändern: Ein zwei Wochen alter
 * Stand kocht genauso gut wie der von heute. Nach zwei Monaten ist die
 * Wahrscheinlichkeit, dass er in die Irre führt (Gelöschtes, längst
 * Korrigiertes), grösser als sein Nutzen – dann lieber ehrlich nichts
 * zeigen als überzeugt das Falsche.
 */
export const VERFALL = 60 * 24 * 3600 * 1000;

/** Gilt der Stand von `at` zum Zeitpunkt `jetzt` noch? (rein, testbar) */
export function istFrisch(at: number, jetzt: number): boolean {
  return Number.isFinite(at) && jetzt - at < VERFALL;
}

/**
 * Was von einem Rezept ins Lager kommt (rein, testbar).
 *
 * Alles ausser den eingebetteten Fotos: AsyncStorage ist kein
 * Bildarchiv – ein einziges Foto als data-URI sind mehrere hundert KB,
 * und auf Android ist bei ~2 MB je Eintrag Schluss; genau daran
 * scheiterte der Familien-Zwischenspeicher an den Rezepten. Zum Kochen
 * braucht es den Text: Zutaten, Schritte, Portionen. Kurze Verweise
 * (Hub-Pfade, http-Adressen) bleiben stehen – sobald das Netz zurück
 * ist, sind die Bilder wieder da.
 */
export function fuersLager(recipes: Rezept[]): Rezept[] {
  const ohneFoto = (wert: unknown): unknown =>
    typeof wert === 'string' && wert.startsWith('data:') ? null : wert;
  return (recipes ?? []).map((recipe) => ({
    ...recipe,
    image_url: ohneFoto(recipe?.image_url),
    original_url: ohneFoto(recipe?.original_url),
  }));
}

/**
 * Das Lager nach einem Laden nachführen (rein, testbar).
 *
 * Eine Regel trägt alles: Ein leerer Stand überschreibt nie ein
 * gefülltes Lager. Von hier aus sind «das Buch ist wirklich leer» und
 * «das Laden ist ins Leere gelaufen» nicht zu unterscheiden – und ein
 * weggeworfenes Lager wäre genau in dem Moment weg, für den es da ist.
 * Ein wirklich geleertes Buch heilt sich mit dem ersten neuen Rezept
 * von selbst.
 *
 * Gibt es nichts zu ändern, kommt dasselbe Objekt zurück – der
 * Bildschirm spart sich dann das Schreiben.
 */
export function uebernehmen(
  lager: RezeptLager | null,
  geladen: Rezept[],
  jetzt: number
): RezeptLager | null {
  if (!geladen || geladen.length === 0) return lager;
  return { recipes: fuersLager(geladen), at: jetzt };
}

/**
 * Geladenen und gemerkten Stand zusammenführen (rein, testbar).
 *
 * Der geladene Stand gewinnt, sobald er etwas enthält; das Lager
 * springt nur ein, wenn er leer ist und der gemerkte Stand noch frisch.
 * Ganz oder gar nicht, nie rezeptweise gemischt: Liste und Details
 * (Zutaten, Schritte) kommen beim Hub aus derselben Sammlung, und ein
 * halb gemischter Stand – neue Liste, alte Schritte – wäre beim Kochen
 * gefährlicher als ein ehrlich alter.
 */
export function anzeigen(
  geladen: Rezept[],
  lager: RezeptLager | null,
  jetzt: number
): { recipes: Rezept[]; ausCache: boolean; stand: number | null } {
  if (geladen && geladen.length > 0) {
    return { recipes: geladen, ausCache: false, stand: null };
  }
  if (lager && lager.recipes.length > 0 && istFrisch(lager.at, jetzt)) {
    return { recipes: lager.recipes, ausCache: true, stand: lager.at };
  }
  return { recipes: geladen ?? [], ausCache: false, stand: null };
}

/**
 * Das rohe Gespeicherte prüfen und lesen (rein, testbar).
 *
 * Was nicht die erwartete Form hat – halber JSON nach einem Absturz,
 * ein alter Schlüssel –, zählt als «kein Lager». Lieber frisch laden
 * als aus Kaputtem einen Bildschirm bauen.
 */
export function gelesen(raw: string | null): RezeptLager | null {
  if (!raw) return null;
  try {
    const wert = JSON.parse(raw) as { recipes?: unknown; at?: unknown };
    if (!Array.isArray(wert?.recipes) || typeof wert.at !== 'number') return null;
    return { recipes: wert.recipes as Rezept[], at: wert.at };
  } catch {
    return null;
  }
}

/**
 * Die ehrliche Zeile über dem Rezeptbuch (rein, testbar).
 *
 * «Ohne Verbindung – Stand von 14:12»: unaufgeregt, aber sichtbar.
 * Ohne sie sieht ein alter Stand aus wie ein aktueller – und das ist
 * der eigentliche Schaden, nicht der alte Stand selbst. Dieselbe Sprache
 * wie die Familienseite (familiecache.standText).
 */
export function hinweisText(stand: number | null, jetzt: Date = new Date()): string {
  if (!stand) return 'Ohne Verbindung';
  const zeit = new Date(stand);
  const uhr = `${String(zeit.getHours()).padStart(2, '0')}:${String(
    zeit.getMinutes()
  ).padStart(2, '0')}`;
  const gleicherTag = zeit.toDateString() === jetzt.toDateString();
  return gleicherTag
    ? `Ohne Verbindung – Stand von ${uhr}`
    : `Ohne Verbindung – Stand vom ${zeit.getDate()}.${zeit.getMonth() + 1}., ${uhr}`;
}
