/**
 * Datums- und Zeitangaben – die Sprache steht an genau einer Stelle.
 *
 * Vorher stand «de-CH» an 36 Stellen quer durch die App, jede mit ihrer
 * eigenen Options-Kombination: mal «19. Aug., 07:02», mal «19.08.2026,
 * 07», mal mit Jahr, mal ohne. Wer die Darstellung ändern oder eine
 * zweite Sprache anbieten wollte, hätte alle 36 finden müssen.
 *
 * Deshalb hier eine Handvoll benannter Formate (alle rein, testbar).
 * Sie nehmen Date oder Millisekunden – wer Unix-Sekunden hat,
 * multipliziert mit 1000, wie überall in JavaScript.
 *
 * Für ISO-Zeitstempel vom Hub (mit UTC-Tücke) gibt es weiterhin
 * lib/zeit.ts – das hier sind die Anzeige-Formate für fertige Zeitpunkte.
 */

const LOCALE = 'de-CH';

type Wann = Date | number;

function als(wann: Wann): Date {
  return wann instanceof Date ? wann : new Date(wann);
}

/** «07:02» – die Uhrzeit allein. */
export function uhr(wann: Wann): string {
  return als(wann).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

/** «19. Aug., 07:02» – Zeitpunkt mit Tag, fürs laufende Jahr. */
export function datumUhr(wann: Wann): string {
  return als(wann).toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** «19. Aug.» – das Datum allein, knapp. */
export function datumKurz(wann: Wann): string {
  return als(wann).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
}

/** «Mi» – der Wochentag, ohne den Abkürzungspunkt («Mi.» liest sich in
 *  einer Chip-Zeile wie ein Satzende). */
export function wochentag(wann: Wann): string {
  return als(wann).toLocaleDateString(LOCALE, { weekday: 'short' }).replace('.', '');
}

/** «Mi., 07:02» – Wochentag und Uhrzeit, für die nächsten Tage. */
export function wochentagUhr(wann: Wann): string {
  return als(wann).toLocaleString(LOCALE, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** «Mi., 19. Aug.» – Wochentag und knappes Datum, etwa für Termine. */
export function wochentagDatumKurz(wann: Wann): string {
  return als(wann).toLocaleDateString(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** «Mittwoch, 19. August» – ausgeschrieben, für Detailansichten. */
export function wochentagDatum(wann: Wann): string {
  return als(wann).toLocaleDateString(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** «Mi., 19.08.2026» – vollständig mit Jahr, für Datums-Wähler. */
export function datumVoll(wann: Wann): string {
  return als(wann).toLocaleDateString(LOCALE, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** «August 2026» – für Monatsüberschriften (Kalender). */
export function monatJahr(wann: Wann): string {
  return als(wann).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
}

/** «45 min», «1 h», «2 h 5 min» – eine Dauer in Minuten, ausgesprochen.
 *
 * Über einer Stunde rechnet «noch 233 min» sonst jeder selbst nach, und
 * meistens falsch. Ohne führende «0 h» und ohne baumelndes «0 min»
 * (rein, testbar). */
export function dauerText(minuten: number): string {
  const gesamt = Math.max(0, Math.round(Number(minuten) || 0));
  const stunden = Math.floor(gesamt / 60);
  const rest = gesamt % 60;
  if (stunden === 0) return `${rest} min`;
  if (rest === 0) return `${stunden} h`;
  return `${stunden} h ${rest} min`;
}
