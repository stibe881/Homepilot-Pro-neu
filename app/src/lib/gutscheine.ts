/**
 * Gutscheine: die entscheidbare Hälfte (Punkt 264 der Werkbank).
 *
 * Geschenkgutscheine liegen im Haushalt an vier Orten: als Karte im
 * Portemonnaie, als Mail im Postfach, als Zettel am Kühlschrank und im
 * Kopf («da war doch noch was von Brack»). Wenn dann einer eingelöst
 * wird, weiss niemand mehr, wie viel noch drauf ist. Die Sammlung
 * `vouchers` beim Hub hält Laden, Restbetrag, Nummer und den Verlauf der
 * Abzüge fest – und wer einen Gutschein «privat» stellt, bekommt ihn
 * als Einziger geliefert; die App muss nichts filtern.
 *
 * Alles hier rechnet nur: Texte, Sortierung, der Abzug. Der Bildschirm
 * (screens/family/gutscheine.tsx) zeigt es an. Beträge kommen als Zahl
 * vom Hub; was hier als Text erscheint, ist immer «80.00 CHF» oder
 * «1 Stk.» – Schweizer Schreibweise mit Punkt, nicht Komma.
 */
import type { Leerbild } from './leerzustand';

export type Einheit = 'chf' | 'stk';
export type Geteilt = 'privat' | 'familie';
export type Ablaufstufe = 'ok' | 'bald' | 'abgelaufen' | 'unbegrenzt';

export interface Transaktion {
  /** ISO-Zeitpunkt des Abzugs. */
  at: string;
  amount: number;
  by: string;
  note?: string;
}

/** Ein Gutschein, wie er in der Familiensammlung `vouchers` liegt. */
export interface Gutschein {
  id?: string;
  author?: string;
  created?: string;
  shop: string;
  title?: string;
  unit: Einheit;
  total: number;
  left: number;
  number?: string;
  pin?: string;
  /** «YYYY-MM-DD» – oder null für «unbegrenzt gültig». */
  expires: string | null;
  category?: string;
  shared: Geteilt;
  url?: string;
  /** Beim Speichern eine data-URI; der Hub legt sie als Datei ab und
   *  liefert danach einen Pfad wie «/api/family/vouchers/<id>/bild?v=…» –
   *  dieselbe Bauart wie bei den Rezeptbildern (Punkt 193). */
  image_url?: string | null;
  /** Der Beleg zum Gutschein – meist das PDF aus der Bestätigungsmail
   *  (Punkt 266 der Werkbank). Fehlt oder null, wenn keiner dranhängt. */
  file?: GutscheinDatei | null;
  transactions?: Transaktion[];
  notes?: string;
}

/** Ab so vielen Tagen vor dem Ablauf wird gewarnt. Ein Monat: lang genug,
 *  um noch in den Laden zu kommen, kurz genug, dass die Warnung nicht
 *  zum Dauerzustand wird, den niemand mehr sieht. */
export const BALD_TAGE = 30;

export const EINHEITEN: { key: Einheit; label: string }[] = [
  { key: 'chf', label: 'CHF' },
  { key: 'stk', label: 'Stück' },
];

export const GETEILT: { key: Geteilt; label: string }[] = [
  { key: 'privat', label: 'Privat' },
  { key: 'familie', label: 'Familie' },
];

/** Vorgeschlagene Kategorien, solange die Liste noch keine eigenen kennt. */
export const KATEGORIEN_START = ['Shopping', 'Essen', 'Kino', 'Reisen', 'Sonstiges'];

// ── Lesen ────────────────────────────────────────────────────────────────

function zahl(wert: unknown, sonst = 0): number {
  const n = typeof wert === 'number' ? wert : parseFloat(String(wert ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : sonst;
}

/**
 * Einen Eintrag vom Hub in einen Gutschein wandeln (rein, testbar).
 *
 * Die Familienlisten sind offene Objekte; was hier ankommt, kann von
 * einem älteren Formular oder einer Hand-Eingabe stammen. Fehlt die
 * Einheit, ist es CHF; fehlt `left`, ist noch alles drauf.
 */
export function alsGutschein(item: Record<string, unknown>): Gutschein {
  const total = Math.max(0, zahl(item.total));
  const left = item.left === undefined || item.left === null ? total : zahl(item.left);
  const expires = String(item.expires ?? '').trim();
  return {
    id: item.id ? String(item.id) : undefined,
    author: item.author ? String(item.author) : undefined,
    created: item.created ? String(item.created) : undefined,
    shop: String(item.shop ?? item.text ?? '').trim(),
    title: String(item.title ?? '').trim(),
    unit: item.unit === 'stk' ? 'stk' : 'chf',
    total,
    // Nie unter null, nie über dem Gesamtwert - was der Hub auch liefert.
    left: Math.min(Math.max(0, left), total),
    number: String(item.number ?? '').trim(),
    pin: String(item.pin ?? '').trim(),
    expires: /^\d{4}-\d{2}-\d{2}$/.test(expires) ? expires : null,
    category: String(item.category ?? '').trim(),
    // Wie der Hub (core/gutscheine.py): ohne Angabe gehört er der Familie.
    shared: item.shared === 'privat' ? 'privat' : 'familie',
    url: String(item.url ?? '').trim(),
    image_url: item.image_url ? String(item.image_url) : null,
    file: alsDatei(item.file),
    transactions: Array.isArray(item.transactions)
      ? (item.transactions as Record<string, unknown>[]).map((t) => ({
          at: String(t?.at ?? ''),
          amount: zahl(t?.amount),
          by: String(t?.by ?? ''),
          note: t?.note ? String(t.note) : undefined,
        }))
      : [],
    notes: String(item.notes ?? '').trim(),
  };
}

// ── Datei ────────────────────────────────────────────────────────────────

/**
 * Der Beleg am Gutschein (Punkt 266 der Werkbank).
 *
 * Gutscheine kommen meist als PDF per Mail; das Foto der Karte ist nur
 * die halbe Miete. Das Feld hat zwei Gestalten: Auf dem Weg **zum** Hub
 * trägt es `{data, name}` – die Datei als data-URI, genau wie beim Bild.
 * Der Hub legt sie ab und liefert danach `{url, name, type, bytes}`
 * zurück. Ein Block, der schon eine `url` trägt, geht beim nächsten
 * Speichern unverändert wieder hinaus – das ist der Grund, warum ein
 * bestehender Gutschein beim Bearbeiten seine Datei behält.
 */
export interface GutscheinDatei {
  /** Pfad beim Hub, «/api/family/vouchers/<id>/datei?v=…» – braucht wie
   *  das Bild Adresse und Token (siehe `bildUri`). */
  url?: string;
  /** Nur auf dem Hinweg: die Datei selbst als data-URI. */
  data?: string;
  name: string;
  type?: string;
  bytes?: number;
}

/** Was der Hub annimmt. Grösser abzulehnen ist billiger, als es erst
 *  nach dem Hochladen zu erfahren – deshalb steht die Grenze auch hier. */
export const DATEI_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Was der Hub annimmt – Zeichen für Zeichen die Tabelle `TYPES` aus
 * `hub/homepilot/core/dateien.py`.
 *
 * Kein `image/*` und kein `text/*`: SVG und HTML dürfen Skripte
 * enthalten, und der Hub liefert, was bei ihm liegt, unter seiner
 * eigenen Adresse wieder aus – im Browser liefe so ein Skript mit den
 * Zugangsdaten des Hubs im Speicher. Der Hub lehnt beides ab; hier
 * dieselbe Liste zu führen ist der Unterschied zwischen «geht nicht»
 * vor dem Hochladen und einem 415 nach dem Warten.
 */
const ERLAUBTE_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'application/zip',
]);

/** Dieselben Typen für den Auswähler: Was der Hub nicht nimmt, soll
 *  schon im Dateidialog grau sein. */
export const DATEI_TYPEN = [...ERLAUBTE_MIMES];

/** Notnagel für Geräte, die keinen MIME-Typ mitliefern: Android gibt bei
 *  Dateien aus manchen Cloud-Ordnern nur «application/octet-stream».
 *  Nur Endungen, die der Hub auch annimmt – für alles andere bleibt der
 *  Typ leer, und `dateiPruefen` sagt es. */
const MIME_NACH_ENDUNG: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};

function endung(name: string): string {
  const teile = String(name ?? '').toLowerCase().split('.');
  return teile.length > 1 ? teile[teile.length - 1].trim() : '';
}

/**
 * Der MIME-Typ, mit dem wir die Datei speichern (rein, testbar).
 *
 * Erst das, was der Auswähler sagt; nur wenn er nichts oder das
 * nichtssagende «application/octet-stream» liefert, entscheidet die
 * Endung. Ohne das landet jedes PDF aus einem Cloud-Ordner als
 * Bytehaufen beim Hub und bekommt hinterher das falsche Symbol.
 */
export function mimeVon(name: string, mimeType?: string | null): string {
  const roh = String(mimeType ?? '').trim().toLowerCase();
  if (roh && roh !== 'application/octet-stream') return roh;
  return MIME_NACH_ENDUNG[endung(name)] ?? roh;
}

/** Nimmt der Hub diesen Typ? (rein, testbar) */
export function dateiErlaubt(type: string | null | undefined): boolean {
  return ERLAUBTE_MIMES.has(String(type ?? '').trim().toLowerCase());
}

/**
 * «179 KB», «1.2 MB», «812 B» (rein, testbar).
 *
 * Ganze Kilobyte, aber eine Nachkommastelle bei Megabyte: «1 MB» und
 * «1.9 MB» sind für die Frage «passt das noch?» ein Unterschied,
 * «178 KB» und «179 KB» nicht.
 */
export function dateiGroesse(bytes: number | null | undefined): string {
  const n = typeof bytes === 'number' ? bytes : NaN;
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${Math.round(n)} B`;
  const kb = Math.round(n / 1024);
  if (kb < 1024) return `${kb} KB`;
  const mb = (n / (1024 * 1024)).toFixed(1);
  return `${mb.endsWith('.0') ? mb.slice(0, -2) : mb} MB`;
}

/**
 * Das Symbol zur Datei (rein, testbar).
 *
 * Ein Ionicons-Name. Wer die Liste überfliegt, soll am Symbol sehen, ob
 * der Beleg ein PDF, ein Foto oder eine Tabelle ist – dafür ist es da;
 * ein Papierklammer-Symbol für alles wäre keine Auskunft.
 */
export function dateiSymbol(type: string | null | undefined): string {
  const t = String(type ?? '').trim().toLowerCase();
  if (t.includes('pdf')) return 'document-text-outline';
  if (t.startsWith('image/')) return 'image-outline';
  // CSV ist zwar «text/», gemeint ist aber eine Tabelle - wie xls.
  if (t.includes('sheet') || t.includes('excel') || t.includes('csv')) return 'grid-outline';
  if (t.startsWith('text/')) return 'document-outline';
  if (t.includes('zip')) return 'archive-outline';
  return 'document-attach-outline';
}

/**
 * Warum diese Datei nicht geht – oder null, wenn sie geht (rein, testbar).
 *
 * Geprüft wird **vor** dem Einlesen: Eine 40-MB-Datei erst nach dem
 * Warten abgelehnt zu bekommen ist die schlechtere Reihenfolge, und das
 * Einlesen einer solchen Datei als data-URI kostet obendrein Speicher,
 * den das Telefon nicht hergeben will.
 */
export function dateiPruefen(datei: {
  name?: string | null;
  size?: number | null;
  mimeType?: string | null;
}): string | null {
  const name = String(datei?.name ?? '').trim();
  if (!name) return 'Diese Datei hat keinen Namen – bitte eine andere wählen.';
  const size = typeof datei?.size === 'number' && Number.isFinite(datei.size) ? datei.size : null;
  if (size !== null && size > DATEI_MAX_BYTES) {
    return (
      `«${name}» ist ${dateiGroesse(size)} gross – der Hub nimmt höchstens ` +
      `${dateiGroesse(DATEI_MAX_BYTES)}. Bitte eine kleinere Fassung wählen.`
    );
  }
  if (size === 0) return `«${name}» ist leer – da steht nichts drin.`;
  if (!dateiErlaubt(mimeVon(name, datei?.mimeType))) {
    return (
      `«${name}» ist kein Format, das der Hub ablegt. Möglich sind PDF, ` +
      'JPEG, PNG, WebP, Word, Excel, Text, CSV und ZIP.'
    );
  }
  return null;
}

/** «Gutschein Brack.pdf, 179 KB» – der Kern jedes Vorlesezeichens. */
export function dateiSatz(datei: GutscheinDatei | null | undefined): string {
  if (!datei) return '';
  const groesse = dateiGroesse(datei.bytes);
  return groesse ? `${datei.name}, ${groesse}` : datei.name;
}

/**
 * Einen Datei-Block vom Hub lesen (rein, testbar).
 *
 * Ohne `url` und ohne `data` ist nichts dran – dann null, damit die
 * Anzeige nicht auf einen leeren Namen hereinfällt.
 */
export function alsDatei(wert: unknown): GutscheinDatei | null {
  if (!wert || typeof wert !== 'object') return null;
  const roh = wert as Record<string, unknown>;
  const url = String(roh.url ?? '').trim();
  const data = String(roh.data ?? '').trim();
  if (!url && !data) return null;
  const bytes = Number(roh.bytes);
  const type = String(roh.type ?? '').trim();
  return {
    ...(url ? { url } : {}),
    ...(data ? { data } : {}),
    name: String(roh.name ?? '').trim() || 'Datei',
    ...(type ? { type } : {}),
    ...(Number.isFinite(bytes) && bytes > 0 ? { bytes } : {}),
  };
}

/**
 * Den MIME-Typ in einer data-URI nachtragen (rein, testbar).
 *
 * Der Weg über Blob und FileReader liefert auf Android oft
 * «data:application/octet-stream;base64,…», weil der Anbieter des
 * Cloud-Ordners keinen Typ meldet. Was der Auswähler weiss oder die
 * Endung verrät, ist besser – sonst lädt der Browser das PDF später
 * herunter, statt es anzuzeigen. Ein bereits gesetzter, sinnvoller Typ
 * bleibt.
 */
export function mitMimeTyp(datenUri: string, mime: string): string {
  const roh = String(datenUri ?? '');
  const treffer = /^data:([^,]*),/.exec(roh);
  if (!treffer || !mime) return roh;
  const teile = treffer[1].split(';');
  const bisher = teile[0].trim().toLowerCase();
  if (bisher && bisher !== 'application/octet-stream') return roh;
  const anhang = teile.slice(1).filter(Boolean).join(';');
  return `data:${mime}${anhang ? `;${anhang}` : ''},${roh.slice(treffer[0].length)}`;
}

// ── Texte ────────────────────────────────────────────────────────────────

/** «80.00 CHF» oder «1 Stk.» (rein, testbar). */
export function betragText(wert: number, unit: Einheit): string {
  if (unit === 'stk') return `${Math.round(wert)} Stk.`;
  return `${wert.toFixed(2)} CHF`;
}

/** Der Restbetrag als Text – die grosse Zahl auf der Karte. */
export function restText(entry: Pick<Gutschein, 'left' | 'unit'>): string {
  return betragText(entry.left, entry.unit);
}

/** Nur die Zahl, ohne Einheit – für die grosse Schrift, neben der die
 *  Einheit klein steht. */
export function betragZahl(wert: number, unit: Einheit): string {
  return unit === 'stk' ? String(Math.round(wert)) : wert.toFixed(2);
}

export function einheitText(unit: Einheit): string {
  return unit === 'stk' ? 'Stk.' : 'CHF';
}

/** «30.06.2030» aus «2030-06-30» (rein, testbar). */
export function datumText(iso: string | null | undefined): string {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!treffer) return '';
  return `${treffer[3]}.${treffer[2]}.${treffer[1]}`;
}

/**
 * «30.6.2030» oder «30.06.30» zurück in «2030-06-30» (rein, testbar).
 *
 * Getippt wird, wie man es auf der Karte liest – mit Punkten. Ein
 * zweistelliges Jahr meint dieses Jahrhundert; ein unlesbares Datum
 * gibt null zurück, damit das Formular nachfragen kann statt still
 * «unbegrenzt» zu speichern.
 */
export function datumLesen(text: string): string | null {
  const roh = String(text ?? '').trim();
  if (!roh) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(roh)) return gueltigesDatum(roh) ? roh : null;
  const treffer = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(roh);
  if (!treffer) return null;
  const jahr = treffer[3].length === 2 ? `20${treffer[3]}` : treffer[3];
  const iso = `${jahr}-${treffer[2].padStart(2, '0')}-${treffer[1].padStart(2, '0')}`;
  return gueltigesDatum(iso) ? iso : null;
}

function gueltigesDatum(iso: string): boolean {
  const [j, m, t] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
}

/** Heute als «YYYY-MM-DD» in Ortszeit – der Vergleichswert für alles. */
export function heuteIso(jetzt: Date = new Date()): string {
  const m = String(jetzt.getMonth() + 1).padStart(2, '0');
  const t = String(jetzt.getDate()).padStart(2, '0');
  return `${jetzt.getFullYear()}-${m}-${t}`;
}

/** Tage von `heute` bis `expires`; negativ, wenn vorbei. */
export function tageBis(expires: string, heute: string): number {
  const [j1, m1, t1] = heute.split('-').map(Number);
  const [j2, m2, t2] = expires.split('-').map(Number);
  return Math.round((Date.UTC(j2, m2 - 1, t2) - Date.UTC(j1, m1 - 1, t1)) / 86_400_000);
}

/**
 * Wie es um das Ablaufdatum steht (rein, testbar).
 *
 * Der letzte Tag zählt noch: Ein Gutschein «gültig bis 30.06.» ist am
 * 30.06. im Laden noch gut – abgelaufen ist er ab dem 1.07.
 */
export function ablaufStufe(expires: string | null | undefined, heute: string | Date): Ablaufstufe {
  if (!expires) return 'unbegrenzt';
  const tag = typeof heute === 'string' ? heute : heuteIso(heute);
  const tage = tageBis(expires, tag);
  if (tage < 0) return 'abgelaufen';
  if (tage <= BALD_TAGE) return 'bald';
  return 'ok';
}

/** «Gültig bis 30.06.2030», «Unbegrenzt», «Läuft in 12 Tagen ab»,
 *  «Abgelaufen am 30.06.2026» – die Zeile unter dem Betrag. */
export function ablaufSatz(expires: string | null | undefined, heute: string | Date): string {
  const stufe = ablaufStufe(expires, heute);
  if (stufe === 'unbegrenzt') return 'Unbegrenzt';
  if (stufe === 'abgelaufen') return `Abgelaufen am ${datumText(expires)}`;
  if (stufe === 'bald') {
    const tag = typeof heute === 'string' ? heute : heuteIso(heute);
    const tage = tageBis(String(expires), tag);
    if (tage === 0) return 'Läuft heute ab';
    if (tage === 1) return 'Läuft morgen ab';
    return `Läuft in ${tage} Tagen ab`;
  }
  return `Gültig bis ${datumText(expires)}`;
}

/** Ist der Gutschein leer? Ein Rest unter einem Rappen zählt als leer –
 *  Fliesskommareste sollen keinen «0.00 CHF»-Gutschein offen halten. */
export function aufgebraucht(entry: Pick<Gutschein, 'left'>): boolean {
  return entry.left < 0.005;
}

/** Anteil des Rests am Gesamtwert, 0…1 – für den Balken. */
export function anteil(entry: Pick<Gutschein, 'left' | 'total'>): number {
  if (entry.total <= 0) return 0;
  return Math.min(1, Math.max(0, entry.left / entry.total));
}

// ── Liste ────────────────────────────────────────────────────────────────

/** Wer in der Liste steht (noch etwas drauf) – vor allen anderen. */
export function verfuegbar(list: Gutschein[]): Gutschein[] {
  return list.filter((entry) => !aufgebraucht(entry));
}

/**
 * Die Reihenfolge der Liste (rein, testbar).
 *
 * Was bald abläuft, steht oben – das ist die Information, wegen der man
 * die Liste überhaupt aufmacht. Dahinter alphabetisch nach Laden; die
 * Abgelaufenen ganz unten, ausgegraut, aber nicht weg: Manche Läden
 * nehmen sie mit Nachfrage doch noch.
 */
export function sortiert(list: Gutschein[], heute: string | Date): Gutschein[] {
  const rang: Record<Ablaufstufe, number> = { bald: 0, ok: 1, unbegrenzt: 1, abgelaufen: 2 };
  return [...list].sort((a, b) => {
    const sa = ablaufStufe(a.expires, heute);
    const sb = ablaufStufe(b.expires, heute);
    if (rang[sa] !== rang[sb]) return rang[sa] - rang[sb];
    if (sa === 'bald' && sb === 'bald' && a.expires !== b.expires) {
      return String(a.expires).localeCompare(String(b.expires));
    }
    return a.shop.localeCompare(b.shop, 'de-CH', { sensitivity: 'base' });
  });
}

/** Offene und aufgebrauchte getrennt – die zweite Gruppe steht
 *  eingeklappt unter der Liste. Beide sortiert. */
export function aufgeteilt(
  list: Gutschein[],
  heute: string | Date
): { offen: Gutschein[]; leer: Gutschein[] } {
  return {
    offen: sortiert(list.filter((entry) => !aufgebraucht(entry)), heute),
    leer: sortiert(list.filter(aufgebraucht), heute),
  };
}

/**
 * Was alle offenen CHF-Gutscheine zusammen noch wert sind (rein, testbar).
 *
 * Nur CHF: Stück-Gutscheine («1 Kinoeintritt») haben keinen Betrag, den
 * man addieren könnte. Und nur, was nicht abgelaufen ist – die Summe
 * soll sagen, was man noch ausgeben kann, nicht, was man verpasst hat.
 */
export function summe(list: Gutschein[], heute: string | Date): number {
  return list
    .filter((entry) => entry.unit === 'chf' && !aufgebraucht(entry))
    .filter((entry) => ablaufStufe(entry.expires, heute) !== 'abgelaufen')
    .reduce((acc, entry) => acc + entry.left, 0);
}

/** «30 verfügbar» – die Kopfzeile. */
export function kopfText(list: Gutschein[]): string {
  const n = verfuegbar(list).length;
  return `${n} verfügbar`;
}

/** «3 verfügbar · 640 CHF» – die Zeile auf der Modul-Kachel. */
export function kachelText(
  items: (Record<string, unknown> | Gutschein)[],
  heute: string | Date
): string {
  const list = (items ?? []).map((item) => alsGutschein(item as Record<string, unknown>));
  const n = verfuegbar(list).length;
  if (n === 0) return 'Noch keiner erfasst';
  const chf = summe(list, heute);
  const stueck = `${n} verfügbar`;
  return chf > 0 ? `${stueck} · ${betragText(chf, 'chf')}` : stueck;
}

/** Alle Kategorien, die die Liste kennt – plus die Vorschläge, solange
 *  es noch wenige sind. Sortiert, ohne Doppelte. */
export function kategorien(list: Gutschein[]): string[] {
  const alle = new Set<string>(KATEGORIEN_START);
  for (const entry of list) if (entry.category) alle.add(entry.category);
  return [...alle].sort((a, b) => a.localeCompare(b, 'de-CH'));
}

/** Trifft die Suche Laden, Titel, Kategorie, Nummer oder Notiz? (rein, testbar) */
export function passtSuche(entry: Gutschein, frage: string): boolean {
  const gesucht = String(frage ?? '').trim().toLowerCase();
  if (!gesucht) return true;
  return [entry.shop, entry.title, entry.category, entry.number, entry.notes]
    .map((wert) => String(wert ?? '').toLowerCase())
    .some((wert) => wert.includes(gesucht));
}

export interface Filter {
  kategorie?: string | null;
  geteilt?: Geteilt | null;
  /** Nur, was in den nächsten dreissig Tagen abläuft. */
  bald?: boolean;
}

/** Suche und Filter zusammen (rein, testbar). */
export function gefiltert(
  list: Gutschein[],
  frage: string,
  filter: Filter,
  heute: string | Date
): Gutschein[] {
  return list.filter((entry) => {
    if (!passtSuche(entry, frage)) return false;
    if (filter.kategorie && entry.category !== filter.kategorie) return false;
    if (filter.geteilt && entry.shared !== filter.geteilt) return false;
    if (filter.bald && ablaufStufe(entry.expires, heute) !== 'bald') return false;
    return true;
  });
}

// ── Abziehen ─────────────────────────────────────────────────────────────

/**
 * Den getippten Betrag lesen (rein, testbar).
 *
 * «12,50» und «12.50» sind dasselbe – die Tastatur zeigt je nach
 * Gerät das eine oder das andere. Bei Stück-Gutscheinen nur ganze
 * Zahlen: einen halben Kinoeintritt gibt es nicht.
 */
export function betragLesen(text: string, unit: Einheit): number | null {
  const roh = String(text ?? '').trim().replace(',', '.');
  if (!roh) return null;
  if (unit === 'stk') {
    if (!/^\d+$/.test(roh)) return null;
    return parseInt(roh, 10);
  }
  if (!/^\d+(\.\d{0,2})?$/.test(roh)) return null;
  return Math.round(parseFloat(roh) * 100) / 100;
}

/**
 * Warum ein Abzug nicht geht – oder null, wenn er geht (rein, testbar).
 *
 * Der Hinweis steht im Dialog, statt dass der Knopf stumm nichts tut
 * oder der Rest unter null fällt.
 */
export function abzugPruefen(entry: Gutschein, betrag: number | null): string | null {
  if (betrag === null || !Number.isFinite(betrag)) {
    return entry.unit === 'stk' ? 'Bitte eine ganze Zahl eingeben.' : 'Bitte einen Betrag eingeben.';
  }
  if (betrag <= 0) return 'Der Betrag muss grösser als null sein.';
  if (betrag > entry.left + 0.005) {
    return `Es sind nur noch ${restText(entry)} drauf.`;
  }
  return null;
}

/**
 * Einen Betrag abziehen – gibt den neuen Eintrag zurück (rein, testbar).
 *
 * Der Rest klemmt bei null: Wer «ganzen Rest» tippt und dabei einen
 * Rappen zu viel erwischt, bekommt einen leeren Gutschein, keinen
 * negativen. Der Verlauf hält fest, wer wann wie viel abgezogen hat –
 * das ist die Antwort auf «wer hat den Brack-Gutschein gebraucht?».
 */
export function abziehen(entry: Gutschein, betrag: number, by: string, now: Date): Gutschein {
  const abzug = Math.max(0, betrag);
  const left = Math.max(0, Math.round((entry.left - abzug) * 100) / 100);
  const buchung: Transaktion = {
    at: now.toISOString(),
    amount: Math.round(Math.min(abzug, entry.left) * 100) / 100,
    by: String(by ?? '').trim() || '?',
  };
  return { ...entry, left, transactions: [...(entry.transactions ?? []), buchung] };
}

/** Der Verlauf, das Jüngste zuoberst. */
export function verlauf(entry: Gutschein): Transaktion[] {
  return [...(entry.transactions ?? [])].sort((a, b) => b.at.localeCompare(a.at));
}

// ── Teilen und Speichern ─────────────────────────────────────────────────

/**
 * Der Gutschein als Text fürs Teilen-Blatt (rein, testbar).
 *
 * Wer den Gutschein jemandem weitergibt, braucht genau das, was er im
 * Laden oder im Bestellformular eintippt: Laden, Nummer, PIN, Rest.
 * Leere Felder bleiben weg – «PIN: –» hilft niemandem.
 */
export function teilText(entry: Gutschein): string {
  const zeilen = [entry.title ? `${entry.shop} – ${entry.title}` : entry.shop];
  if (entry.number) zeilen.push(`Nummer: ${entry.number}`);
  if (entry.pin) zeilen.push(`PIN: ${entry.pin}`);
  zeilen.push(`Rest: ${restText(entry)} von ${betragText(entry.total, entry.unit)}`);
  if (entry.expires) zeilen.push(`Gültig bis ${datumText(entry.expires)}`);
  else zeilen.push('Unbegrenzt gültig');
  if (entry.url) zeilen.push(entry.url);
  return zeilen.join('\n');
}

/** Was das Formular eingetippt hat – als Text, wie die Felder es halten. */
export interface Formular {
  shop: string;
  title: string;
  unit: Einheit;
  total: string;
  number: string;
  pin: string;
  /** Leer heisst «unbegrenzt». */
  expires: string;
  category: string;
  shared: Geteilt;
  url: string;
  image_url: string;
  /** Der Beleg – null heisst «keiner dran». */
  file: GutscheinDatei | null;
  notes: string;
}

export function leeresFormular(): Formular {
  return {
    shop: '',
    title: 'Gutschein',
    unit: 'chf',
    total: '',
    number: '',
    pin: '',
    expires: '',
    category: '',
    shared: 'familie',
    url: '',
    image_url: '',
    file: null,
    notes: '',
  };
}

/** Den bestehenden Eintrag ins Formular legen. */
export function formularVon(entry: Gutschein): Formular {
  return {
    shop: entry.shop,
    title: entry.title ?? '',
    unit: entry.unit,
    total: betragZahl(entry.total, entry.unit),
    number: entry.number ?? '',
    pin: entry.pin ?? '',
    expires: datumText(entry.expires),
    category: entry.category ?? '',
    shared: entry.shared,
    url: entry.url ?? '',
    image_url: entry.image_url ?? '',
    // Die Datei reist mit, ohne dass das Formular sie anfasst: Wer nur
    // den Betrag korrigiert, soll den Beleg nicht verlieren - genau das
    // ist der übliche Fehler bei so einem Feld.
    file: entry.file ?? null,
    notes: entry.notes ?? '',
  };
}

/**
 * Das Formular prüfen und in einen Eintrag wandeln (rein, testbar).
 *
 * Pflicht sind Laden und Wert – alles andere darf leer bleiben. Ändert
 * sich der Gesamtwert eines bestehenden Gutscheins, wandert der Rest
 * mit: Wer «100» in «120» korrigiert, hat vermutlich beim Erfassen
 * vertippt, nicht 20 Franken geschenkt bekommen … aber der Rest darf
 * nie über dem Gesamtwert liegen.
 */
export function formularPruefen(
  form: Formular,
  bisher: Gutschein | null
): { eintrag: Gutschein; fehler: null } | { eintrag: null; fehler: string } {
  const shop = form.shop.trim();
  if (!shop) return { eintrag: null, fehler: 'Bitte den Laden angeben.' };
  const total = betragLesen(form.total, form.unit);
  if (total === null || total <= 0) {
    return {
      eintrag: null,
      fehler: form.unit === 'stk' ? 'Bitte die Anzahl angeben.' : 'Bitte den Wert angeben.',
    };
  }
  const ablauf = form.expires.trim();
  const expires = ablauf ? datumLesen(ablauf) : null;
  if (ablauf && !expires) {
    return { eintrag: null, fehler: 'Das Ablaufdatum bitte als TT.MM.JJJJ schreiben.' };
  }
  let url = form.url.trim();
  if (url && !/^[a-z]+:\/\//i.test(url)) url = `https://${url}`;
  // Der Rest folgt dem Gesamtwert um die Differenz - der Verlauf bleibt.
  const left = bisher
    ? Math.min(total, Math.max(0, Math.round((bisher.left + (total - bisher.total)) * 100) / 100))
    : total;
  return {
    fehler: null,
    eintrag: {
      ...(bisher ?? {}),
      shop,
      title: form.title.trim(),
      unit: form.unit,
      total,
      left,
      number: form.number.trim(),
      pin: form.pin.trim(),
      expires,
      category: form.category.trim(),
      shared: form.shared,
      url,
      image_url: form.image_url || null,
      // null (nicht «weglassen»): So versteht der Hub auch das Entfernen.
      file: form.file ?? null,
      notes: form.notes.trim(),
      transactions: bisher?.transactions ?? [],
    },
  };
}

// ── Leerzustände ─────────────────────────────────────────────────────────

/** Die leere Liste – im Stil von lib/leerzustand.ts. */
export function listeLeerbild(gesucht: boolean): Leerbild {
  if (gesucht) {
    return {
      icon: 'search-outline',
      titel: 'Nichts gefunden',
      satz: 'Kein Gutschein passt zu Suche und Filter.',
    };
  }
  return {
    icon: 'gift-outline',
    titel: 'Noch keine Gutscheine',
    satz:
      'Geschenkkarten, Online-Codes und Kinoeintritte – hier stehen sie mit ' +
      'Rest, Nummer und Ablaufdatum, und jeder Abzug wird festgehalten.',
    aktion: 'Gutschein erfassen',
  };
}

/** Der leere Verlauf im Detail. */
export function verlaufLeerbild(): Leerbild {
  return {
    icon: 'receipt-outline',
    titel: 'Bisher keine Einlösungen erfasst.',
    satz: 'Jeder Abzug landet hier – mit Datum und wer es war.',
  };
}
