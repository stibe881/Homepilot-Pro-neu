/**
 * Die Einstellungen eines Geräts - Nachlaufzeit, Empfindlichkeit,
 * Temperatur-Abgleich (Punkt 631 der Werkbank).
 *
 * Bisher gab es sie nur in der Zigbee2MQTT-Oberfläche auf Port 8099.
 * Wer den Melder im Flur unempfindlicher wollte oder den Aqara-Fühler
 * 0.8 Grad nach unten abgleichen, musste dorthin - und der Raumkopf
 * zeigte bis dahin den Fehler des Fühlers als Zimmertemperatur.
 *
 * Der Hub legt je Gerät eine kleine Liste `options` in den Zustand
 * (integrations/zigbee2mqtt.py, `optionen_aus_exposes`): Name,
 * deutsche Beschriftung, Art, Bereich und der zuletzt gemeldete Wert.
 * Gestellt wird mit dem Befehl `set_option {name, value}`. Hier steht
 * die Rechnerei dazu; das Blatt (components/entity/anpassen.tsx) zeigt
 * nur an.
 */
import { Entity } from '../api/types';

export interface GeraetOption {
  name: string;
  label: string;
  type: 'numeric' | 'binary' | 'enum';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  values?: string[];
  /** Der zuletzt gemeldete Wert - null, solange das Gerät ihn nie
   *  genannt hat. */
  value: number | string | boolean | null;
}

/**
 * Befehle, die das Gerät *einstellen*, nicht schalten.
 *
 * Ein Bewegungsmelder mit Nachlaufzeit hat damit einen Befehl - aber
 * keinen, der ihn ein- oder ausschaltet. Wer «lässt sich schalten» an
 * `commands.length` misst, muss diese hier abziehen; sonst landet der
 * Melder in einer Raumszene als Zeile «aus».
 */
export const EINSTELL_BEFEHLE = ['set_option', 'set_power_on'];

/** Lässt sich das Gerät schalten - nicht nur einstellen? (rein, testbar) */
export function schaltbar(entity: { commands: string[] }): boolean {
  return entity.commands.some((command) => !EINSTELL_BEFEHLE.includes(command));
}

/** Die Einstellungen eines Geräts, sofern es welche stellen lässt (rein, testbar). */
export function optionenVon(entity: Entity | null | undefined): GeraetOption[] {
  if (!entity || !entity.commands.includes('set_option')) return [];
  const roh = entity.state?.options;
  if (!Array.isArray(roh)) return [];
  return roh.filter(
    (eintrag): eintrag is GeraetOption =>
      !!eintrag &&
      typeof eintrag === 'object' &&
      typeof eintrag.name === 'string' &&
      ['numeric', 'binary', 'enum'].includes(String(eintrag.type))
  );
}

/**
 * Die Wörter des Geräts auf Deutsch (rein, testbar).
 *
 * Zigbee2MQTT spricht «low/medium/high»; was nicht in der Liste steht,
 * bleibt, wie es kommt - besser ein englisches Wort als ein falsches.
 */
const WERT_WORTE: Record<string, string> = {
  low: 'niedrig',
  medium: 'mittel',
  high: 'hoch',
  very_low: 'sehr niedrig',
  very_high: 'sehr hoch',
  off: 'aus',
  on: 'an',
  lock: 'gesperrt',
  unlock: 'frei',
  normal: 'normal',
  inverted: 'umgekehrt',
};

export function wertWort(value: unknown): string {
  const text = String(value ?? '');
  return WERT_WORTE[text] ?? text.replace(/_/g, ' ');
}

/**
 * Der Schritt für die Knöpfe «−» und «+» (rein, testbar).
 *
 * Was das Gerät vorgibt, gilt. Ohne Vorgabe wäre 1 bei einer
 * Nachlaufzeit bis 65535 Sekunden ein Witz - dort sind es zehn;
 * bei kleinen Bereichen (ein Abgleich von −10 bis 10) ein Zehntel.
 */
export function schrittFuer(option: GeraetOption): number {
  if (typeof option.step === 'number' && option.step > 0) return option.step;
  const spanne =
    typeof option.min === 'number' && typeof option.max === 'number'
      ? option.max - option.min
      : NaN;
  if (Number.isFinite(spanne) && spanne <= 20) return 0.1;
  if (Number.isFinite(spanne) && spanne >= 1000) return 10;
  return 1;
}

/** Wie viele Nachkommastellen ein Schritt braucht (rein, testbar). */
function stellen(schritt: number): number {
  const text = String(schritt);
  const komma = text.indexOf('.');
  return komma < 0 ? 0 : Math.min(3, text.length - komma - 1);
}

/**
 * Der nächste Wert nach einem Tipp auf «−» oder «+» (rein, testbar).
 *
 * Gedeckelt am Bereich des Geräts und auf den Schritt gerundet - sonst
 * stünde nach zehn Tippern «0.30000000000000004 °C» da.
 */
export function naechsterWert(option: GeraetOption, richtung: 1 | -1): number {
  const schritt = schrittFuer(option);
  const aktuell = typeof option.value === 'number' ? option.value : Number(option.value ?? 0);
  const basis = Number.isFinite(aktuell) ? aktuell : 0;
  return begrenzt(option, basis + richtung * schritt);
}

/** Ein getippter Wert, in den Bereich des Geräts gebracht (rein, testbar). */
export function begrenzt(option: GeraetOption, wert: number): number {
  let zahl = wert;
  if (typeof option.min === 'number') zahl = Math.max(option.min, zahl);
  if (typeof option.max === 'number') zahl = Math.min(option.max, zahl);
  return Number(zahl.toFixed(stellen(schrittFuer(option))));
}

/** Was rechts neben der Beschriftung steht (rein, testbar). */
export function wertText(option: GeraetOption): string {
  if (option.value === null || option.value === undefined) return '–';
  if (option.type === 'binary') return option.value ? 'an' : 'aus';
  if (option.type === 'enum') return wertWort(option.value);
  const zahl = Number(option.value);
  const text = Number.isFinite(zahl) ? String(zahl).replace('-', '−') : String(option.value);
  return option.unit ? `${text} ${option.unit}` : text;
}
