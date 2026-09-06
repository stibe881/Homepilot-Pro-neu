/**
 * Ämtli-Sterne: Was ein Kind diese Woche geschafft hat (Punkt 260).
 *
 * Punkte gibt es schon (Prämien), und die Strähne gehört dem Ämtli.
 * Was fehlte, war die Sicht des Kindes: «Wie viele Sterne habe ich
 * diese Woche - und was gibt es, wenn ich mein Ziel schaffe?» Ein
 * Stern ist bewusst ein erledigtes Ämtli, nicht eine Punktzahl:
 * Fünfjährige zählen Sterne, keine Kontostände - und ein Ämtli ohne
 * Punkte soll genauso zählen wie eines mit.
 *
 * Gezählt wird aus dem kleinen Protokoll am Ämtli selbst (`stars_log`,
 * geschrieben beim Abhaken): `last_by`/`last_done` halten nur die
 * letzte Erledigung fest, und aus den Prämien-Buchungen liesse sich
 * ein Ämtli ohne Punkte nie herauslesen. Das Protokoll wird beim
 * Schreiben gestutzt - nichts, was jemand aufräumen müsste.
 *
 * Die Woche beginnt am Montag (montagVon in lib/familie.ts) - dieselbe
 * Regel wie überall sonst im Haus.
 *
 * Kein Zwang: Ohne gesetztes Wochenziel (sternZiel → null) zeigt keine
 * Seite Sterne an. Ziel und Belohnung stehen am Mitglieds-Eintrag in
 * den Familienlisten (`stars_goal`, `stars_reward`) - beim Hub, damit
 * das Wandpanel dieselben sieht wie das Telefon.
 */

import { montagVon } from './familie';

/** Ein Eintrag einer Familienliste, so offen wie der Hub ihn speichert. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Eintrag = Record<string, any>;

/** Ein Stern: wer ihn wann verdient hat (ISO-Tag). */
export interface Stern {
  by: string;
  on: string;
}

/** So lange bleibt ein Stern im Protokoll stehen. Zwei Monate reichen
 *  für jede Wochen-Ansicht; alles Ältere zählt nirgends mehr. */
export const STERN_TAGE = 70;

/** Der Zeitpunkt eines ISO-Tags, auf Mittag gelegt (rein, testbar).
 *
 *  Mittag statt Mitternacht, wie in lib/straehne.ts: So kippt kein Tag
 *  über eine Zeitzonengrenze in die falsche Woche. */
function tagZeit(iso: unknown): number | null {
  const text = String(iso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const wann = new Date(`${text}T12:00:00`).getTime();
  return Number.isFinite(wann) ? wann : null;
}

/** Das Stern-Protokoll eines Ämtli - robust gegen alles, was da stehen
 *  kann (rein, testbar). */
export function protokollVon(chore: Eintrag | null | undefined): Stern[] {
  const roh = chore?.stars_log;
  if (!Array.isArray(roh)) return [];
  return roh
    .map((zeile) => ({
      by: String(zeile?.by ?? '').trim(),
      on: String(zeile?.on ?? '').slice(0, 10),
    }))
    .filter((stern) => stern.by.length > 0 && tagZeit(stern.on) !== null);
}

/**
 * Das Protokoll nach diesem Abhaken (rein, testbar).
 *
 * Der Stern gehört `chore.member` - der Person, die beim Abhaken dran
 * war (dieselbe, die die Punkte bekommt). Ohne Zuteilung gibt es
 * keinen Stern: Niemand weiss, wer es war.
 *
 * Zweimal am selben Tag abgehakt (vertippt, zurückgenommen, wieder
 * gedrückt) gibt keinen zweiten Stern - sonst liesse sich das
 * Wochenziel mit Tippen statt Putzen erreichen. Und beim Schreiben
 * fliegt hinaus, was älter als STERN_TAGE ist.
 */
export function sternProtokoll(chore: Eintrag, heuteIso: string): Stern[] {
  const bisher = protokollVon(chore);
  const by = String(chore?.member ?? '').trim();
  const on = String(heuteIso ?? '').slice(0, 10);
  const heute = tagZeit(on);
  if (!by || heute === null) return bisher;
  const frisch = bisher.filter((stern) => {
    const wann = tagZeit(stern.on);
    return wann !== null && heute - wann < STERN_TAGE * 86400000;
  });
  if (frisch.some((stern) => stern.by === by && stern.on === on)) return frisch;
  return [...frisch, { by, on }];
}

/**
 * Die Sterne einer Person in der Woche von `jetzt` (rein, testbar).
 *
 * Die Woche beginnt am Montag und endet vor dem nächsten - dieselbe
 * Regel wie bei der Wochenvorschau des Hubs.
 */
export function wochenSterne(
  chores: Eintrag[] | null | undefined,
  name: string,
  jetzt: Date
): number {
  const gesucht = String(name ?? '').trim();
  if (!gesucht) return 0;
  const von = montagVon(jetzt).getTime();
  const bis = von + 7 * 86400000;
  let zahl = 0;
  for (const chore of chores ?? []) {
    for (const stern of protokollVon(chore)) {
      if (stern.by !== gesucht) continue;
      const wann = tagZeit(stern.on);
      if (wann !== null && wann >= von && wann < bis) zahl += 1;
    }
  }
  return zahl;
}

/** Wochenziel und Belohnung eines Kindes. */
export interface SternZiel {
  goal: number;
  /** Was es beim Ziel gibt («Kino») - darf leer sein. */
  reward: string;
}

/**
 * Das Ziel aus einem Mitglieds-Eintrag (rein, testbar).
 *
 * `null` heisst: kein Ziel gesetzt - dann zeigt keine Seite Sterne.
 * Das ist die Leerzustand-Philosophie, kein Versehen: Eine Familie,
 * die keine Sterne will, soll nirgends «0 von 0» lesen.
 */
export function sternZiel(eintrag: Eintrag | null | undefined): SternZiel | null {
  const goal = Math.round(Number(eintrag?.stars_goal));
  if (!Number.isFinite(goal) || goal <= 0) return null;
  return { goal, reward: String(eintrag?.stars_reward ?? '').trim() };
}

/** «7 von 10 Sternen» (rein, testbar). */
export function sternSatz(sterne: number, goal: number): string {
  return `${sterne} von ${goal} Sternen`;
}

/**
 * Die Zeile unter der Sternenreihe (rein, testbar).
 *
 * Vor dem Ziel nennt sie den Handel («10 Sterne = Kino»), am Ziel den
 * Erfolg. Ohne Belohnungstext gibt es vor dem Ziel nichts zu sagen -
 * die Zählung steht ja schon da.
 */
export function sternHinweis(sterne: number, ziel: SternZiel): string | null {
  if (sterne >= ziel.goal) {
    return ziel.reward ? `Geschafft! ${ziel.reward} ist verdient.` : 'Wochenziel geschafft!';
  }
  return ziel.reward ? `${ziel.goal} Sterne = ${ziel.reward}` : null;
}

/**
 * Die Sternenreihe zum Zeichnen: voll oder leer, je Ziel-Stern
 * (rein, testbar).
 *
 * `null`, wenn das Ziel zu gross für eine Reihe ist - dann bleibt der
 * Satz («17 von 40 Sternen»), statt dass vierzig Symbole die Karte
 * sprengen. Mehr Sterne als das Ziel bleiben eine volle Reihe: Die
 * Zusatzleistung steht im Satz, nicht in einer wachsenden Reihe.
 */
export function sternReihe(
  sterne: number,
  goal: number,
  hoechstens = 20
): boolean[] | null {
  if (goal > hoechstens) return null;
  return Array.from({ length: goal }, (_, stelle) => stelle < sterne);
}
