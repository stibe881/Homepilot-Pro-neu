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
}

/** Die Vorgabe, solange der Hub noch nichts geschickt hat. */
export const RUHE_AUS: Ruhezeit = { enabled: false, from: 22, to: 7 };

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
  return `Still von ${uhr(ruhe.from)} bis ${uhr(ruhe.to)} – ${spanne} Stunden.`;
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
