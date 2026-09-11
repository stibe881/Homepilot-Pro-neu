/**
 * Der Posteingang (Punkt 435): was das Haus für mich zurückgehalten hat.
 *
 * Der Hub führt die Liste (core/pushverlauf.py: verpasst); hier steht
 * nur das Zählen für die Glocke und das Sortieren fürs Blatt.
 */

export interface Meldung {
  title: string;
  body?: string;
  category?: string | null;
  at: number;
  /** Warum sie nicht gebrummt hat - Ruhezeit, stillgestellt, Deckel. */
  held?: string | null;
  verpasst?: boolean;
}

/** Wie viele zurückgehaltene Meldungen seit dem letzten Öffnen dazukamen
 *  (rein, testbar). `gesehenBis` ist der Zeitpunkt des letzten Öffnens
 *  in Unix-Sekunden - 0, wenn noch nie. */
export function ungelesen(verpasst: { at: number }[], gesehenBis: number): number {
  return verpasst.filter((zeile) => Number.isFinite(zeile.at) && zeile.at > gesehenBis).length;
}

/** Die Liste fürs Blatt: erst das Zurückgehaltene, dann der Rest -
 *  beides jüngste zuerst (rein, testbar). */
export function sortiert(meldungen: Meldung[]): { zurueckgehalten: Meldung[]; uebrige: Meldung[] } {
  const nachZeit = [...meldungen].sort((a, b) => b.at - a.at);
  return {
    zurueckgehalten: nachZeit.filter((zeile) => zeile.verpasst),
    uebrige: nachZeit.filter((zeile) => !zeile.verpasst),
  };
}
