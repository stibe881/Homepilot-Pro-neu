/**
 * Eine Suche über alle Familienlisten – und die Frage «was ist neu?».
 *
 * Die Familienseite hat siebzehn Module. «Wo stand nochmal die Nummer vom
 * Kaminfeger?» hiess bisher: Kontakte öffnen, suchen, zurück,
 * Dokumentsafe öffnen, suchen (Punkt 166). Und weil jeder Eintrag
 * `author` und `created` trägt, ohne dass es je jemand las, sah man auf
 * der Übersicht nicht, wo sich etwas getan hat (Punkt 168).
 *
 * Beides ist reines Rechnen über Listen – ohne Bildschirm, ohne Netz.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Zeile = Record<string, any>;
export type Listen = Record<string, Zeile[]>;

/** Welche Listen durchsucht werden und wie sie in der App heissen. */
export const DURCHSUCHT: { key: string; label: string }[] = [
  { key: 'tasks', label: 'Aufgaben' },
  { key: 'shopping', label: 'Einkaufsliste' },
  { key: 'contacts', label: 'Kontakte' },
  { key: 'recipes', label: 'Rezeptbuch' },
  { key: 'documents', label: 'Dokumentsafe' },
  { key: 'pins', label: 'Pinnwand' },
  { key: 'chores', label: 'Ämtli' },
  { key: 'medications', label: 'Medikamente' },
  { key: 'emergency', label: 'Notfallblatt' },
  { key: 'routines', label: 'Routinen' },
  { key: 'packlists', label: 'Packlisten' },
  { key: 'countdowns', label: 'Countdowns' },
];

/** Felder, in denen gesucht wird. Alles andere ist Technik. */
const FELDER = [
  'text', 'name', 'title', 'body', 'note', 'notes', 'phone', 'phone2',
  'email', 'address', 'member', 'category', 'value',
];

export interface Treffer {
  collection: string;
  label: string;
  item: Zeile;
  /** Die Stelle, an der es passt – für die Zeile unter dem Namen. */
  fundstelle: string;
}

function textVon(item: Zeile, feld: string): string {
  const wert = item?.[feld];
  if (Array.isArray(wert)) return wert.map(String).join(' ');
  return typeof wert === 'string' || typeof wert === 'number' ? String(wert) : '';
}

/**
 * Quer durch alle Listen suchen (rein, testbar).
 *
 * Die Treffer bleiben nach Modul gruppiert: Eine Liste aus dreissig
 * Zeilen, in der Kontakte und Rezepte durcheinandergehen, beantwortet
 * die Frage nicht besser als das Blättern vorher.
 *
 * Unter zwei Zeichen wird nicht gesucht – «a» trifft alles.
 */
export function suche(
  data: Listen,
  frage: string,
  proModul = 5
): { collection: string; label: string; treffer: Treffer[] }[] {
  const gesucht = String(frage ?? '').trim().toLowerCase();
  if (gesucht.length < 2) return [];
  const gruppen: { collection: string; label: string; treffer: Treffer[] }[] = [];
  for (const modul of DURCHSUCHT) {
    const treffer: Treffer[] = [];
    for (const item of data?.[modul.key] ?? []) {
      let fundstelle = '';
      for (const feld of FELDER) {
        const inhalt = textVon(item, feld);
        if (inhalt.toLowerCase().includes(gesucht)) {
          // Der Name ist keine Fundstelle – er steht schon in der Zeile.
          if (!['text', 'name', 'title'].includes(feld)) fundstelle = inhalt;
          treffer.push({ collection: modul.key, label: modul.label, item, fundstelle });
          break;
        }
      }
      if (treffer.length >= proModul) break;
    }
    if (treffer.length > 0) {
      gruppen.push({ collection: modul.key, label: modul.label, treffer });
    }
  }
  return gruppen;
}

/** Wie ein Treffer in der Liste heisst (rein, testbar). */
export function trefferName(item: Zeile): string {
  return (
    String(item?.text ?? item?.name ?? item?.title ?? '').trim() || 'Ohne Namen'
  );
}

/**
 * Was ist seit dem letzten Besuch dazugekommen? (rein, testbar)
 *
 * Je Modul die Anzahl neuer Einträge, verglichen mit dem Zeitpunkt, den
 * das Gerät sich gemerkt hat. Was man selbst geschrieben hat, zählt
 * nicht: Ein Punkt auf der eigenen Notiz wäre nur Lärm.
 */
export function neuSeit(
  data: Listen,
  gesehen: Record<string, string>,
  ich: string
): Record<string, number> {
  const zahlen: Record<string, number> = {};
  for (const [collection, rows] of Object.entries(data ?? {})) {
    const marke = String(gesehen?.[collection] ?? '');
    const neue = (rows ?? []).filter((row) => {
      const wann = String(row?.created ?? '');
      if (!wann) return false;
      if (String(row?.author ?? '') === ich) return false;
      return !marke || wann > marke;
    });
    if (neue.length > 0) zahlen[collection] = neue.length;
  }
  return zahlen;
}

/**
 * «von Sandra, vorhin» – wer hat das zuletzt angelegt (rein, testbar).
 *
 * Jeder Eintrag trägt `author` und `created`, genutzt wurde das kaum.
 * Eine leise Zeile darunter beantwortet die häufigste Rückfrage
 * überhaupt: «wer hat das eingetragen?»
 */
export function herkunftText(item: Zeile, jetzt: Date): string {
  const wer = String(item?.author ?? '').trim();
  const wann = String(item?.created ?? '');
  const zeit = wann ? new Date(wann) : null;
  const teile: string[] = [];
  if (wer) teile.push(`von ${wer}`);
  if (zeit && !Number.isNaN(zeit.getTime())) {
    const minuten = Math.round((jetzt.getTime() - zeit.getTime()) / 60000);
    if (minuten < 60) teile.push('vorhin');
    else if (minuten < 24 * 60) teile.push(`vor ${Math.round(minuten / 60)} h`);
    else if (minuten < 48 * 60) teile.push('gestern');
    else teile.push(`am ${zeit.getDate()}.${zeit.getMonth() + 1}.`);
  }
  return teile.join(', ');
}
