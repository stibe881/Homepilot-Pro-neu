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
  // Ein /g-Muster trägt seinen Suchstand mit - vor jedem Lauf zurück auf
  // Anfang, sonst hängt das Ergebnis vom vorherigen Aufruf ab.
  MUSTER.lastIndex = 0;
  for (const treffer of text.matchAll(MUSTER)) {
    const minuten = alsMinuten(treffer[1], treffer[2]);
    if (minuten !== null && !gefunden.includes(minuten)) gefunden.push(minuten);
  }
  return gefunden;
}

/** Die erste Zeitangabe im Text, in Minuten (rein, testbar). `null`,
 *  wenn keine da ist – lieber kein Knopf als einer, der rät. */
export function minutenImText(text: string): number | null {
  return zeitenImText(text)[0] ?? null;
}
