/**
 * Knöpfe unter der Mitteilung.
 *
 * Eine Meldung ohne Handgriff ist eine Meldung, die man wegwischt:
 * «Fenster offen» um halb elf – App öffnen, Raum suchen, Storen zu. Vier
 * Griffe für eine Bewegung, und deshalb macht man es nicht.
 *
 * iOS und Android bieten Knöpfe direkt in der Mitteilung an. Welche das
 * sind, entscheidet eine Kennung, die die App vorher anmeldet und die der
 * Hub jeder Nachricht beilegt (`categoryId`, siehe hub/core/push.py:
 * knoepfe).
 *
 * Bewusst zwei Handgriffe, und beide harmlos: «Später» und «Erledigt».
 * Was Schaden anrichten kann – aufschliessen, entschärfen –, gehört nicht
 * auf einen Sperrbildschirm, den jeder sieht, der das Telefon vom Tisch
 * nimmt.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** Dieselben Kennungen wie im Hub (core/push.py). */
export const KATEGORIE_SPAETER = 'spaeter';
export const KATEGORIE_ERLEDIGT = 'erledigt';
export const KATEGORIE_WAESCHE = 'waesche';

/** Die Knöpfe selbst – die Kennung reist mit der Antwort zurück. */
export const KNOPF_SPAETER = 'spaeter30';
export const KNOPF_ERLEDIGT = 'erledigt';
export const KNOPF_ICHMACHS = 'ichmachs';

/**
 * Was dieser Knopf bedeutet (rein, testbar).
 *
 * Die Antwort von iOS trägt nur eine Zeichenkette; hier wird daraus
 * wieder eine Handlung. Der Standardknopf («in die App tippen») heisst
 * bei Expo `expo.modules.notifications.actions.DEFAULT` und ist keiner
 * unserer Griffe.
 */
export function knopfHandlung(
  id: string | undefined
): 'spaeter' | 'erledigt' | 'ichmachs' | null {
  if (id === KNOPF_SPAETER) return 'spaeter';
  if (id === KNOPF_ERLEDIGT) return 'erledigt';
  if (id === KNOPF_ICHMACHS) return 'ichmachs';
  return null;
}

/**
 * Die Kategorien beim Betriebssystem anmelden.
 *
 * Muss vor der ersten Mitteilung geschehen – eine Nachricht mit einer
 * unbekannten Kennung zeigt schlicht keine Knöpfe, ohne Fehler. Läuft
 * darum beim Start, gleich neben den Android-Kanälen.
 */
export async function knoepfeAnmelden(): Promise<void> {
  if (Platform.OS === 'web') return;
  const spaeter = {
    identifier: KNOPF_SPAETER,
    buttonTitle: 'In 30 Min nochmal',
    // Ohne die App zu öffnen: Der ganze Zweck ist, das Telefon in der
    // Tasche zu lassen.
    options: { opensAppToForeground: false },
  };
  const erledigt = {
    identifier: KNOPF_ERLEDIGT,
    buttonTitle: 'Erledigt',
    options: { opensAppToForeground: false },
  };
  // «Ich mach's» unter der vollen Maschine. Die Meldung geht an alle,
  // und ohne dieses Zeichen geht danach entweder niemand hinunter -
  // jeder nimmt an, ein anderer tue es - oder zwei gleichzeitig.
  //
  // Harmlos im Sinne der Regel oben: Es schaltet nichts, es sagt nur,
  // wer sich kümmert. Wer das Telefon vom Tisch nimmt und darauf
  // drückt, hat höchstens seinen Namen an einer Waschmaschine stehen.
  const ichmachs = {
    identifier: KNOPF_ICHMACHS,
    buttonTitle: 'Ich mach\u2019s',
    options: { opensAppToForeground: false },
  };
  await Notifications.setNotificationCategoryAsync(KATEGORIE_SPAETER, [spaeter]);
  await Notifications.setNotificationCategoryAsync(KATEGORIE_ERLEDIGT, [
    erledigt,
    spaeter,
  ]);
  await Notifications.setNotificationCategoryAsync(KATEGORIE_WAESCHE, [
    ichmachs,
    spaeter,
  ]);
}
