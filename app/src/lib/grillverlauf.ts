/**
 * Der Verlauf eines Grillabends - Garraum, Sollwert und die Fühler.
 *
 * Gewünscht im Haus (Punkt 566): «Man soll auch bei den Fühlern und bei
 * der Grilltemperatur eine Statistik sehen mit Diagramm.» Die Daten
 * kommen aus dem Zustandsverlauf des Hubs (Supabase, über
 * /api/entities/…/history): Jede Zeile trägt den ganzen Zustand des
 * Grills zu ihrer Zeit, also Temperatur, Sollwert und je Fühler seinen
 * Wert. Hier wird daraus je Grösse eine Reihe - reines Rechnen, das
 * Zeichnen steht in components/Grillverlauf.tsx.
 */
import { Punkt } from './verlaufkurve';

export interface Verlaufszeile {
  recorded_at: string;
  state?: Record<string, unknown>;
}

export interface Grillkurven {
  temperatur: Punkt[];
  ziel: Punkt[];
  /** Je Fühlernummer seine Reihe - nur Fühler, die je einen Wert hatten. */
  fuehler: Record<string, Punkt[]>;
}

/** Die Zeiträume, nach denen beim Grillen gefragt wird: ein Grillabend
 *  dauert Stunden, nicht Tage - 24 h ist die Obergrenze, nicht der
 *  Anfang wie beim Sensor. */
export const GRILL_ZEITRAEUME: { hours: number; label: string }[] = [
  { hours: 3, label: '3 h' },
  { hours: 6, label: '6 h' },
  { hours: 12, label: '12 h' },
  { hours: 24, label: '24 h' },
];

/**
 * Ein Messwert aus einer Verlaufszeile - oder keiner (rein, testbar).
 *
 * `null` und «» sind Lücken, keine Nullen: `Number(null)` ist 0, und so
 * standen im Diagramm senkrechte Striche bis zum Boden - die
 * Bruchstücke nach einem Befehl (Punkt 567) hatten `temperature: null`
 * in den Verlauf geschrieben, und die Kurve fiel jedes Mal auf 0 °C
 * (Punkt 574). Eine Null selbst ist auch keine Messung: Ein Pit Boss
 * meldet für einen steckenden Fühler oder einen laufenden Garraum nie
 * 0, in keiner Einheit - wo sie steht, hat die Platine geschwiegen.
 */
export function messwert(wert: unknown): number | null {
  if (wert === null || wert === undefined || wert === '') return null;
  const n = typeof wert === 'number' ? wert : Number(wert);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const zahl = messwert;

/**
 * Aus den Verlaufszeilen die Kurven (rein, testbar).
 *
 * Zeilen ohne Zeit oder Zustand fallen weg; innerhalb jeder Reihe nur
 * die Zeilen, in denen die Grösse einen Wert hatte - ein ausgesteckter
 * Fühler reisst sonst die Kurve auf null. Sortiert nach Zeit, weil der
 * Hub die jüngsten zuerst schickt.
 */
export function grillkurven(zeilen: Verlaufszeile[] | undefined): Grillkurven {
  const temperatur: Punkt[] = [];
  const ziel: Punkt[] = [];
  const fuehler: Record<string, Punkt[]> = {};
  for (const zeile of zeilen ?? []) {
    if (!zeile || !zeile.state) continue;
    const at = new Date(zeile.recorded_at).getTime();
    if (!Number.isFinite(at)) continue;
    const t = zahl(zeile.state.temperature);
    if (t !== null) temperatur.push({ at, value: t });
    const z = zahl(zeile.state.target);
    if (z !== null) ziel.push({ at, value: z });
    for (const nummer of ['1', '2', '3', '4']) {
      const f = zahl(zeile.state[`probe_${nummer}`]);
      if (f === null) continue;
      (fuehler[nummer] ??= []).push({ at, value: f });
    }
  }
  const nachZeit = (a: Punkt, b: Punkt) => a.at - b.at;
  temperatur.sort(nachZeit);
  ziel.sort(nachZeit);
  for (const reihe of Object.values(fuehler)) reihe.sort(nachZeit);
  return { temperatur, ziel, fuehler };
}

/** Gibt es genug für eine Kurve? (rein, testbar) */
export function hatVerlauf(kurven: Grillkurven): boolean {
  return (
    kurven.temperatur.length >= 2 ||
    Object.values(kurven.fuehler).some((reihe) => reihe.length >= 2)
  );
}

/**
 * Eine Reihe ein- oder ausblenden (rein, testbar).
 *
 * Gewünscht im Haus (Punkt 573): «Man soll im Verlauf die einzelnen
 * Sensoren an-/abwählen können.» Die Legende ist der Schalter: Ein
 * Tipp auf «P2» nimmt die Kurve weg, der nächste bringt sie zurück.
 * Gemerkt wird, was **aus** ist - so bleibt eine neu auftauchende Reihe
 * (ein Fühler, der eben eingesteckt wurde) von selbst sichtbar.
 */
export function reihenUmschalten(ausgeblendet: string[], name: string): string[] {
  return ausgeblendet.includes(name)
    ? ausgeblendet.filter((eintrag) => eintrag !== name)
    : [...ausgeblendet, name];
}
