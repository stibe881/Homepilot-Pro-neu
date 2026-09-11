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
  /** Fühler, auf die der Hitze-Hinweis hört (Punkt 540).
   *
   *  Optional, und das ist kein Schönheitsfehler: Ein Hub, der noch
   *  nicht so weit ist, schickt die Felder gar nicht - und eine App, die
   *  dann `undefined.length` liest, zeigt statt der Regelliste einen
   *  Absturz. Genau das ist beim Bauen passiert. */
  temp?: string[];
  humidity?: string[];
  covers: GuardCover[];
  /** Was überhaupt in Frage kommt - der Hub hat es schon gefiltert:
   *  drinnen, plausibel, nicht «nur für seinen Raum». */
  temp_sensors?: GuardCover[];
  humidity_sensors?: GuardCover[];
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
 * Dasselbe für die Fühler des Hitze-Hinweises (Punkt 540).
 *
 * Eigener Satz und nicht `storenSatz`, weil «Alle 6 Storen» hier die
 * falsche Auskunft wäre - und weil die Feuchte einen Fall mehr hat:
 * Ohne Fühler steht gar keine Feuchte in der Nachricht, und das gehört
 * dazugeschrieben. Bei der Temperatur heisst leer dagegen «alle», sonst
 * käme der Hinweis ohne jede Einstellung nie.
 */
export function fuehlerSatz(
  gewaehlt: string[] | undefined,
  fuehler: GuardCover[] | undefined,
  art: 'temp' | 'humidity'
): string {
  if (!fuehler || fuehler.length === 0) {
    return art === 'temp'
      ? 'Kein Temperaturfühler drinnen gefunden.'
      : 'Kein Feuchtefühler drinnen gefunden.';
  }
  if (!gewaehlt || gewaehlt.length === 0) {
    if (art === 'humidity') return 'Keiner – die Nachricht nennt keine Feuchte.';
    return fuehler.length === 1
      ? 'Der eine Fühler des Hauses.'
      : `Alle ${fuehler.length} Fühler im Mittel.`;
  }
  const namen = gewaehlt
    .map((id) => fuehler.find((eintrag) => eintrag.id === id)?.name ?? id)
    .filter(Boolean);
  if (namen.length <= 3) return namen.join(', ');
  return `${namen.slice(0, 3).join(', ')} und ${namen.length - 3} weitere`;
}

/**
 * Einen Fühler an- oder abhaken (rein, testbar).
 *
 * Anders als bei den Storen ohne die «leer heisst alle»-Umkehr: Bei der
 * Feuchte ist «keiner» ein sinnvoller Zustand (dann steht sie nicht in
 * der Nachricht), und bei der Temperatur will man oft genau *einen* -
 * den in der Stube. Wer alle abwählt, ist bei der Temperatur zurück auf
 * «alle im Mittel»; das ist dieselbe Vorgabe wie ohne Einstellung.
 */
export function fuehlerUmschalten(
  gewaehlt: string[] | undefined,
  id: string
): string[] {
  const stand = gewaehlt ?? [];
  return stand.includes(id)
    ? stand.filter((eintrag) => eintrag !== id)
    : [...stand, id];
}

/** Ist dieser Fühler angehakt? Anders als bei den Storen heisst leer
 *  hier *nicht* «alle sind angehakt» - es heisst «nichts gewählt». */
export function fuehlerDabei(gewaehlt: string[] | undefined, id: string): boolean {
  return (gewaehlt ?? []).includes(id);
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
