import ExpoModulesCore
import WatchConnectivity

/// Zugangsdaten zur Apple Watch schicken (WatchConnectivity).
///
/// `updateApplicationContext` ist bewusst der einzige Weg: Er überträgt
/// «den letzten Stand» statt einer Nachrichten-Warteschlange - genau
/// richtig für Zugangsdaten, von denen nur die aktuelle Fassung zählt.
/// Die Uhr bekommt ihn auch, wenn sie gerade nicht erreichbar ist, beim
/// nächsten Kontakt von selbst.
///
/// Die Session aktiviert asynchron; ein Kontext, der vor dem Abschluss
/// ankommt, wird gemerkt und beim `activationDidComplete` nachgereicht -
/// sonst ginge ausgerechnet der erste Versuch nach dem App-Start verloren.
final class WatchVerbindungDelegate: NSObject, WCSessionDelegate {
  static let shared = WatchVerbindungDelegate()
  var ausstehend: [String: Any]?

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    guard activationState == .activated, let kontext = ausstehend else { return }
    ausstehend = nil
    try? session.updateApplicationContext(kontext)
  }

  // Auf dem iPhone Pflichtteile des Protokolls: Beim Wechsel auf eine
  // andere gekoppelte Uhr wird die Session neu aktiviert.
  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }
}

public class WatchVerbindungModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WatchVerbindung")

    // Kontext zur Uhr schicken. Keine gekoppelte Uhr ist kein Fehler,
    // sondern der Normalfall - dann kommt `false` zurück und gut.
    AsyncFunction("senden") { (kontext: [String: Any]) -> Bool in
      guard WCSession.isSupported() else { return false }
      let session = WCSession.default
      if session.delegate == nil {
        session.delegate = WatchVerbindungDelegate.shared
      }
      switch session.activationState {
      case .activated:
        // Ein unveränderter Kontext wirft hier - das JS schickt zwar nur
        // Änderungen, aber nach einem App-Neustart kennt es den letzten
        // Stand nicht. Der Fehler ist dann bedeutungslos.
        try? session.updateApplicationContext(kontext)
        return session.isPaired
      default:
        WatchVerbindungDelegate.shared.ausstehend = kontext
        session.activate()
        return true
      }
    }
  }
}
