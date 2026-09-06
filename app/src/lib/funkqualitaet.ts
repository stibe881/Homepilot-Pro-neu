/**
 * Funkqualität der Zigbee-Geräte: was der Abschnitt «Funk» zeigt.
 *
 * Punkt 230 der Werkbank: Jede Zigbee-Meldung trägt eine linkquality
 * (0-255) mit, und niemand las sie – dabei ist sie die Frühwarnung
 * schlechthin. Der Hub sammelt Wochenmittel und rechnet den Trend
 * (core/funkqualitaet.py); hier steht nur die Aufbereitung für die
 * Geräte-Gesundheit. Herausgelöst aus components/DeviceHealth.tsx aus
 * demselben Grund wie batterien.ts: Dort lässt sich nichts prüfen.
 */

/** Eine Zeile aus GET /api/funk (api/routes/funk.py). */
export interface FunkZeile {
  entity_id: string;
  name: string;
  room?: string | null;
  /** Der aktuelle Wert aus dem Zustand (0-255). */
  value: number;
  /** Wochenmittel am Anfang und Ende der Reihe – null bei jungen
   *  Reihen: Unter drei Wochen Daten wäre der Trend geraten. */
  mean_from?: number | null;
  mean_to?: number | null;
  direction?: 'falling' | 'steady' | 'rising' | null;
  /** Der Hub hält das Gerät für «Funk wird schwach» – dieselbe
   *  Rechnung, aus der auch die Push-Meldung kommt. */
  weak?: boolean;
}

/** Auffällige Funker, schwächste zuerst (rein, testbar).
 *
 * Nur schwache und fallende: Eine Liste aller Geräte mit gutem Funk
 * wäre die Batterienliste noch einmal, nur ohne Frage dahinter. Wer
 * fällt, aber noch nicht schwach ist, steht mit drin – genau das ist
 * die Frühwarnung, um die es in Punkt 230 geht. */
export function funkRows(zeilen: FunkZeile[]): FunkZeile[] {
  const rank = (zeile: FunkZeile) => zeile.mean_to ?? zeile.value;
  return (zeilen ?? [])
    .filter((zeile) => zeile.weak === true || zeile.direction === 'falling')
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Wie ernst es ist – für die Farbe der Zeile (rein, testbar).
 *
 * «kritisch», wenn der Hub das Gerät schwach nennt (daraus wird auch
 * die Push); «warnung» für den Abstieg, der noch nicht unten ist. */
export function funkStufe(zeile: FunkZeile): 'kritisch' | 'warnung' {
  return zeile.weak === true ? 'kritisch' : 'warnung';
}

/** Die Entwicklung als Wort (rein, testbar).
 *
 * Mit beiden Zahlen, wenn wirklich etwas gefallen ist – «von 180 auf
 * 40» sagt mehr als jedes Adjektiv. War der Funk schon immer schwach,
 * gibt es keinen Absturz zu erzählen, nur den Stand. */
export function funkWort(zeile: FunkZeile): string {
  const von = zeile.mean_from;
  const auf = zeile.mean_to;
  if (typeof von === 'number' && typeof auf === 'number' && von - auf >= 10) {
    return `von ${Math.round(von)} auf ${Math.round(auf)} gefallen`;
  }
  const stand = typeof auf === 'number' ? auf : Math.round(zeile.value);
  return `seit Wochen schwach (${stand} von 255)`;
}
