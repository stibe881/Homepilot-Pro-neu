/**
 * Standardartikel mit Takt – der Vorrat, der sich selbst nachbestellt.
 *
 * Kaffee, Waschmittel, Katzenstreu fallen erst auf, wenn die Packung
 * leer ist. Bis jetzt gab es zwei halbe Antworten: Die Standardartikel
 * sind Knöpfe, die nur dem helfen, der ohnehin auf die Liste schaut,
 * und der gelernte Rhythmus («Fehlt vermutlich») schlägt vor, trägt aber
 * nichts ein.
 *
 * Bekommt ein Standardartikel einen Takt, legt der Hub ihn selbst auf
 * die Liste, sobald er dran ist. Die Regeln dazu stehen im Hub
 * (core/vorrat.py); hier steht nur, wie es dasteht und was die Knöpfe
 * tun.
 */

export interface Vorratsartikel {
  text?: unknown;
  /** Abstand in Tagen. Fehlt er, ist es ein blosser Knopf wie bisher. */
  days?: unknown;
  /** Wann zuletzt abgehakt – als Sekunden, wie der Hub sie führt. */
  last?: unknown;
}

/** Grenzen wie im Hub (core/vorrat.py) – beide müssen dasselbe zulassen. */
export const MIN_TAGE = 1;
export const MAX_TAGE = 180;

/**
 * Die Takte zum Antippen.
 *
 * Fünf Knöpfe statt eines Zahlenfelds: Ein Vorrat wird nach Wochen und
 * Monaten gedacht, nicht nach Tagen. Wer es genauer will, verstellt mit
 * plus und minus.
 */
export const TAKTE: { tage: number; label: string }[] = [
  { tage: 7, label: 'wöchentlich' },
  { tage: 14, label: 'alle 2 Wochen' },
  { tage: 30, label: 'monatlich' },
  { tage: 60, label: 'alle 2 Monate' },
  { tage: 90, label: 'alle 3 Monate' },
];

/** Der eingestellte Abstand – oder nichts (rein, testbar). */
export function takt(artikel: Vorratsartikel | null | undefined): number | null {
  const tage = Math.round(Number(artikel?.days));
  if (!Number.isFinite(tage) || tage < MIN_TAGE || tage > MAX_TAGE) return null;
  return tage;
}

/** «monatlich» oder «alle 21 Tage» (rein, testbar). */
export function taktLabel(tage: number): string {
  return TAKTE.find((eintrag) => eintrag.tage === tage)?.label ?? `alle ${tage} Tage`;
}

/**
 * Wann der Artikel das nächste Mal auf die Liste gehört (rein, testbar).
 *
 * Ohne bekannten Einkauf: sofort. Dieselbe Regel wie im Hub – wer einen
 * Takt einstellt, will nicht erst einen Durchgang lang zusehen.
 */
export function naechster(
  artikel: Vorratsartikel,
  jetzt: number
): number | null {
  const tage = takt(artikel);
  if (tage === null) return null;
  const zuletzt = Number(artikel.last) || 0;
  return zuletzt ? zuletzt * 1000 + tage * 86_400_000 : jetzt;
}

/** «Monatlich · in 4 Tagen» (rein, testbar). */
export function vorratSatz(artikel: Vorratsartikel, jetzt: number): string | null {
  const tage = takt(artikel);
  const wann = naechster(artikel, jetzt);
  if (tage === null || wann === null) return null;
  const label = taktLabel(tage);
  const gross = label.charAt(0).toUpperCase() + label.slice(1);
  if (wann <= jetzt) return `${gross} · jetzt fällig`;
  const offen = Math.floor((wann - jetzt) / 86_400_000);
  if (offen <= 0) return `${gross} · heute`;
  if (offen === 1) return `${gross} · morgen`;
  return `${gross} · in ${offen} Tagen`;
}

/**
 * Was beim Antippen eines Takt-Knopfs gespeichert wird (rein, testbar).
 *
 * Ein zweites Antippen desselben Takts hebt ihn auf – sonst käme man aus
 * einem einmal gesetzten Takt nicht mehr heraus, ohne den Artikel zu
 * löschen.
 */
export function naechsteWahl(
  artikel: Vorratsartikel,
  tage: number
): number | null {
  return takt(artikel) === tage ? null : tage;
}

/** Einen Schritt feiner stellen, in den Grenzen (rein, testbar). */
export function schritt(artikel: Vorratsartikel, richtung: 1 | -1): number {
  const jetzt = takt(artikel) ?? 7;
  return Math.max(MIN_TAGE, Math.min(MAX_TAGE, jetzt + richtung));
}
