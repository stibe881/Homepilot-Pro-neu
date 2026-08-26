/**
 * Wer zur Familie gehört – auch ohne eigenen Zugang zur App.
 *
 * Die Namen für Aufgaben, Ämtli und Punkte kamen bisher aus `/api/users`,
 * also aus der Liste der Hub-Zugänge. Das ist die falsche Liste: Ein
 * fünfjähriges Kind bekommt kein Konto mit Token, soll aber im Ämtli-Plan
 * stehen und Punkte sammeln. Wer es trotzdem eintragen wollte, musste
 * einen Zugang samt Rolle anlegen – ein Anmeldename fürs Kind, damit das
 * Bad geputzt wird.
 *
 * Deshalb zwei Quellen und eine Liste: die Zugänge (wer die App bedienen
 * darf) und `family_members` (wer im Haushalt mitzählt). Zusammengeführt
 * wird hier, damit jede Ansicht dieselbe Reihe sieht.
 *
 * Wer später doch einen Zugang bekommt, steht in beiden Listen. Dann
 * gewinnt der Zugang – sonst stünde derselbe Mensch zweimal da, und die
 * Punkte verteilten sich auf zwei gleich heissende Zeilen.
 */

export interface Mitglied {
  name: string;
  /** «besitzer», «bewohner», «gast» – oder «kind»/«erwachsen» ohne Zugang. */
  role: string;
  /** Steht nur in den Familienlisten, kann sich nicht anmelden. */
  ohneZugang?: boolean;
  /** Kennung in `family_members` – nur bei Einträgen ohne Zugang. */
  id?: string;
}

/** Ein Eintrag aus `family_members`, wie er vom Hub kommt. */
export interface MitgliedRoh {
  id?: string;
  text?: string;
  role?: string;
}

const sauber = (name: unknown) => String(name ?? '').trim();
const schluessel = (name: unknown) => sauber(name).toLowerCase();

/**
 * Zugänge und eingetragene Angehörige zu einer Reihe (rein, testbar).
 *
 * Die Zugänge stehen vorn: Sie sind die Erwachsenen, die die Listen
 * pflegen, und ihre Reihenfolge kommt vom Hub. Angehängt wird, wer keinen
 * Zugang hat, in der Reihenfolge des Eintragens.
 */
export function mitglieder(
  konten: { name: string; role: string }[] | null | undefined,
  eigene: MitgliedRoh[] | null | undefined
): Mitglied[] {
  const reihe: Mitglied[] = [];
  const gesehen = new Set<string>();
  for (const konto of konten ?? []) {
    const name = sauber(konto?.name);
    if (!name || gesehen.has(schluessel(name))) continue;
    gesehen.add(schluessel(name));
    reihe.push({ name, role: String(konto?.role ?? '') });
  }
  for (const eintrag of eigene ?? []) {
    const name = sauber(eintrag?.text);
    if (!name || gesehen.has(schluessel(name))) continue;
    gesehen.add(schluessel(name));
    reihe.push({
      name,
      role: String(eintrag?.role || 'kind'),
      ohneZugang: true,
      id: eintrag?.id ? String(eintrag.id) : undefined,
    });
  }
  return reihe;
}

/** Was unter dem Namen steht (rein, testbar).
 *
 *  Für Zugänge sagt es die Rolle im Haus (das übersetzt der Bildschirm mit
 *  ROLE_LABELS), hier geht es nur um die anderen: «Kind» ist eine Auskunft,
 *  «gast» wäre eine falsche. */
export function rolleWort(mitglied: Mitglied): string {
  if (!mitglied.ohneZugang) return '';
  return mitglied.role === 'erwachsen' ? 'Ohne Zugang' : 'Kind';
}

/**
 * Taugt dieser Name als neuer Eintrag? (rein, testbar)
 *
 * Zurück kommt der Grund, warum nicht – oder null, wenn er taugt. Der
 * Vergleich ist unempfindlich für Gross- und Kleinschreibung: «livia» und
 * «Livia» sind derselbe Mensch, und zwei Zeilen mit denselben Punkten
 * wären ein Fehler, den niemand mehr auseinanderklaubt.
 */
export function pruefeName(name: string, vorhandene: Mitglied[]): string | null {
  const gewuenscht = sauber(name);
  if (!gewuenscht) return 'Bitte einen Namen eingeben.';
  if (vorhandene.some((m) => schluessel(m.name) === schluessel(gewuenscht))) {
    return `«${gewuenscht}» steht schon in der Liste.`;
  }
  return null;
}

/** Die Namen für eine Auswahl (rein, testbar). */
export function namen(reihe: Mitglied[]): string[] {
  return reihe.map((mitglied) => mitglied.name);
}
