import AVFoundation
import ExpoModulesCore

/// Sprachaufnahme für Durchsagen - der Ersatz für `expo-audio`.
///
/// `expo-audio` hat die App vom 29. bis 31. August auf jedem Gerät
/// wortlos schwarz starten lassen: Sein `OnCreate` fasste schon beim
/// App-Start die AVAudioSession an (Werkbank-Punkt 223). Dieses Modul
/// ist deshalb um genau eine Eigenschaft herum gebaut: **Beim App-Start
/// läuft hier nichts.** Kein `OnCreate`, keine Beobachter, kein
/// AVAudioSession-Zugriff - alles passiert erst, wenn jemand den
/// Aufnahmeknopf drückt.
///
/// Die Aufnahme-Werte entsprechen denen, die vorher in
/// `lib/aufnahme-nativ.ts` standen, und aus demselben Grund: AAC in
/// einem MP4-Rumpf, mono, 22 kHz, 48 kbit/s. Das spielt jede
/// Google-Cast-Box (der Hub erkennt es am `ftyp`, siehe
/// hub/core/sprachnotiz.py), und eine Minute wiegt rund 350 KB.
public class AufnahmeModule: Module {
  private var recorder: AVAudioRecorder?

  public func definition() -> ModuleDefinition {
    Name("Aufnahme")

    // Die Erlaubnis wird hier erfragt und nicht beim Start der App: Das
    // Fenster «HomePilot möchte auf das Mikrofon zugreifen» ergibt nur
    // einen Sinn, wenn man gerade den Aufnahmeknopf gedrückt hat.
    AsyncFunction("erlaubnis") { (promise: Promise) in
      AVAudioSession.sharedInstance().requestRecordPermission { erteilt in
        promise.resolve(erteilt)
      }
    }

    // Aufnahme starten. Erst hier wird die AVAudioSession angefasst -
    // scheitert sie, kommt ein Fehler zum JS statt eines Hängers beim
    // Start. `.playAndRecord` statt `.record`: Nach der Aufnahme soll
    // die App weiter Ton ausgeben können, ohne die Session zu wechseln.
    AsyncFunction("starten") { () -> Void in
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
      try session.setActive(true)

      let ablage = FileManager.default.temporaryDirectory
        .appendingPathComponent("durchsage-\(UUID().uuidString).m4a")
      let werte: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
        AVSampleRateKey: 22050,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 48000,
      ]
      let neu = try AVAudioRecorder(url: ablage, settings: werte)
      neu.record()
      self.recorder = neu
    }

    // Aufnahme beenden; liefert den Datei-Pfad oder nil, wenn keine
    // lief. Die Session wird wieder freigegeben - sonst bleibt oben der
    // rote Balken stehen, und es sieht aus, als höre die App weiter zu.
    AsyncFunction("stoppen") { () -> String? in
      guard let laufend = self.recorder else { return nil }
      laufend.stop()
      self.recorder = nil
      try? AVAudioSession.sharedInstance().setActive(
        false, options: [.notifyOthersOnDeactivation])
      return laufend.url.absoluteString
    }

    // Abbrechen: beenden, Datei wegräumen, Session freigeben.
    AsyncFunction("abbrechen") { () -> Void in
      guard let laufend = self.recorder else { return }
      laufend.stop()
      self.recorder = nil
      try? FileManager.default.removeItem(at: laufend.url)
      try? AVAudioSession.sharedInstance().setActive(
        false, options: [.notifyOthersOnDeactivation])
    }
  }
}
