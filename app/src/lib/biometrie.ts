import * as LocalAuthentication from 'expo-local-authentication';
import { kann } from './plattform';

/**
 * Face ID / Fingerabdruck vor heiklen Aktionen.
 *
 * Das Telefon liegt schnell einmal offen herum, und «Türe öffnen» ist
 * dann ein Fingertipp. Diese Sperre kostet eine Sekunde und verhindert
 * genau das.
 *
 * Zwei Entscheidungen, die dahinterstehen:
 *
 * *Der Hub prüft weiterhin selbst.* Diese Sperre ist eine Hürde vor dem
 * Absenden, kein Ersatz für Rechte oder die Alarm-PIN. Wer die App
 * umgeht, kommt damit keinen Schritt weiter.
 *
 * *Im Zweifel durchlassen.* Kennt ein Gerät keine Biometrie oder ist
 * keine eingerichtet, wird die Aktion ausgeführt statt blockiert. Eine
 * Sperre, die im Web oder auf einem alten Tablet die Türe verriegelt,
 * hilft niemandem - sie sperrt die Falschen aus.
 */

/** Aktionen, die eine Bestätigung wert sind. Der Text steht im Dialog. */
export const HEIKEL: Record<string, string> = {
  unlock: 'Türe aufschliessen',
  unlatch: 'Türe öffnen',
  disarm: 'Alarmanlage entschärfen',
};

/** Braucht dieser Befehl eine Bestätigung? (rein, testbar) */
export function needsCheck(command: string, kind?: string): boolean {
  if (command === 'disarm') return true;
  // «unlock»/«unlatch» gibt es nur an Schlössern; ein Rollladen, der
  // «open» kennt, ist keine Haustüre.
  return kind === 'lock' && (command === 'unlock' || command === 'unlatch');
}

/** Ist auf diesem Gerät überhaupt eine Biometrie eingerichtet? */
export async function available(): Promise<boolean> {
  if (!kann.biometrie) return false;
  try {
    const hardware = await LocalAuthentication.hasHardwareAsync();
    if (!hardware) return false;
    return await LocalAuthentication.isEnrolledAsync();
  } catch {
    return false;
  }
}

/**
 * Bestätigung einholen. Gibt true zurück, wenn weitergemacht werden darf.
 *
 * Ausdrücklich auch dann true, wenn gar keine Biometrie zur Verfügung
 * steht - siehe oben: im Zweifel durchlassen.
 */
export async function confirm(command: string): Promise<boolean> {
  if (!(await available())) return true;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: HEIKEL[command] ?? 'Bestätigen',
      cancelLabel: 'Abbrechen',
      // Auf den Gerätecode ausweichen, wenn das Gesicht nicht erkannt
      // wird: Sonst steht man mit nassen Händen vor der eigenen Türe.
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return true;
  }
}
