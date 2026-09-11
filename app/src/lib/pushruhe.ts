/**
 * Ruhezeit und Stillstellen – die Sätze dazu.
 *
 * Der Hub entscheidet, was zurückgehalten wird (hub/core/pushruhe.py);
 * hier steht nur, wie man es liest. Getrennt von der Karte, weil
 * «22 bis 7» auf drei verschiedene Weisen falsch formuliert werden kann
 * und man das prüfen können soll, ohne einen Bildschirm zu bauen.
 */

/** Wie der Hub die Ruhezeit einer Person führt. */
export interface Ruhezeit {
  enabled: boolean;
  from: number;
  to: number;
  /** An welchen Wochentagen sie gilt (0 = Montag). Leer heisst «alle» –
   *  so war sie, bevor es die Tage gab (Punkt 479 der Werkbank).
   *  Samstagmorgen ist nicht Dienstagmorgen, und die Ferienwoche keine
   *  Arbeitswoche. */
  days?: number[];
}

/** Die Vorgabe, solange der Hub noch nichts geschickt hat. */
export const RUHE_AUS: Ruhezeit = { enabled: false, from: 22, to: 7, days: [] };

/** Die Wochentage, wie sie auf den Knöpfen stehen – 0 = Montag, wie im
 *  Hub und wie in den Abläufen. */
export const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/**
 * Die Wochentage einer Ruhezeit ordnen (rein, testbar).
 *
 * Alle sieben werden zu leer, weil das dasselbe ist: Wer alle anklickt,
 * meint «egal», und zwei Schreibweisen für einen Zustand laufen
 * auseinander. Dieselbe Regel wie im Hub (core/pushruhe.py).
 */
export function tageOrdnen(tage: number[] | undefined): number[] {
  const gewaehlt = [...new Set((tage ?? []).filter((tag) => tag >= 0 && tag <= 6))];
  return gewaehlt.length === 7 ? [] : gewaehlt.sort((a, b) => a - b);
}

/** «Mo–Fr», «Sa, So» oder «jeden Tag» (rein, testbar). */
export function tageSatz(tage: number[] | undefined): string {
  const gewaehlt = tageOrdnen(tage);
  if (gewaehlt.length === 0) return 'jeden Tag';
  // Eine zusammenhängende Woche als Spanne: «Mo–Fr» liest sich in einem
  // Blick, «Mo, Di, Mi, Do, Fr» muss man zählen.
  const luecke = gewaehlt.some((tag, index) => index > 0 && tag !== gewaehlt[index - 1] + 1);
  if (!luecke && gewaehlt.length > 2) {
    return `${WOCHENTAGE[gewaehlt[0]]}–${WOCHENTAGE[gewaehlt[gewaehlt.length - 1]]}`;
  }
  return gewaehlt.map((tag) => WOCHENTAGE[tag]).join(', ');
}

/** Zur Auswahl stehende Stunden – ganze, weil man seine Nacht so denkt. */
export const STUNDEN = Array.from({ length: 24 }, (_, n) => n);

/** «22 Uhr» statt «22» (rein, testbar). */
export function uhr(stunde: number): string {
  return `${((stunde % 24) + 24) % 24} Uhr`;
}

/**
 * Was unter der Ruhezeit steht (rein, testbar).
 *
 * Bewusst mit der Zahl der Stunden dahinter: «22 bis 7» liest sich
 * harmlos, «neun Stunden» sagt einem, wie gross das Loch ist, in dem
 * die Batteriewarnung verschwindet.
 */
export function ruhesatz(ruhe: Ruhezeit): string {
  if (!ruhe.enabled) return 'Aus – alles kommt, wann es kommt.';
  if (ruhe.from === ruhe.to) return 'Aus – Anfang und Ende sind gleich.';
  const spanne = (ruhe.to - ruhe.from + 24) % 24;
  const tage = tageOrdnen(ruhe.days);
  // Die Tage nur, wenn sie etwas einschränken: «jeden Tag» dahinter
  // wäre eine Zeile, die nichts sagt.
  const wann = tage.length > 0 ? ` (${tageSatz(tage)})` : '';
  return `Still von ${uhr(ruhe.from)} bis ${uhr(ruhe.to)}${wann} – ${spanne} Stunden.`;
}

/**
 * Wie lange eine Kategorie noch stillsteht (rein, testbar).
 *
 * `null`, wenn sie es nicht tut – dann steht da nichts, statt «noch
 * 0 Minuten still».
 */
export function stillsatz(bis: number | null | undefined, jetzt: number): string | null {
  if (!bis || bis <= jetzt) return null;
  const minuten = Math.round((bis - jetzt) / 60);
  if (minuten < 60) return `noch ${minuten} Min still`;
  return `noch ${Math.round(minuten / 60)} Std still`;
}

/**
 * Warum eine Meldung nicht gebrummt hat (rein, testbar).
 *
 * Der Hub schickt den Grund in seinen eigenen Worten («Ruhezeit»,
 * «stillgestellt», «Tagesdeckel erreicht»). Hier wird ein Satz daraus –
 * ein nacktes Wort neben einer Uhrzeit liest sich wie ein Fehlercode.
 */
export function verpasstsatz(grund: string | null | undefined): string {
  if (!grund) return 'Kam nicht durch.';
  if (grund === 'Ruhezeit') return 'Während deiner Ruhezeit – nicht gebrummt.';
  if (grund === 'stillgestellt') return 'Du hattest diese Art stillgestellt.';
  if (grund === 'Tagesdeckel erreicht')
    return 'Heute schon oft genug gemeldet – zurückgehalten.';
  return grund;
}
