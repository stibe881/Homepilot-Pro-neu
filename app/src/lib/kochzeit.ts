/**
 * Zeitangaben in einem Kochschritt erkennen.
 *
 * «20 Minuten backen» und die Küchenuhr des Hubs wussten nichts
 * voneinander – dabei sind beide längst da. Diese Funktion liest die
 * Dauer aus dem Schritttext; der Kochmodus macht daraus einen Knopf
 * «Uhr stellen», und die Durchsage kommt dann auch im Wohnzimmer an.
 */

const MUSTER =
  /(\d+(?:[.,]\d+)?)\s*(min(?:\.|uten?)?|std(?:\.|unden?)?|stunden?|h\b)/i;

/** Die erste Zeitangabe im Text, in Minuten (rein, testbar). `null`,
 *  wenn keine da ist – lieber kein Knopf als einer, der rät. */
export function minutenImText(text: string): number | null {
  const treffer = MUSTER.exec(text);
  if (!treffer) return null;
  const zahl = Number(treffer[1].replace(',', '.'));
  if (!Number.isFinite(zahl) || zahl <= 0) return null;
  const einheit = treffer[2].toLowerCase();
  const minuten = einheit.startsWith('h') || einheit.startsWith('st') ? zahl * 60 : zahl;
  // Über einen Tag ist keine Küchenuhr mehr, sondern ein Missverständnis
  // («500 g» soll nie als 500 Minuten durchgehen – g fängt das Muster
  // nicht, aber Zahlendreher gibt es trotzdem).
  if (minuten > 24 * 60) return null;
  return Math.round(minuten);
}
