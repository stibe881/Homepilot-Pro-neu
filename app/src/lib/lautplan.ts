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

export interface Planbox {
  id: string;
  name: string;
  /** Fernseher: Seine Lautstärke gehört zum Bild, nicht zur Tageszeit -
   *  deshalb ist er nur dabei, wenn man ihn ausdrücklich nennt. */
  bildschirm: boolean;
  /** Lautsprechergruppe: Sie stellt ihre Mitglieder mit. */
  gruppe: boolean;
}

/**
 * Was ein Plan überhaupt stellen kann (rein, testbar).
 *
 * Spiegelt `kandidat()` im Hub (hub/core/lautplan.py) – und das ist der
 * Punkt: Hier lagen die zwei Listen auseinander. Der Hub stellte
 * Lautsprechergruppen mit, die App bot sie nicht zur Wahl an. Wer
 * «Haus Musik» aus dem Plan nehmen wollte, fand sie nirgends. Und der
 * Fernseher stand in keiner der beiden, liess sich also auch dann nicht
 * aufnehmen, wenn man ihn wollte.
 *
 * Fernseher und Gruppen sind darum keine Ausnahme mehr, sondern nur
 * noch eine Eigenschaft: Sie stehen in der Liste und tragen ihre
 * Beschriftung.
 *
 * Reihenfolge: erst die Boxen, dann die Gruppen, dann die Fernseher –
 * je seltener gemeint, desto weiter hinten.
 */
export function planBoxen(
  entities: {
    id: string;
    name: string;
    kind: string;
    available?: boolean;
    commands: string[];
    state?: Record<string, unknown>;
  }[],
): Planbox[] {
  return entities
    .filter(
      (entity) =>
        entity.kind === 'media_player' &&
        entity.available !== false &&
        entity.commands.includes('set_volume'),
    )
    .map((entity) => ({
      id: entity.id,
      name: entity.name,
      bildschirm: entity.state?.has_screen === true,
      gruppe: entity.state?.is_group === true,
    }))
    .sort((a, b) => {
      const rang = (box: Planbox) => (box.bildschirm ? 2 : box.gruppe ? 1 : 0);
      return rang(a) - rang(b) || a.name.localeCompare(b.name, 'de');
    });
}

/**
 * Womit ein frischer Plan startet (rein, testbar).
 *
 * Ausdrücklich und nicht als leere Liste: Die leere Liste heisst beim
 * Hub «alle Lautsprecher», und dann stünden in der Auswahl Chips, die
 * ausgewählt aussehen, ohne es zu sein (der Fernseher). Eine Auswahl,
 * die lügt, ist schlimmer als keine.
 *
 * Vorgewählt ist, was der Plan bisher ohnehin gestellt hat: Boxen und
 * Gruppen, keine Fernseher.
 */
export function vorauswahl(boxen: Planbox[]): string[] {
  return boxen.filter((box) => !box.bildschirm).map((box) => box.id);
}

/**
 * Steht diese Box in der Auswahl? (rein, testbar)
 *
 * Die leere Liste heisst beim Hub «alle Lautsprecher» – und ein
 * Fernseher ist keiner (hub/core/lautplan.py: gilt_fuer). Dieselbe
 * Regel muss hier gelten, sonst zeigt der Chip eines Fernsehers sich
 * als ausgewählt, während der Hub ihn gar nicht anfasst.
 */
export function boxAn(
  liste: string[] | undefined,
  id: string,
  bildschirm = false,
): boolean {
  const jetzt = liste ?? [];
  if (jetzt.length > 0) return jetzt.includes(id);
  return !bildschirm;
}

/**
 * Eine Box in die Auswahl nehmen oder herausnehmen (rein, testbar).
 *
 * Bei leerer Liste wird zuerst ausgeschrieben, was gerade gilt, und
 * dann umgeschaltet. Hier stand einmal «der erste Tipp heisst: nur
 * diese» – eine Abkürzung, die man nicht sieht. Seit Fernseher und
 * Gruppen mit in der Liste stehen, ist sie auch falsch: Wer den
 * Fernseher dazunimmt, meint ihn *zusätzlich* und nicht statt aller
 * anderen.
 *
 * Leer werden kann die Auswahl nicht mehr. Ein Plan ohne Box hat keinen
 * Adressaten; wer ihn nicht mehr will, löscht ihn – der Papierkorb
 * steht daneben.
 */
export function boxenUmschalten(
  liste: string[] | undefined,
  id: string,
  gilt_jetzt: string[],
): string[] {
  const jetzt = liste && liste.length > 0 ? liste : gilt_jetzt;
  const naechste = jetzt.includes(id)
    ? jetzt.filter((eintrag) => eintrag !== id)
    : [...jetzt, id];
  return naechste.length > 0 ? naechste : jetzt;
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
