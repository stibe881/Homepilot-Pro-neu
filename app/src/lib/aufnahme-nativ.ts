/**
 * Aufnehmen auf dem Telefon und dem iPad.
 *
 * Das Gegenstück zum Browser-Weg in `sprachnotiz.ts`: Dort nimmt der
 * `MediaRecorder` auf, hier `expo-audio`. Zwei Wege, weil die beiden
 * Welten nichts gemeinsam haben ausser dem Ergebnis - ein Blob, den der
 * Hub auf die Boxen legt.
 *
 * Diese Datei wird **nachgeladen** (`await import`), nicht oben
 * importiert. Sonst zöge jeder Web-Bau und jeder Test das native Modul
 * mit, und beide haben nichts davon.
 *
 * **Warum eigene Aufnahme-Werte statt eines der Voreinstellungen.**
 * `RecordingPresets.LOW_QUALITY` nimmt auf Android in AMR/3GP auf - das
 * spielt keine Google-Cast-Box. `HIGH_QUALITY` nimmt in Stereo mit 128
 * kbit/s auf; eine Minute davon ist fast ein Megabyte, und der Hub
 * weist alles über zwei Megabyte ab. Hier steht deshalb, was für eine
 * gesprochene Zeile richtig ist: AAC in einem MP4-Rumpf, mono, 22 kHz,
 * 48 kbit/s. Das spielt jede Cast-Box (der Hub erkennt es am `ftyp` -
 * siehe hub/core/sprachnotiz.py), und eine Minute wiegt rund 350 KB.
 */
import type { RecordingOptions } from 'expo-audio';

import type { Aufnahme } from './sprachnotiz';

/** Aufnahme-Werte für gesprochene Sätze - siehe Kopf dieser Datei. */
export const WERTE: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 48000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    // Zahlenwerte statt der Enums: Die kämen nur aus dem nativen Modul,
    // und das soll diese Datei nicht schon beim Einlesen brauchen.
    outputFormat: 'aac ',
    audioQuality: 64,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 48000 },
};

/**
 * Aufnahme starten. Wirft mit einem Namen, den `aufnahmeFehler` kennt.
 *
 * Die Erlaubnis wird hier erfragt und nicht beim Start der App: Das
 * Fenster «HomePilot möchte auf das Mikrofon zugreifen» ergibt nur
 * einen Sinn, wenn man gerade den Aufnahmeknopf gedrückt hat.
 */
export async function starteNativ(hoechstensMs: number): Promise<Aufnahme> {
  const audio = await import('expo-audio');
  const erlaubnis = await audio.requestRecordingPermissionsAsync();
  if (!erlaubnis.granted) {
    const fehler = new Error('Mikrofon nicht freigegeben');
    fehler.name = 'NotAllowedError';
    throw fehler;
  }
  // Ohne diesen Modus nimmt iOS nicht auf, solange der Schalter an der
  // Seite auf «lautlos» steht - und genau dann greift man am ehesten zum
  // Telefon, statt etwas zu rufen.
  await audio.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

  const recorder = new audio.AudioRecorder(WERTE);
  await recorder.prepareToRecordAsync();
  recorder.record();

  /** Das Mikrofon wieder loslassen - sonst bleibt oben der rote Balken
   *  stehen, und auf dem Telefon sieht das aus, als höre die App weiter
   *  zu. */
  const loslassen = () =>
    audio.setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);

  const frist = setTimeout(() => {
    if (recorder.isRecording) recorder.stop().catch(() => undefined);
  }, hoechstensMs);

  return {
    stopp: async () => {
      clearTimeout(frist);
      try {
        if (recorder.isRecording) await recorder.stop();
        const uri = recorder.uri;
        if (!uri) return null;
        // Der Umweg über `fetch`: Die Aufnahme liegt als Datei auf dem
        // Gerät, und der Hub will einen Rumpf. Das ist derselbe Weg, den
        // die App schon für Bilder nimmt.
        return await (await fetch(uri)).blob();
      } finally {
        await loslassen();
      }
    },
    abbrechen: () => {
      clearTimeout(frist);
      if (recorder.isRecording) recorder.stop().catch(() => undefined);
      loslassen();
    },
  };
}
