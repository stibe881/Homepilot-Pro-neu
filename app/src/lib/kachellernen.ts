/**
 * Die Kachel-Reihenfolge aus dem Bedienen lernen.
 *
 * «Nach Tageszeit sortieren» gibt es – aber mit einer festen Meinung
 * darüber, was morgens wichtig ist (lib/tageszeit.ts: erst Storen, dann
 * Schalter, dann Musik). Die Meinung stammt aus einem Haushalt, und im
 * nächsten stimmt sie nicht: Wer morgens als Erstes den Kaffee anstellt
 * und die Storen erst nach dem Duschen hochfährt, bekommt die Storen
 * trotzdem zuoberst.
 *
 * Dabei sagt es einem die Hand von selbst. Dieselbe Mechanik wie beim
 * Einkaufszettel, der die Ladenreihenfolge lernt (lib/ladenlernen.ts):
 * Es wird mitgezählt, was um sieben Uhr bedient wird und was um
 * zweiundzwanzig, und danach geordnet.
 *
 * Drei Regeln, die das Lernen erträglich machen:
 *
 * - **Je Tagesabschnitt getrennt.** Was abends zuoberst gehört, gehört
 *   morgens nicht dorthin – sonst wäre es dasselbe wie «nach Nutzung»
 *   und die Tageszeit hätte nichts zu sagen.
 * - **Es verblasst.** Ein Wert halbiert sich alle zwei Wochen, wie bei
 *   den Räumen (lib/raumnutzung.ts). Ohne das stünde die Heizung vom
 *   letzten Winter im Juli noch oben – Gewohnheit ist, was man *zurzeit*
 *   tut.
 * - **Die feste Liste bleibt der Boden.** Gelernt wird nur, was oft
 *   genug vorkam; alles Übrige behält die Reihenfolge, die es ohnehin
 *   hatte. Aus einem einzigen Griff zu «lernen» hiesse, jeden Zufall
 *   für die Regel zu halten.
 *
 * Reine Funktionen ohne React: Ob aus vier Abenden «Stehlampe vor
 * Decke» folgt, ist genau die Sorte Entscheidung, die man nur prüfen
 * kann, wenn sie für sich steht.
 */
import { Abschnitt, Tageszeit, nachTageszeit } from './tageszeit';

/** Halbwertszeit der Zählung – dieselbe wie bei den Räumen. */
export const HALBWERT_MS = 14 * 24 * 3600 * 1000;

/**
 * So oft muss ein Gerät in diesem Abschnitt bedient worden sein, bevor
 * seine gelernte Stelle gilt. Drei: Zweimal ist ein Zufall, dreimal ist
 * eine Gewohnheit – und weil die Werte verblassen, heisst «drei» hier
 * ohnehin «drei in den letzten Wochen».
 */
export const MIN_WERT = 3;

/** Wie oft ein Gerät in einem Tagesabschnitt bedient wurde. */
export interface Kachelzaehler {
  [schluessel: string]: { wert: number; at: number };
}

/** Zähler-Schlüssel aus Gerät und Abschnitt (rein, testbar). */
export function schluessel(entityId: string, abschnitt: Tageszeit): string {
  return `${abschnitt}|${entityId}`;
}

/** Den verblassten Wert eines Eintrags lesen (rein, testbar). */
export function verblasst(
  eintrag: { wert: number; at: number } | undefined,
  jetzt: number
): number {
  if (!eintrag || !Number.isFinite(eintrag.wert)) return 0;
  const alter = Math.max(0, jetzt - eintrag.at);
  return eintrag.wert * Math.pow(0.5, alter / HALBWERT_MS);
}

/** Eine Bedienung mitzählen (rein, testbar). */
export function merken(
  zaehler: Kachelzaehler,
  entityId: string,
  abschnitt: Tageszeit,
  jetzt: number
): Kachelzaehler {
  if (!entityId) return zaehler;
  const key = schluessel(entityId, abschnitt);
  return { ...zaehler, [key]: { wert: verblasst(zaehler[key], jetzt) + 1, at: jetzt } };
}

/**
 * Die Geräte, deren Stelle gelernt ist – die meistbedienten zuerst
 * (rein, testbar).
 *
 * Nur die über der Schwelle: Ein Gerät, das man in diesem Abschnitt
 * einmal angefasst hat, sagt nichts.
 */
export function gelernt(
  zaehler: Kachelzaehler,
  abschnitt: Tageszeit,
  jetzt: number
): string[] {
  const vorsatz = `${abschnitt}|`;
  return Object.entries(zaehler)
    .filter(([key]) => key.startsWith(vorsatz))
    .map(([key, eintrag]) => ({
      id: key.slice(vorsatz.length),
      wert: verblasst(eintrag, jetzt),
    }))
    .filter((eintrag) => eintrag.wert >= MIN_WERT)
    .sort((a, b) => b.wert - a.wert || a.id.localeCompare(b.id))
    .map((eintrag) => eintrag.id);
}

/**
 * Die Kacheln ordnen: erst das Gelernte, dann die feste Liste (rein,
 * testbar).
 *
 * Der Boden bleibt `nachTageszeit`. Was gelernt ist, wird daraus nach
 * vorn gezogen; alles Übrige behält seine Abfolge. So bringt der erste
 * gelernte Eintrag die Seite nicht durcheinander, sondern verschiebt
 * genau eine Kachel.
 *
 * Bei Gleichstand entscheidet die Ausgangsreihenfolge – zwei Geräte,
 * die man gleich oft anfasst, sollen nicht bei jedem Öffnen die Plätze
 * tauschen.
 */
export function nachGewohnheit<T extends { id: string; kind: string }>(
  kacheln: T[],
  abschnitt: Abschnitt,
  zaehler: Kachelzaehler,
  jetzt: number
): T[] {
  const basis = nachTageszeit(kacheln, abschnitt);
  const rang = new Map(
    gelernt(zaehler, abschnitt.key, jetzt).map((id, index) => [id, index])
  );
  if (rang.size === 0) return basis;
  return basis
    .map((kachel, index) => ({ kachel, index }))
    .sort((a, b) => {
      const ra = rang.get(a.kachel.id) ?? Infinity;
      const rb = rang.get(b.kachel.id) ?? Infinity;
      return ra !== rb ? ra - rb : a.index - b.index;
    })
    .map((eintrag) => eintrag.kachel);
}

/**
 * Was oben auf der Seite steht, wenn gelernt statt gesetzt wird (rein,
 * testbar).
 *
 * Der Hinweis soll den Unterschied sagen: «Abend: Licht, Musik, Storen
 * zuerst» ist eine Setzung, «Abend: nach deiner Gewohnheit» ist etwas
 * anderes. Ohne das hielte man die umsortierte Seite für einen Fehler.
 */
export function hinweisGelernt(abschnitt: Abschnitt): string {
  return `${abschnitt.label}: nach deiner Gewohnheit`;
}
