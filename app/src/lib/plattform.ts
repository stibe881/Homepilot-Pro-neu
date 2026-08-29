import { Platform } from 'react-native';

/**
 * Was auf welcher Plattform überhaupt geht – an einer Stelle.
 *
 * Dieselbe Quelle wird zu drei Programmen: iPhone/iPad (nativ), Android
 * (theoretisch) und Browser. Die Unterschiede standen bisher als zwanzig
 * einzelne `Platform.OS`-Abfragen verstreut im Baum, und jede sagte nur
 * *dass* etwas anders ist, nie *warum*. Wer wissen wollte, was der
 * Web-Fassung fehlt, musste grepen.
 *
 * Hier stehen sie als Fähigkeiten statt als Plattformnamen. Das ist nicht
 * nur ordentlicher, es ist auch richtiger: `Platform.OS === 'ios'` an
 * einer Widget-Abfrage heisst nicht «auf dem iPhone», sondern «dort, wo
 * es Widgets gibt». Kommt Android je dazu, ändert sich eine Zeile hier
 * und keine im Bildschirm.
 *
 * Der Gegencheck steht in `docs/plattformen.md` – dieselbe Tabelle in
 * Worten, für die Frage «warum sehe ich das im Browser nicht?».
 */

const web = Platform.OS === 'web';
const ios = Platform.OS === 'ios';

export const kann = {
  /** Kurzes Vibrieren beim Schalten. Der Browser kennt die Schnittstelle nicht. */
  haptik: !web,

  /** Face ID / Fingerabdruck vor dem Türöffner. Braucht expo-local-authentication. */
  biometrie: !web,

  /** Push-Nachrichten, wenn die App zu ist. Im Browser gibt es nur die
   *  offene Seite – ein Alarm um drei Uhr nachts erreicht dort niemanden. */
  push: !web,

  /** Sperrbildschirm-Widgets und der Kurzbefehl-Anschluss. iOS-eigen. */
  widgets: ios,

  /** Die Tastatur schiebt den Inhalt hoch. Nur iOS braucht dafür
   *  `KeyboardAvoidingView`; Android macht es selbst, Web hat kein Problem. */
  tastaturSchiebt: ios,

  /** Escape schliesst ein Fenster. Auf dem Telefon gibt es keine Taste dafür. */
  escapeTaste: web,

  /** QR-Code mit der Kamera einlesen. Im Browser fehlt der Zugriff aus
   *  einer Seite heraus, die nicht über HTTPS läuft – und der Hub läuft
   *  im Heimnetz ohne Zertifikat. */
  qrScan: !web,

  /** Ein Foto aufnehmen (Raumbild, Rezept). Aus demselben Grund wie beim
   *  QR-Code: Im Browser ohne HTTPS gibt es keine Kamera. Die Galerie
   *  steht dort trotzdem offen – ein Dateiauswahl-Dialog braucht das nicht. */
  kamera: !web,

  /** Kurzbefehle am App-Symbol (langer Druck auf dem Homescreen).
   *  iOS und Android können es, der Browser nicht. */
  schnellaktionen: !web,

  /** Die App weiss, aus welchem Bau sie stammt (mitgeliefert oder per OTA
   *  nachgeladen). Im Browser sagt das die version.json neben dem Bündel. */
  ausOtaGeladen: !web,
} as const;

/** Wie das Gerät heisst, wenn die App es dem Hub meldet. */
export function geraeteName(): string {
  if (ios) return 'iPhone/iPad';
  if (Platform.OS === 'android') return 'Android';
  return 'Browser';
}

/** Wie die Entsperrung auf diesem Gerät heisst – Face ID sagt man auf
 *  Android nicht, und «Biometrie» sagt niemand. */
export function entsperrName(): string {
  return ios ? 'Face ID' : 'Fingerabdruck';
}
