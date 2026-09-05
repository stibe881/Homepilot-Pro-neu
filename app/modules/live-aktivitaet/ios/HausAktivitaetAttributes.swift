import ActivityKit

// Die generische Karte auf dem Sperrbildschirm - eine Form, viele
// Inhalte: Küchen-Timer, Waschmaschine, Grill, Sauger, Erinnerung,
// Alarmanlage. Was daraufsteht, entscheidet allein der Hub
// (core/livekarten.py); deshalb ist hier alles Inhalt, nichts Logik.
//
// Wortgleich in der Widget-Erweiterung (targets/widget/index.swift) -
// App und Erweiterung sind getrennte Programme, und der Start-Push
// trägt den Namen dieser Struktur.
@available(iOS 16.1, *)
struct HausAktivitaetAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var titel: String
    var text: String
    /// SF-Symbol-Name, z.B. "timer", "washer", "flame".
    var symbol: String
    /// "rot" oder "orange" färbt die Karte - für Alarm und Erinnerung.
    var farbe: String?
    /// Unix-Sekunden: Bis dahin zählt die Karte selbst herunter -
    /// dafür braucht es keinen einzigen weiteren Push.
    var endet: Double?
    /// 0…1 für den Fortschrittsbalken (Grill: wie nah am Ziel).
    var fortschritt: Double?
    /// Wohin ein Tipp auf die Karte führt (homepilot://…).
    var url: String?
    /// Knöpfe direkt auf der Karte (Sauger: Pause/Weiter, zur Station).
    /// Optional und vom Hub bestimmt - eine alte App-Hülle überliest
    /// das Feld einfach (Codable ignoriert unbekannte Schlüssel).
    var knoepfe: [KartenKnopf]?
  }

  /// Ein Knopf auf der Karte: SF-Symbol plus dem, was er beim Hub
  /// auslöst. Das Widget versteht den Inhalt nicht - es ruft nur auf,
  /// was der Hub ihm hingelegt hat (dieselbe Arbeitsteilung wie bei
  /// den Widget-Knöpfen, targets/widget: SchaltIntent).
  public struct KartenKnopf: Codable, Hashable {
    var symbol: String
    var pfad: String
    var body: String?
  }

  /// Eindeutige Kennung der Karte, z.B. "timer:abc" - die App meldet
  /// sie mit dem Aktivitäts-Token zurück, damit der Hub die richtige
  /// Karte aktualisiert und beendet.
  var art: String
}
