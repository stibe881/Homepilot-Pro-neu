import UserNotifications

/// Hängt das Kamerabild an eine eintreffende Push-Nachricht.
///
/// iOS zeigt eine Push-Nachricht an, lange bevor die App läuft. Ein Bild im
/// Banner kann deshalb nur hier entstehen: Das System startet diese
/// Erweiterung zwischen Empfang und Anzeige und gibt ihr eine knappe Frist,
/// um den Inhalt zu ergänzen.
///
/// Der Hub legt die Adresse unter `body._richContent.image` bei – so
/// verschickt der Expo-Dienst das Feld `richContent`. Dahinter steckt ein
/// einzelnes Standbild unter einer zufälligen, nach zehn Minuten toten
/// Adresse (siehe hub/homepilot/core/snapshots.py).
///
/// Grundsatz für alles hier drin: Jeder Fehlschlag endet in der
/// unveränderten Nachricht. Eine Meldung ohne Bild ist ein Schönheitsfehler
/// – eine Alarmmeldung, die gar nicht erscheint, wäre ein Sicherheitsloch.
class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var content: UNMutableNotificationContent?
  private var task: URLSessionDownloadTask?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    let mutable = request.content.mutableCopy() as? UNMutableNotificationContent
    self.content = mutable

    guard let content = mutable, let url = imageURL(from: request) else {
      contentHandler(request.content)
      return
    }

    task = URLSession.shared.downloadTask(with: url) { [weak self] location, response, _ in
      defer { self?.deliver() }
      guard
        let self = self,
        let location = location,
        let attachment = self.attachment(at: location, response: response)
      else { return }
      content.attachments = [attachment]
    }
    task?.resume()
  }

  /// Die Frist ist abgelaufen – lieber die Nachricht ohne Bild als gar keine.
  override func serviceExtensionTimeWillExpire() {
    task?.cancel()
    deliver()
  }

  /// Die Nachricht genau einmal ausliefern.
  ///
  /// Auf dem Hauptstrang, weil hier zwei Wege ankommen können: der fertige
  /// Download und die ablaufende Frist. Ohne diese Reihenfolge könnten
  /// beide gleichzeitig feststellen, dass noch nichts ausgeliefert wurde –
  /// und iOS den Handler zweimal bekommen.
  private func deliver() {
    DispatchQueue.main.async { [weak self] in
      guard let self = self, let handler = self.contentHandler, let content = self.content
      else { return }
      self.contentHandler = nil
      handler(content)
    }
  }

  private func imageURL(from request: UNNotificationRequest) -> URL? {
    guard
      let body = request.content.userInfo["body"] as? [String: Any],
      let rich = body["_richContent"] as? [String: Any],
      let address = rich["image"] as? String,
      let url = URL(string: address)
    else { return nil }
    return url
  }

  /// Die heruntergeladene Datei mit der richtigen Endung anhängen.
  ///
  /// Die Endung ist nicht kosmetisch: iOS erkennt den Typ daran und zeigt
  /// eine Datei ohne passende Endung schlicht nicht an. Sie kommt aus der
  /// Antwort des Servers und nicht aus der Adresse – in unserer Adresse
  /// steht nur eine Zufallskennung.
  private func attachment(
    at location: URL, response: URLResponse?
  ) -> UNNotificationAttachment? {
    let suffix = fileExtension(for: response)
    let target = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString + suffix)
    do {
      try FileManager.default.moveItem(at: location, to: target)
      return try UNNotificationAttachment(identifier: "kamera", url: target, options: nil)
    } catch {
      return nil
    }
  }

  private func fileExtension(for response: URLResponse?) -> String {
    switch response?.mimeType {
    case "image/png": return ".png"
    case "image/gif": return ".gif"
    default: return ".jpg"
    }
  }
}
