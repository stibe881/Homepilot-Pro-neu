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

