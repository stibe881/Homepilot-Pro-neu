/**
 * Aufnehmen auf dem Telefon und dem iPad.
 *
 * Das Gegenstück zum Browser-Weg in `sprachnotiz.ts`: Dort nimmt der
 * `MediaRecorder` auf, hier unser eigenes Modul `Aufnahme`
 * (modules/aufnahme). Herauskommt beide Male ein Blob, den der Hub auf
 * die Boxen legt.
 *
 * **Warum ein eigenes Modul und nicht `expo-audio`.** expo-audio hat
 * die App vom 29. bis 31. August auf jedem Gerät wortlos schwarz
 * starten lassen: Sein nativer Teil fasste schon beim App-Start die
 * AVAudioSession an, und gegen ein Hängen dort hilft kein
 * JavaScript-Netz (Werkbank-Punkt 223). Das eigene Modul ist um genau
 * eine Eigenschaft herum gebaut: Beim App-Start läuft dort nichts -
 * die Audio-Sitzung wird erst beim Druck auf den Aufnahmeknopf
 * angefasst. Die Aufnahme-Werte (AAC, mono, 22 kHz, 48 kbit/s - spielt
 * jede Cast-Box, eine Minute wiegt rund 350 KB) stehen jetzt im Swift.
 *
 * Diese Datei wird **nachgeladen** (`await import`), nicht oben
 * importiert - der Web-Bau und die Tests haben vom nativen Modul
 * nichts.
 */
import type { Aufnahme } from './sprachnotiz';

/** Die Schnittstelle von modules/aufnahme/ios/AufnahmeModule.swift. */
type AufnahmeModul = {
  erlaubnis(): Promise<boolean>;
  starten(): Promise<void>;
  stoppen(): Promise<string | null>;
  abbrechen(): Promise<void>;
};

/**
 * Aufnahme starten. Wirft mit einem Namen, den `aufnahmeFehler` kennt.
 *
 * Die Erlaubnis wird hier erfragt und nicht beim Start der App: Das
 * Fenster «HomePilot möchte auf das Mikrofon zugreifen» ergibt nur
 * einen Sinn, wenn man gerade den Aufnahmeknopf gedrückt hat.
 */
export async function starteNativ(hoechstensMs: number): Promise<Aufnahme> {
  let modul: AufnahmeModul;
  try {
    const { requireNativeModule } = await import('expo-modules-core');
    modul = requireNativeModule<AufnahmeModul>('Aufnahme');
  } catch {
    // Expo Go oder ein Build ohne das Modul - kein Mikrofon, kein Drama.
    const fehler = new Error('Kein Aufnahmemodul in diesem Build');
    fehler.name = 'NotFoundError';
    throw fehler;
  }

  const erteilt = await modul.erlaubnis();
  if (!erteilt) {
    const fehler = new Error('Mikrofon nicht freigegeben');
    fehler.name = 'NotAllowedError';
    throw fehler;
  }

  await modul.starten();

  const frist = setTimeout(() => {
    void modul.stoppen().catch(() => undefined);
  }, hoechstensMs);

  return {
    stopp: async () => {
      clearTimeout(frist);
      const uri = await modul.stoppen();
      if (!uri) return null;
      // Der Umweg über `fetch`: Die Aufnahme liegt als Datei auf dem
      // Gerät, und der Hub will einen Rumpf. Das ist derselbe Weg, den
      // die App schon für Bilder nimmt.
      return await (await fetch(uri)).blob();
    },
    abbrechen: () => {
      clearTimeout(frist);
      void modul.abbrechen().catch(() => undefined);
    },
  };
}
