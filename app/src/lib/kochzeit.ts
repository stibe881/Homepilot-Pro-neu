/**
 * Zeitangaben in einem Kochschritt erkennen.
 *
 * «20 Minuten backen» und die Küchenuhr des Hubs wussten nichts
 * voneinander – dabei sind beide längst da. Diese Funktion liest die
 * Dauer aus dem Schritttext; der Kochmodus macht daraus einen Knopf
 * «Uhr stellen», und die Durchsage kommt dann auch im Wohnzimmer an.
 */

const MUSTER =
  /(\d+(?:[.,]\d+)?)\s*(min(?:\.|uten?)?|std(?:\.|unden?)?|stunden?|h\b)/gi;

// «20-25 Min» ist EINE Uhr, nicht zwei - und zwar die kürzere: Man
// schaut lieber einmal zu früh in den Ofen als einmal zu spät. Der
// Bereich wird vor dem Suchen auf seine untere Grenze eingedampft.
const BEREICH =
  /(\d+(?:[.,]\d+)?)\s*(?:–|—|-|‑|bis)\s*(\d+(?:[.,]\d+)?)(\s*(?:min(?:\.|uten?)?|std(?:\.|unden?)?|stunden?|h)\b)/gi;

// Zeiten, die als Wort dastehen: «eine halbe Stunde köcheln» ist eine
// 30-Minuten-Uhr, auch wenn keine Ziffer im Text steht. Ersetzt wird zu
// Text («30 Min»), damit danach dasselbe MUSTER greift wie überall.
const WORTZEITEN: [RegExp, string][] = [
  [/\b(?:einer?\s+)?dreiviertel\s*stunde\b/gi, '45 Min'],
  [/\b(?:einer?\s+)?halben?\s+stunde\b/gi, '30 Min'],
  [/\b(?:einer?\s+)?viertel\s*stunde\b/gi, '15 Min'],
];

// «1½ Std» - das Bruchzeichen steht in abgetippten Rezepten häufig.
// Erst die Form mit Ziffer, dann das alleinstehende «½ Std»: Nach dem
// ersten Ersatz steht vor keinem ½ mehr eine Zahl (kein Lookbehind -
// das versteht nicht jede RegExp-Engine der App).
const HALB = /(\d+)\s*½\s*(?:std(?:\.|unden?)?|stunden?|h)\b/gi;
const HALB_ALLEIN = /½\s*(?:std(?:\.|unden?)?|stunden?|h)\b/gi;

/** So lange kann die Küchenuhr des Hubs höchstens (timers.MAX_MINUTES).
 *  «4 Stunden marinieren» bekommt darum keinen Knopf: Der Hub wiese ihn
 *  ab, und ein Knopf, der still scheitert, ist schlimmer als keiner. */
export const UHR_MAX = 180;

function vorverdaut(text: string): string {
  let klar = text.replace(BEREICH, '$1$3');
  for (const [muster, ersatz] of WORTZEITEN) klar = klar.replace(muster, ersatz);
  klar = klar.replace(HALB, (_, zahl: string) => `${Number(zahl) * 60 + 30} Min`);
  return klar.replace(HALB_ALLEIN, '30 Min');
}

function alsMinuten(zahlText: string, einheitText: string): number | null {
  const zahl = Number(zahlText.replace(',', '.'));
  if (!Number.isFinite(zahl) || zahl <= 0) return null;
  const einheit = einheitText.toLowerCase();
  const minuten = einheit.startsWith('h') || einheit.startsWith('st') ? zahl * 60 : zahl;
  // Über einen Tag ist keine Küchenuhr mehr, sondern ein Missverständnis
  // («500 g» soll nie als 500 Minuten durchgehen – g fängt das Muster
  // nicht, aber Zahlendreher gibt es trotzdem).
  if (minuten > 24 * 60) return null;
  return Math.round(minuten);
}

/** Alle Zeitangaben im Text, in Minuten (rein, testbar). Punkt 143 der
 *  Werkbank: «10 Minuten köcheln, dann 20 Minuten ziehen» sind zwei
 *  Uhren, nicht eine. Doppelte fallen weg – zweimal «5 Min» im selben
 *  Schritt ist eine Uhr. */
export function zeitenImText(text: string): number[] {
  const gefunden: number[] = [];
  const klar = vorverdaut(text);
  // Ein /g-Muster trägt seinen Suchstand mit - vor jedem Lauf zurück auf
  // Anfang, sonst hängt das Ergebnis vom vorherigen Aufruf ab.
  MUSTER.lastIndex = 0;
  for (const treffer of klar.matchAll(MUSTER)) {
    const minuten = alsMinuten(treffer[1], treffer[2]);
    if (minuten !== null && minuten <= UHR_MAX && !gefunden.includes(minuten)) {
      gefunden.push(minuten);
    }
  }
  return gefunden;
}

/** Die erste Zeitangabe im Text, in Minuten (rein, testbar). `null`,
 *  wenn keine da ist – lieber kein Knopf als einer, der rät. */
export function minutenImText(text: string): number | null {
  return zeitenImText(text)[0] ?? null;
}
