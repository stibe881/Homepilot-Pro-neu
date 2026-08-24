import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Die zwei Benachrichtigungskanäle für Android.
 *
 * Ab Android 8 entscheidet nicht mehr die einzelne Nachricht, wie laut
 * sie sein darf, sondern ihr Kanal – und wer keinen angibt, landet im
 * Sammelkanal mit mittlerer Wichtigkeit. Das heisst: kein Einblenden,
 * kein Ton nach vorne, und in der Systemeinstellung steht «Sonstiges».
 * Die Klingel sah dadurch aus wie eine Nachricht über einen freien
 * Speicherplatz.
 *
 * Zwei Kanäle und nicht zwanzig: Was hier steht, taucht in den
 * Android-Einstellungen als Liste auf, und die soll eine Frage
 * beantworten – «was darf mich unterbrechen?». Die feine Einteilung
 * nach Art der Nachricht gibt es schon, sie steht im Profil im Hub.
 *
 * Die Namen müssen zu ``KANAL_DRINGEND``/``KANAL_LEISE`` in
 * ``hub/homepilot/core/push.py`` passen – der Hub schickt die Kennung
 * als ``channelId`` mit. Stimmt sie nicht überein, legt Android
 * stillschweigend einen dritten Kanal an, und niemand merkt es.
 */
export const KANAL_DRINGEND = 'dringend';
export const KANAL_LEISE = 'leise';

export async function kanaeleAnlegen(): Promise<void> {
  // Nur Android kennt Kanäle. iOS steuert dasselbe über
  // `interruptionLevel` in der Nachricht selbst, Web gar nicht.
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(KANAL_DRINGEND, {
    name: 'Sofort',
    description: 'Klingel, Alarm, Wasser, Timer – alles, was nicht warten kann.',
    // MAX statt HIGH: Nur damit blendet Android die Nachricht über dem
    // laufenden Bildschirm ein, statt sie bloss in die Leiste zu legen.
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    // Auf dem Sperrbildschirm sichtbar: Wer vor der Tür steht, will man
    // sehen, ohne das Telefon zu entsperren.
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  await Notifications.setNotificationChannelAsync(KANAL_LEISE, {
    name: 'Kann warten',
    description: 'Batterie, Speicherplatz, Wartung, Einkauf, Geburtstage.',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  });
}
