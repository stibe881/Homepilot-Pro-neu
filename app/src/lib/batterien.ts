/**
 * Batterien: welche Zeilen die Liste zeigt und was quittiert ist.
 *
 * Herausgelöst aus components/DeviceHealth.tsx, weil sich dort nichts
 * prüfen lässt: Die Datei zieht die Symbolschriften von Expo mit, und
 * Jest lädt sie deshalb nicht. Dieselbe Lehre wie bei
 * screens/automations/szenengeraete.ts.
 */
import { Entity } from '../api/types';

// Ab hier gilt eine Batterie als «demnächst dran» und wird gelb.
export const BATTERY_SOON = 25;

export interface HealthRow {
  entity: Entity;
  /** Prozent, wenn das Gerät einen Stand meldet – manche melden nur
   *  «schwach ja/nein». */
  percent: number | null;
  low: boolean;
}

/** Was der Hub zu den Warnungen vermerkt hat. */
export interface BatterieVermerk {
  entity_id: string;
  muted_until?: number | null;
  muted?: boolean;
  /** Wer sie stillgestellt hat und wann (Punkt 478 der Werkbank). */
  ack?: { by?: string | null; at?: number | null; until?: number | null } | null;
}

/**
 * Wer diese Warnung stillgestellt hat – als Satz (rein, testbar).
 *
 * Punkt 478 der Werkbank: Die Quittung gilt fürs ganze Haus, und das ist
 * richtig so - sonst laufen zwei Leute wegen derselben Batterie in den
 * Keller. Falsch war, dass sie *unsichtbar* für alle galt: Wer nachts
 * die Warnung wegdrückte, drückte sie auch dem anderen weg, und der
 * suchte am Morgen eine Meldung, die es nie mehr gab.
 *
 * `null`, wo niemand gedrückt hat oder die Quittung abgelaufen ist -
 * dann steht da nichts statt einer Zeile, die Ruhe behauptet.
 */
export function quittungSatz(
  vermerke: BatterieVermerk[],
  entityId: string,
  jetzt: number
): string | null {
  const treffer = vermerke.find((eintrag) => eintrag.entity_id === entityId);
  const ack = treffer?.ack;
  if (!ack?.until || ack.until * 1000 <= jetzt) return null;
  const wer = String(ack.by ?? '').trim();
  return wer ? `Von ${wer} stillgestellt` : 'Stillgestellt';
}

/** Bis wann eine Warnung quittiert ist – null, wenn nicht (rein, testbar).
 *
 * Aus der Liste des Hubs, damit die Zeile «bis morgen stumm» anzeigen
 * kann, ohne dass jede Zeile einzeln nachfragt. */
export function stummBis(
  vermerke: BatterieVermerk[],
  entityId: string,
  jetzt: number
): number | null {
  const treffer = vermerke.find((eintrag) => eintrag.entity_id === entityId);
  const bis = treffer?.muted_until ?? null;
  return bis !== null && bis * 1000 > jetzt ? bis : null;
}

/** Ist das ein Mensch statt eines Geräts? (rein, testbar)
 *
 * Die Anwesenheits-Entitäten führen den Akkustand des Telefons mit -
 * über die App selbst oder über Life360. Nützlich ist er dort, wo er
 * hingehört: Ein leeres Telefon meldet keinen Standort mehr, und davor
 * warnt der Hub. In der Batterieliste hat er nichts verloren.
 *
 * Diese Liste beantwortet genau eine Frage: Wo muss ich eine Batterie
 * wechseln? Ein Telefon wird geladen, nicht gewechselt - und wenn es
 * mit 14 Prozent zuoberst steht, verdeckt es den Türkontakt, der
 * wirklich dran wäre. Erkennbar sind sie am Ort, den sie mitführen. */
export function istPerson(entity: Entity): boolean {
  return (
    'place' in (entity.state ?? {}) ||
    entity.state?.device_class === 'presence'
  );
}

/** Batteriegeräte, dringendste zuerst (rein, testbar).
 *
 * «Schwach»-Melder ohne Prozentwert stehen ganz oben: Sie sagen nur noch
 * «bald leer», und danach sind sie still. */
export function batteryRows(entities: Entity[]): HealthRow[] {
  const rows: HealthRow[] = [];
  for (const entity of entities) {
    if (istPerson(entity)) continue;
    const raw = entity.state?.battery;
    const percent = typeof raw === 'number' && raw >= 0 && raw <= 100 ? raw : null;
    const low = entity.state?.low_battery === true;
    if (percent === null && !low) continue;
    rows.push({ entity, percent, low });
  }
  return rows.sort((a, b) => {
    const rank = (row: HealthRow) =>
      row.low ? -1 : row.percent === null ? 999 : row.percent;
    return rank(a) - rank(b) || a.entity.name.localeCompare(b.entity.name);
  });
}

/** Was in einem Melder stecken kann (Punkt 633) - dieselbe Liste wie im
 *  Hub (core/watchrules.py: BATTERIETYPEN). Eine Vorschlagsliste, keine
 *  Wahrheit: Der Hub weiss es nicht, die App fragt den Menschen. */
export const BATTERIETYPEN = ['CR2032', 'CR2450', 'CR2477', 'CR123A', 'AA', 'AAA', '9V', 'Akku'];

/** Hat dieses Gerät überhaupt eine Batterie? (rein, testbar) */
export function hatBatterie(entity: Entity): boolean {
  if (istPerson(entity)) return false;
  const raw = entity.state?.battery;
  return (typeof raw === 'number' && raw >= 0 && raw <= 100) || entity.state?.low_battery === true;
}

/** Der Posten für die Einkaufsliste (rein, testbar): «CR2032 (Türkontakt
 *  Küche)» - der Typ vorn, weil man im Laden danach sucht, das Gerät in
 *  Klammern, weil zwei Melder mit derselben Zelle zwei Posten sind. */
export function einkaufText(typ: string, geraet: string): string {
  const name = String(geraet ?? '').trim();
  return name ? `${typ} (${name})` : typ;
}

/**
 * Was in den nächsten Monaten zu kaufen ist (rein, testbar) - Punkt 633.
 *
 * Gezählt wird je Typ, was jetzt schwach ist oder laut Prognose innert
 * `horizontTage` leer wird. Geräte ohne Typ zählen nicht: Ein «2× ?» ist
 * keine Einkaufshilfe. Sortiert nach Anzahl, dann Name.
 */
export function batterieBedarf(
  rows: HealthRow[],
  resttage: Record<string, number>,
  horizontTage = 90
): { typ: string; anzahl: number }[] {
  const zaehler = new Map<string, number>();
  for (const row of rows) {
    const typ = row.entity.battery_type;
    if (!typ) continue;
    const tage = resttage[row.entity.id];
    const bald =
      row.low ||
      (row.percent !== null && row.percent <= BATTERY_SOON) ||
      (typeof tage === 'number' && tage <= horizontTage);
    if (!bald) continue;
    zaehler.set(typ, (zaehler.get(typ) ?? 0) + 1);
  }
  return [...zaehler.entries()]
    .map(([typ, anzahl]) => ({ typ, anzahl }))
    .sort((a, b) => b.anzahl - a.anzahl || a.typ.localeCompare(b.typ));
}

/** «Für die nächsten 3 Monate: 2× CR2032, 1× AAA» - oder null (rein, testbar). */
export function bedarfSatz(bedarf: { typ: string; anzahl: number }[], monate = 3): string | null {
  if (bedarf.length === 0) return null;
  const teile = bedarf.map((b) => `${b.anzahl}× ${b.typ}`).join(', ');
  return `Für die nächsten ${monate} Monate: ${teile}`;
}
