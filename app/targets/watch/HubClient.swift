import Foundation

/// Die drei Handgriffe gegen den Hub - direkt per HTTP.
///
/// Die Uhr fragt selbst beim Hub an (im WLAN direkt, unterwegs reicht
/// watchOS die Anfrage über das Telefon weiter). Kein eigener Zustand,
/// keine Wiederholungen: Jede Ansicht holt, was sie zeigt, wenn sie
/// erscheint - eine Uhr-App ist Sekunden offen, nicht Minuten.
enum HubFehler: Error {
  case antwort(Int)
}

/// Der Blick aufs Haus (GET /api/glance) - dieselbe kleine Antwort, die
/// auch das Homescreen-Widget bekommt.
struct Blick: Decodable {
  var doors_open: [String] = []
  var lights_on: Int = 0
  var alarm: String?

  private enum CodingKeys: String, CodingKey {
    case doors_open, lights_on, alarm
  }

  init() {}

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    doors_open = (try? container.decode([String].self, forKey: .doors_open)) ?? []
    lights_on = (try? container.decode(Int.self, forKey: .lights_on)) ?? 0
    alarm = try? container.decode(String.self, forKey: .alarm)
  }
}

/// Was aus dem Scharfschalten geworden ist (POST /api/alarm/arm).
///
/// Der Hub schaltet nicht blind: Steht ein Fenster offen oder meldet
/// ein Sensor nichts, kommt `ok: false` mit den Namen - und die gehören
/// auf die Uhr, nicht in den Papierkorb (Punkt 608 der Werkbank).
struct ScharfAntwort: Decodable {
  var ok: Bool = false
  var reason: String?
  // «offen» statt «open»: Das Wort ist in Swift ein Zugriffsmodifikator,
  // und als Feldname liest es sich zweimal falsch.
  var offen: [String] = []
  var offline: [String] = []
  var battery: [String] = []

  private enum CodingKeys: String, CodingKey {
    case ok, reason, offline, battery
    case offen = "open"
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    ok = (try? container.decode(Bool.self, forKey: .ok)) ?? false
    reason = try? container.decode(String.self, forKey: .reason)
    offen = (try? container.decode([String].self, forKey: .offen)) ?? []
    offline = (try? container.decode([String].self, forKey: .offline)) ?? []
    battery = (try? container.decode([String].self, forKey: .battery)) ?? []
  }

  /// Die eine Zeile für die Uhr - «Offen: Küche, Bad» oder «Stumm: Flur».
  var hinweis: String? {
    if ok { return nil }
    if !offen.isEmpty { return "Offen: " + offen.joined(separator: ", ") }
    let stumm = offline + battery
    if !stumm.isEmpty { return "Stumm: " + stumm.joined(separator: ", ") }
    return "Nicht scharf geschaltet."
  }
}

struct KuechenTimer: Decodable, Identifiable {
  var id: String
  var text: String
  /// Epoch-Sekunden - wie sie der Hub liefert (core/timers.py).
  var ends_at: Double
}

private struct TimerAntwort: Decodable {
  var timers: [KuechenTimer] = []
}

enum HubClient {
  private static func anfrage(
    _ zugang: Zugang, pfad: String, methode: String = "GET", body: Data? = nil
  ) -> URLRequest? {
    guard let url = URL(string: zugang.hubUrl + pfad) else { return nil }
    var request = URLRequest(url: url, timeoutInterval: 10)
    request.httpMethod = methode
    request.setValue("Bearer \(zugang.token)", forHTTPHeaderField: "Authorization")
    if body != nil {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = body
    }
    return request
  }

  private static func laden(_ request: URLRequest?) async throws -> Data {
    guard let request else { throw HubFehler.antwort(0) }
    let (daten, antwort) = try await URLSession.shared.data(for: request)
    let status = (antwort as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else { throw HubFehler.antwort(status) }
    return daten
  }

  static func blick(_ zugang: Zugang) async throws -> Blick {
    let daten = try await laden(anfrage(zugang, pfad: "/api/glance"))
    return try JSONDecoder().decode(Blick.self, from: daten)
  }

  static func timers(_ zugang: Zugang) async throws -> [KuechenTimer] {
    let daten = try await laden(anfrage(zugang, pfad: "/api/timers"))
    return try JSONDecoder().decode(TimerAntwort.self, from: daten).timers
  }

  static func timerStarten(_ zugang: Zugang, minuten: Int) async throws -> [KuechenTimer] {
    let body = try JSONSerialization.data(withJSONObject: ["minutes": minuten, "text": ""])
    let daten = try await laden(
      anfrage(zugang, pfad: "/api/timers", methode: "POST", body: body))
    return try JSONDecoder().decode(TimerAntwort.self, from: daten).timers
  }

  static func timerLoeschen(_ zugang: Zugang, id: String) async throws -> [KuechenTimer] {
    let daten = try await laden(
      anfrage(zugang, pfad: "/api/timers/\(id)", methode: "DELETE"))
    return try JSONDecoder().decode(TimerAntwort.self, from: daten).timers
  }

  /// Scharf schalten - und nur das (Punkt 608 der Werkbank). Unscharf
  /// gibt es auf der Uhr bewusst nicht, aus demselben Grund wie im
  /// Widget und im Auto (lib/widgetButtons.ts, Punkt 486): Scharf ist
  /// die harmlose Richtung - schlimmstenfalls steht die Anlage, wenn
  /// man sie nicht wollte. Unscharf am Handgelenk hiesse, wer die Uhr
  /// in der Hand hat, hebt die Anlage auf. Derselbe Modus wie beim
  /// Widget-Knopf «Scharf»; ohne `force`, damit der Hub offene Fenster
  /// meldet, statt loszulaufen.
  static func alarmScharf(_ zugang: Zugang) async throws -> ScharfAntwort {
    let body = try JSONSerialization.data(withJSONObject: ["mode": "ausser_haus"])
    let daten = try await laden(
      anfrage(zugang, pfad: "/api/alarm/arm", methode: "POST", body: body))
    return try JSONDecoder().decode(ScharfAntwort.self, from: daten)
  }

  /// Der Befehl kommt fertig vom Telefon (doorBody, JSON) - die Uhr
  /// entscheidet nicht selbst, was «öffnen» heisst. Eine Meinung dazu
  /// gibt es schon in der App; zwei wären eine zu viel.
  static func tuerOeffnen(_ zugang: Zugang) async throws {
    _ = try await laden(
      anfrage(
        zugang, pfad: zugang.doorPath, methode: "POST",
        body: zugang.doorBody.data(using: .utf8)))
  }
}
