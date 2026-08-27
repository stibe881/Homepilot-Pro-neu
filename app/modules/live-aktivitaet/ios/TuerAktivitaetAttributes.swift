import ActivityKit

// Die Beschreibung der Haustür-Karte auf dem Sperrbildschirm.
//
// Dieselbe Struktur steht wortgleich in der Widget-Erweiterung
// (targets/widget/index.swift) - App und Erweiterung sind getrennte
// Programme, und beide müssen den Typ kennen. Der Hub startet die Karte
// über einen APNs-Push, der den **Namen** dieser Struktur trägt
// (attributes-type in core/liveaktivitaet.py). Wer hier etwas umbenennt,
// muss es an allen drei Stellen tun, sonst verpufft der Push still.
@available(iOS 16.1, *)
struct TuerAktivitaetAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    // Bislang ungenutzt - da, damit sich der Inhalt später per Push
    // ändern lässt, ohne die Struktur (und damit die App) zu wechseln.
    var text: String
  }

  var tuer: String
}
