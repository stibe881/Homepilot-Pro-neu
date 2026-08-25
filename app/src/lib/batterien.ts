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

/** Batteriegeräte, dringendste zuerst (rein, testbar).
 *
 * «Schwach»-Melder ohne Prozentwert stehen ganz oben: Sie sagen nur noch
 * «bald leer», und danach sind sie still. */
export function batteryRows(entities: Entity[]): HealthRow[] {
  const rows: HealthRow[] = [];
  for (const entity of entities) {
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

