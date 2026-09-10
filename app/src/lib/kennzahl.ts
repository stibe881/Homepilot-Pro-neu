/**
 * Die Zahl führt, die Einheit folgt.
 *
 * Überall im Haus stehen Messwerte: 21,5 °C, 63 %, 1240 W, 08:15. Sie
 * werden heute als ein Stück Text gesetzt – «21.5 °C» in einer Grösse,
 * einer Stärke, einer Farbe. Damit ist die Zahl, die man sucht, gleich
 * wichtig wie das Zeichen dahinter, das man längst kennt. Man liest die
 * Zeile, statt die Zahl zu sehen.
 *
 * Die Regel dagegen ist alt und einfach: Die Zahl gross, die Einheit
 * klein und leiser daneben, die Beschriftung darunter. Dann findet das
 * Auge in einer Reihe von Kacheln die Zahlen, ohne zu lesen.
 *
 * Dazu ein zweites, das man nur merkt, wenn es fehlt: **Ziffern mit
 * fester Breite** (`tabular-nums`). Ohne sie ist die «1» schmaler als
 * die «8», und eine Temperatur, die von 19.8 auf 21.1 wechselt, ruckt
 * beim Wechsel seitwärts. Bei einer Uhr, die jede Sekunde zählt, wackelt
 * die halbe Kopfzeile. Fünf Stellen im Haus hatten das von Hand gesetzt,
 * die übrigen nicht.
 *
 * Hier steht das Zerlegen; wie es aussieht, steht in
 * components/Kennzahl.tsx.
 */

export interface Zerlegt {
  /** Was gross dasteht - ohne Einheit. */
  zahl: string;
  /** Was klein danebensteht. Leer, wenn es keine gibt. */
  einheit: string;
}

/**
 * Einheiten, die ohne Zwischenraum an der Zahl kleben.
 *
 * Im Deutschen steht zwischen Zahl und Einheit ein schmaler
 * Zwischenraum - ausser beim Prozent- und beim Gradzeichen, wenn kein
 * Einheitenzeichen folgt. «21 °C» mit Abstand, «63%» ohne. Genau so
 * steht es im Duden, und genau so liest es sich richtig.
 */
const ANGEKLEBT = ['%', '°'];

/**
 * Einen Messwert in Zahl und Einheit zerlegen (rein, testbar).
 *
 * Was nicht wie ein Messwert aussieht, kommt unzerlegt zurück - dann
 * steht es einfach ganz da. Lieber ein Wert ohne die feine Trennung als
 * einer, der an der falschen Stelle auseinandergerissen wird («Wohn»
 * gross, «zimmer» klein).
 */
export function zerlege(text: string): Zerlegt {
  const roh = String(text ?? '').trim();
  // Zahl am Anfang: Vorzeichen, Ziffern, ein Komma oder Punkt, Ziffern.
  // Und Uhrzeiten, die aus zwei durch einen Doppelpunkt getrennten
  // Zahlen bestehen - «08:15» ist eine Zahl und keine Zahl mit Einheit.
  const treffer = roh.match(/^(-?\d+(?:[.,]\d+)?(?::\d+)*)\s*(.*)$/);
  if (!treffer) return { zahl: roh, einheit: '' };
  return { zahl: treffer[1], einheit: treffer[2].trim() };
}

/**
 * Steht die Einheit ohne Zwischenraum? (rein, testbar)
 *
 * Nur beim nackten Prozent- oder Gradzeichen: «63%», aber «21 °C».
 */
export function angeklebt(einheit: string): boolean {
  return ANGEKLEBT.includes(einheit.trim());
}
