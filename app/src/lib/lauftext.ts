/**
 * Lauftext: Was nicht auf die Zeile passt, wandert einmal durch.
 *
 * Der Anlass steht in der Begrüssungskarte: «08:50 Chrabbelzwergli Bine
 * + Aline / finja hüten 9.15, Si…» – abgeschnitten genau dort, wo der
 * zweite Termin des Tages anfängt. Drei Pünktchen sind keine Auskunft;
 * wer wissen will, was um 9.15 ansteht, muss das Terminfenster öffnen,
 * um eine Zeile zu lesen, die schon dasteht.
 *
 * Umbrechen wäre die andere Möglichkeit gewesen. Sie fällt aus: Die
 * Karte hat eine feste Höhe im Blick des Bewohners – Uhr, Termin,
 * Geburtstag, Warnung, Chips –, und eine Zeile, die je nach Tag mal
 * eine und mal drei Zeilen hoch ist, verschiebt alles darunter.
 *
 * Also wandern. Die Zeiten stammen aus dem Lesen und nicht aus dem
 * Gefühl: drei Sekunden Ruhe am Anfang, weil man beim Blick aufs
 * Telefon zuerst die Uhr liest und erst dann die Zeile darunter; zwei
 * Sekunden am Ende, damit der letzte Teil auch dann noch dasteht, wenn
 * man ihn erst beim Anhalten gefunden hat.
 */

/** So lange steht der Anfang still, bevor es losgeht. */
export const HALT_START = 3000;

/** So lange steht das Ende still, bevor es von vorne anfängt. */
export const HALT_ENDE = 2000;

/** Wanderung in Punkten je Sekunde – Lesetempo, nicht Laufband. */
export const TEMPO = 45;

/**
 * Kürzer wandert es nie.
 *
 * Ein Überhang von zehn Punkten wäre in einer Fünftelsekunde durch –
 * das sieht aus wie ein Zucken und nicht wie ein Lauftext.
 */
export const WANDER_MIN = 700;

/**
 * Unter so viel Überhang bleibt alles stehen.
 *
 * Ein Punkt Unterschied entsteht schon aus dem Runden der Messung. Ein
 * Text, der um ein Haar zu lang ist, soll nicht wackeln – die drei
 * Pünktchen kosten dann weniger als die Bewegung.
 */
export const SCHWELLE = 4;

export interface LaufPlan {
  /** Muss überhaupt gewandert werden? */
  noetig: boolean;
  /** Wie weit nach links, in Punkten. */
  weite: number;
  /** Wie lange die Wanderung dauert, in Millisekunden. */
  wanderMs: number;
}

const STEHT: LaufPlan = { noetig: false, weite: 0, wanderMs: 0 };

/**
 * Der Fahrplan für eine Zeile (rein, testbar).
 *
 * ``inhalt`` ist die natürliche Breite des Textes, ``kasten`` die
 * Breite, die er bekommt. Solange eines von beiden noch nicht gemessen
 * ist (0 beim ersten Zeichnen), wird nichts behauptet: Ein Lauftext,
 * der losläuft, bevor er weiss, wie breit er ist, springt beim ersten
 * Bild.
 */
export function laufPlan(inhalt: number, kasten: number): LaufPlan {
  if (!Number.isFinite(inhalt) || !Number.isFinite(kasten)) return STEHT;
  if (inhalt <= 0 || kasten <= 0) return STEHT;
  const ueberhang = inhalt - kasten;
  if (ueberhang <= SCHWELLE) return STEHT;
  const weite = Math.round(ueberhang);
  return {
    noetig: true,
    weite,
    wanderMs: Math.max(WANDER_MIN, Math.round((weite / TEMPO) * 1000)),
  };
}

/**
 * Wie lange ein ganzer Umlauf dauert (rein, testbar).
 *
 * Nur zum Nachrechnen und Prüfen – die Bewegung selbst legt Animated
 * als Folge von Warten, Wandern, Warten aneinander.
 */
export function umlaufMs(plan: LaufPlan): number {
  return plan.noetig ? HALT_START + plan.wanderMs + HALT_ENDE : 0;
}
