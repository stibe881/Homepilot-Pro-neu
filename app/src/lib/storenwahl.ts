/**
 * Die Storen-Auswahl der Wächter-Regeln (rein, testbar).
 *
 * Der Sturmwächter fährt Storen hoch, die Hitze-Empfehlung spricht von
 * ihnen - und welche das sind, wählt man in der jeweiligen Regelkarte.
 * Leer heisst «alle Storen»: So wirken die Wächter sofort, ohne dass
 * jemand etwas speichert. Hier steht die Rechnerei, die Karte zeigt sie.
 */

export interface GuardCover {
  id: string;
  name: string;
  room?: string | null;
}

export interface GuardStand {
  storm: string[];
  heat: string[];
  covers: GuardCover[];
}

/** Was zugeklappt dasteht: «Alle 6 Storen» oder die Namen. */
export function storenSatz(gewaehlt: string[], covers: GuardCover[]): string {
  if (covers.length === 0) return 'Keine Storen im Haus gefunden.';
  if (gewaehlt.length === 0) {
    return covers.length === 1 ? 'Die eine Store des Hauses.' : `Alle ${covers.length} Storen.`;
  }
  const namen = gewaehlt
    .map((id) => covers.find((cover) => cover.id === id)?.name ?? id)
    .filter(Boolean);
  if (namen.length <= 3) return namen.join(', ');
  return `${namen.slice(0, 3).join(', ')} und ${namen.length - 3} weitere`;
}

/**
 * Einen Haken umschalten - mit der «leer heisst alle»-Regel.
 *
 * Wer bei «alle» einen abwählt, meint «alle ausser diesem»: Aus der
 * leeren Liste werden dann alle übrigen. Wer den letzten fehlenden
 * wieder anhakt, ist zurück bei «alle» - gespeichert wieder als leer,
 * damit ein später dazugebauter Storen von selbst mitmacht. Und den
 * allerletzten Haken gibt es nicht herzugeben: «keine Storen» ist kein
 * Zustand dieser Auswahl - wer das will, schaltet die Regel ab.
 */
export function umschalten(
  gewaehlt: string[],
  id: string,
  covers: GuardCover[]
): string[] {
  const alle = covers.map((cover) => cover.id);
  const stand = gewaehlt.length === 0 ? alle : gewaehlt.filter((e) => alle.includes(e));
  const neu = stand.includes(id)
    ? stand.filter((eintrag) => eintrag !== id)
    : [...stand, id];
  if (neu.length === 0) return gewaehlt;
  const uebrig = alle.filter((eintrag) => !neu.includes(eintrag));
  return uebrig.length === 0 ? [] : neu;
}

/** Ist dieser Storen gerade dabei? (leer heisst: alle sind es) */
export function dabei(gewaehlt: string[], id: string): boolean {
  return gewaehlt.length === 0 || gewaehlt.includes(id);
}
