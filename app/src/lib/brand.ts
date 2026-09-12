/**
 * Die Brandmeldeanlage in der App (Punkt 543) - das Rechnen.
 *
 * Der Hub entscheidet, ob es brennt (core/brandmelder.py); hier steht
 * nur, wie das auf dem Bildschirm heisst und wie sich die Melderliste
 * ordnet: die, die anschlagen, zuoberst - danach die, denen etwas fehlt.
 */

export type BrandZustand = 'bereit' | 'ausgeloest' | 'quittiert' | 'unbesetzt';

export interface BrandState {
  state: BrandZustand | string;
  melder?: number;
  alarm?: string[];
  since?: number | null;
  acknowledged_by?: string | null;
}

export interface Melder {
  entity_id: string;
  name: string;
  room?: string | null;
  kind: string;
  device_class?: string | null;
  alarm: boolean;
  active: boolean;
  available: boolean;
  battery?: number | null;
  low_battery?: boolean;
  last_seen?: number | null;
  last_test?: number | null;
  test_overdue?: boolean;
  can_mute?: boolean;
  can_self_test?: boolean;
  /** Nur ein echter Melder hat eine Prüftaste - eine Kamera hört nur mit. */
  testable?: boolean;
}

export interface BrandSettings {
  notify: boolean;
  lights_on: boolean;
  covers_open: boolean;
  unlock_doors: boolean;
  announce: boolean;
  announce_text: string;
  buzz_others: boolean;
  repeat_minutes: number;
  notify_clear: boolean;
  test_months: number;
}

/** Farbe und Satz zum Zustand (rein, testbar). */
export function zustandText(state: BrandState | null | undefined): {
  text: string;
  ton: 'gut' | 'warnung' | 'ruhig' | 'gefahr';
} {
  const wert = String(state?.state ?? '');
  if (wert === 'ausgeloest') {
    return { text: 'Rauch gemeldet – das Haus verlassen', ton: 'gefahr' };
  }
  if (wert === 'quittiert') {
    const wer = state?.acknowledged_by ? ` von ${state.acknowledged_by}` : '';
    return { text: `Quittiert${wer} – Melder noch aktiv`, ton: 'warnung' };
  }
  if (wert === 'unbesetzt') {
    return { text: 'Kein Rauchmelder angeschlossen', ton: 'ruhig' };
  }
  const anzahl = state?.melder ?? 0;
  return {
    text: anzahl === 1 ? 'Bereit – 1 Melder wacht' : `Bereit – ${anzahl} Melder wachen`,
    ton: 'gut',
  };
}

/** Die eine Zeile unter dem Meldernamen (rein, testbar). */
export function melderZeile(melder: Melder, jetzt: number = Date.now() / 1000): string {
  if (melder.alarm) return 'Meldet Rauch!';
  if (!melder.active) return 'Abgeschaltet – zählt nicht';
  // Eine Kamera hört einen piependen Melder - prüfen lässt sie sich
  // nicht, und «nie geprüft» stünde dort für immer.
  if (melder.kind === 'camera') {
    return melder.available ? 'Hört einen piependen Melder' : 'Kamera meldet sich nicht';
  }
  const teile: string[] = [];
  if (!melder.available) teile.push('meldet sich nicht');
  if (melder.low_battery) teile.push('Batterie schwach');
  else if (typeof melder.battery === 'number') teile.push(`Batterie ${Math.round(melder.battery)} %`);
  if (melder.last_test == null) teile.push('nie geprüft');
  else {
    const tage = Math.max(0, Math.round((jetzt - melder.last_test) / 86400));
    teile.push(
      melder.test_overdue
        ? `Prüfung überfällig (vor ${tage} Tagen)`
        : tage === 0
          ? 'heute geprüft'
          : `geprüft vor ${tage} Tagen`
    );
  }
  return teile.join(' · ') || 'Bereit';
}

/** Alarmierende zuerst, dann Sorgenkinder, dann der Rest (rein, testbar). */
export function sortiert(melder: Melder[]): Melder[] {
  const rang = (m: Melder) =>
    m.alarm ? 0 : !m.active ? 3 : !m.available || m.low_battery || m.test_overdue ? 1 : 2;
  return [...melder].sort((a, b) => rang(a) - rang(b) || a.name.localeCompare(b.name, 'de'));
}
