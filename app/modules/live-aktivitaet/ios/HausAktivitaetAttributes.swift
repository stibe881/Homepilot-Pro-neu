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
    /// Die grosse Zahl links, z.B. «104°C» (Punkt 553). Nur der Grill
    /// setzt sie; ohne sie bleibt die Karte die schmale Zeile, die
    /// Timer, Waschmaschine und Sauger brauchen.
    var gross: String?
    /// Kreise rechts, z.B. die vier Fleischfühler des Grills.
    var werte: [KartenWert]?
    /// Der Griff unten in der Mitte, z.B. «Timer stellen» beim Grill
    /// (Punkt 556). Eine Adresse, kein Befehl: Er öffnet die App an
    /// der richtigen Stelle, statt am Hub etwas zu schalten.
    var link: KartenLink?
  }

  /// Ein Griff, der in die App führt: SF-Symbol, Beschriftung, Adresse.
  public struct KartenLink: Codable, Hashable {
    var symbol: String
    var text: String
    var url: String
  }

  /// Ein Kreis auf der Karte: die Nummer des Fühlers, sein Wert und die
  /// Farbe, die der Hub ihm fest zugeteilt hat (core/livekarten.py,
  /// FUEHLERFARBEN). Die Zuteilung bleibt beim Hub, damit Fühler 2 am
  /// Montag derselbe ist wie am Sonntag.
  public struct KartenWert: Codable, Hashable {
    var nummer: String
    var wert: String
    var farbe: String?
    /// 0…1: wie weit der Ring aufs Ziel zu gewachsen ist (Punkt 570).
    /// Ohne Ziel fehlt das Feld, und der Ring ist voll.
    var anteil: Double?
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
