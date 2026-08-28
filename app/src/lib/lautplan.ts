/**
 * Lautstärke nach Tageszeit – die Seite der App.
 *
 * Der Plan selbst liegt im Hub (hub/core/lautplan.py); hier steht nur,
 * was man zum Anzeigen und Bearbeiten braucht. Reine Funktionen, damit
 * sich das Rechnen ohne Hub prüfen lässt.
 */

export interface Stufe {
  /** HH:MM. */
  at: string;
  volume: number;
}

export interface Plan {
  id?: string;
  name?: string;
  on?: boolean;
  /** Leer heisst: alle Boxen. */
  entities?: string[];
  steps: Stufe[];
}

/** Vorschlag für einen ersten Plan – vier Stufen, wie man den Tag lebt. */
export const VORLAGE: Stufe[] = [
  { at: '07:00', volume: 20 },
  { at: '10:00', volume: 70 },
  { at: '20:00', volume: 20 },
  { at: '23:45', volume: 10 },
];

/** «07:00» → 420 (rein, testbar). Unsinn ergibt null. */
export function minuten(hhmm: string): number | null {
  const treffer = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!treffer) return null;
  const h = Number(treffer[1]);
  const m = Number(treffer[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** 420 → «07:00» (rein, testbar). */
export function uhrzeit(min: number): string {
  const gesamt = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(gesamt / 60)).padStart(2, '0')}:${String(gesamt % 60).padStart(2, '0')}`;
}

/**
 * Welche Stufe zu dieser Minute gilt (rein, testbar).
 *
 * Vor der ersten Stufe des Tages gilt die letzte des Vortages – der
 * Umschlag um Mitternacht. Ohne ihn wäre die Nacht ein Loch im Plan,
 * und genau dort liegt sie.
 */
export function stufeJetzt(stufen: Stufe[], jetztMin: number): Stufe | null {
  const gueltig = (stufen ?? []).filter((s) => minuten(s.at) !== null);
  if (gueltig.length === 0) return null;
  const sortiert = [...gueltig].sort((a, b) => (minuten(a.at) ?? 0) - (minuten(b.at) ?? 0));
  const davor = sortiert.filter((s) => (minuten(s.at) ?? 0) <= jetztMin);
  return davor.length > 0 ? davor[davor.length - 1] : sortiert[sortiert.length - 1];
}

/** Stufen sortiert, doppelte Zeiten zusammengefasst (rein, testbar). */
export function geordnet(stufen: Stufe[]): Stufe[] {
  const nachZeit = new Map<string, Stufe>();
  for (const stufe of stufen ?? []) {
    const min = minuten(stufe.at);
    if (min === null) continue;
    nachZeit.set(uhrzeit(min), { at: uhrzeit(min), volume: stufe.volume });
  }
  return [...nachZeit.values()].sort((a, b) => (minuten(a.at) ?? 0) - (minuten(b.at) ?? 0));
}

/**
 * «ab 10:00 auf 70 %, bis 20:00» (rein, testbar).
 *
 * Mit dem Bis: Eine Stufe allein sagt, wann sie anfängt, und die Frage
 * beim Lesen ist immer «und wie lange?». Bei nur einer Stufe fehlt es –
 * dann gilt sie den ganzen Tag.
 */
export function stufenSatz(stufen: Stufe[], index: number): string {
  const liste = geordnet(stufen);
  const stufe = liste[index];
  if (!stufe) return '';
  if (liste.length === 1) return `${stufe.volume} % – den ganzen Tag`;
  const naechste = liste[(index + 1) % liste.length];
  return `${stufe.volume} % – bis ${naechste.at}`;
}

/**
 * Eine Box in die Auswahl nehmen oder herausnehmen (rein, testbar).
 *
 * Die leere Liste heisst «alle Boxen» und nicht «keine» – das ist die
 * Lesart des Hubs (hub/core/lautplan.py: gilt_fuer) und der Normalfall
 * im Haushalt. Wer die erste Box antippt, während «alle» gilt, meint
 * darum «nur diese» und nicht «alle ausser dieser».
 */
export function boxenUmschalten(liste: string[] | undefined, id: string): string[] {
  const jetzt = liste ?? [];
  if (jetzt.length === 0) return [id];
  if (!jetzt.includes(id)) return [...jetzt, id];
  const rest = jetzt.filter((eintrag) => eintrag !== id);
  // Die letzte abgewählt: Das ist wieder «alle», denn ein Plan ohne Box
  // hat keinen Adressaten und wäre nur eine Liste, die nichts tut.
  return rest;
}

/** Steht diese Box in der Auswahl? Leer heisst alle (rein, testbar). */
export function boxAn(liste: string[] | undefined, id: string): boolean {
  const jetzt = liste ?? [];
  return jetzt.length === 0 || jetzt.includes(id);
}

/**
 * «Alle Boxen» oder «Nest Badezimmer und 2 weitere» (rein, testbar).
 *
 * Ab drei wird gezählt statt aufgezählt: Elf Boxennamen in einer
 * Überschrift liest niemand, und die Auswahl steht als Chips ohnehin
 * darunter.
 */
export function boxenSatz(
  liste: string[] | undefined,
  namen: Record<string, string>,
): string {
  const jetzt = liste ?? [];
  if (jetzt.length === 0) return 'Alle Boxen';
  const beschriftet = jetzt.map((id) => namen[id] ?? id);
  if (beschriftet.length === 1) return beschriftet[0];
  if (beschriftet.length === 2) return `${beschriftet[0]} und ${beschriftet[1]}`;
  return `${beschriftet[0]} und ${beschriftet.length - 1} weitere`;
}

/**
 * Ein zweiter Plan, der sich mit dem ersten nicht überschneidet
 * (rein, testbar).
 *
 * Er startet mit den Boxen, die noch kein Plan abdeckt. Zwei Pläne für
 * dieselbe Box wären ein Widerspruch, den der Hub nach der Reihenfolge
 * auflöst – und eine Reihenfolge, die man nicht sieht, ist keine
 * Erklärung.
 */
export function freieBoxen(plaene: Plan[], alle: string[]): string[] {
  const vergeben = new Set(plaene.flatMap((plan) => plan.entities ?? []));
  // Deckt ein Plan «alle» ab, ist nichts mehr frei.
  if (plaene.some((plan) => (plan.entities ?? []).length === 0)) return [];
  return alle.filter((id) => !vergeben.has(id));
}

/**
 * Eine neue Stufe, die noch nicht im Plan steht (rein, testbar).
 *
 * Sie legt sich in die grösste Lücke: Wer eine Stufe hinzufügt, meint
 * fast nie «eine Minute nach der letzten», und eine neue Zeile, die
 * sofort mit einer bestehenden kollidiert, muss man erst reparieren,
 * bevor man sie benutzen kann.
 */
export function neueStufe(stufen: Stufe[]): Stufe {
  const liste = geordnet(stufen);
  if (liste.length === 0) return { at: '07:00', volume: 30 };
  let beste = { start: liste[liste.length - 1], luecke: -1, mitte: 0 };
  for (let i = 0; i < liste.length; i += 1) {
    const von = minuten(liste[i].at) ?? 0;
    const bis = minuten(liste[(i + 1) % liste.length].at) ?? 0;
    const luecke = bis > von ? bis - von : bis + 1440 - von;
    if (luecke > beste.luecke) {
      beste = { start: liste[i], luecke, mitte: von + Math.floor(luecke / 2) };
    }
  }
  return { at: uhrzeit(beste.mitte), volume: beste.start.volume };
}
