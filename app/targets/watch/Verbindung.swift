import Foundation
import WatchConnectivity

/// Die Zugangsdaten vom iPhone.
///
/// Eine eigene Anmeldung auf der Uhr gibt es nicht - ein 40-Zeichen-Token
/// am Digital-Crown drehen will niemand. Das Telefon schickt Adresse,
/// Token und die Haustüre als Anwendungs-Kontext herüber
/// (hooks/useWatchSync.ts auf der anderen Seite); hier wird er
/// entgegengenommen, in die UserDefaults gelegt und den Ansichten
/// gemeldet. Die UserDefaults, damit die Uhr auch nach einem Neustart
/// sofort arbeitsfähig ist, bevor das Telefon das nächste Mal funkt.
struct Zugang {
  var hubUrl = ""
  var token = ""
  var doorLabel = ""
  var doorPath = ""
  var doorBody = ""

  var bereit: Bool { !hubUrl.isEmpty && !token.isEmpty }
  var mitTuere: Bool { !doorPath.isEmpty }

  static let schluessel = ["hubUrl", "token", "doorLabel", "doorPath", "doorBody"]

  static func geladen() -> Zugang {
    let ablage = UserDefaults.standard
    return Zugang(
      hubUrl: ablage.string(forKey: "hubUrl") ?? "",
      token: ablage.string(forKey: "token") ?? "",
      doorLabel: ablage.string(forKey: "doorLabel") ?? "",
      doorPath: ablage.string(forKey: "doorPath") ?? "",
      doorBody: ablage.string(forKey: "doorBody") ?? ""
    )
  }
}

final class Verbindung: NSObject, ObservableObject, WCSessionDelegate {
  static let shared = Verbindung()

  @Published var zugang = Zugang.geladen()

  func starten() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    // Was das Telefon zuletzt geschickt hat, liegt hier schon bereit -
    // auch wenn es gerade in der Hosentasche schläft.
    uebernehmen(session.receivedApplicationContext)
  }

  func session(
    _ session: WCSession,
    didReceiveApplicationContext applicationContext: [String: Any]
  ) {
    uebernehmen(applicationContext)
  }

  private func uebernehmen(_ kontext: [String: Any]) {
    guard let url = kontext["hubUrl"] as? String, !url.isEmpty else { return }
    let ablage = UserDefaults.standard
    for name in Zugang.schluessel {
      ablage.set(kontext[name] as? String ?? "", forKey: name)
    }
    DispatchQueue.main.async {
      self.zugang = Zugang.geladen()
    }
  }
}
