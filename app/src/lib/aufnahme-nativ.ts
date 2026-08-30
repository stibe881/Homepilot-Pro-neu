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
// `expo-audio` ist aus dem Build genommen - es war der Grund, warum die
// App vom 29. bis 31. August auf jedem Gerät wortlos schwarz startete
// (Werkbank-Punkt 223). Überführt per Ausschluss: Es war die einzige
// native Änderung zwischen dem letzten laufenden Build (29799716) und
// dem ersten schwarzen (29800133); Dateilisten, Manifest und Info.plist
// der beiden ipas waren sonst deckungsgleich, und ohne das Paket lief
// die App sofort wieder. Sein OnCreate fasst beim App-Start die
// AVAudioSession an - gegen ein natives Hängen dort hilft kein JS-Netz.
// Zurück darf es nur mit einer Fassung, die beim Start nichts anfasst,
// und über einen TestFlight-Probelauf. Der Typ steht bis dahin örtlich.
type RecordingOptions = Record<string, unknown>;

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
  void hoechstensMs;
  // Siehe Kopf der Datei: ohne expo-audio gibt es hier nichts zu starten.
  throw new Error('Durchsagen mit eigener Stimme sind zurzeit abgeschaltet - die Vorlesestimme geht weiter.');
}
