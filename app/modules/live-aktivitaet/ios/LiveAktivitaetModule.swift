import ActivityKit
import ExpoModulesCore

// Die Brücke zwischen ActivityKit und der App (hooks/useLiveAktivitaet.ts).
//
// Sie tut bewusst wenig: Tokens beobachten und als Ereignisse melden.
// *Wann* eine Karte erscheint, entscheidet der Hub - die App könnte es
// gar nicht, denn im Moment des Weggehens läuft sie nicht im
// Vordergrund, und nur dort dürfte sie eine Aktivität selbst starten.
// Deshalb der Umweg über den «push-to-start»-Push (ab iOS 17.2, siehe
// hub/homepilot/core/liveaktivitaet.py).
public class LiveAktivitaetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiveAktivitaet")

    Events("onStartToken", "onActivityToken")

    // Kann dieses Telefon ferngestartete Live-Aktivitäten? Nein heisst:
    // zu altes iOS oder in den Einstellungen abgeschaltet - die App
    // zeigt die Funktion dann gar nicht erst.
    AsyncFunction("verfuegbar") { () -> Bool in
      guard #available(iOS 17.2, *) else { return false }
      return ActivityAuthorizationInfo().areActivitiesEnabled
    }

    // Beide Token-Quellen beobachten, solange die App lebt:
    //
    // - Das push-to-start-Token des Geräts. Damit *startet* der Hub die
    //   Karte. Apple stellt es aus und wechselt es gelegentlich - darum
    //   ein Strom statt einer einmaligen Abfrage.
    // - Je gestarteter Aktivität deren Update-Token. Damit *beendet*
    //   der Hub die Karte beim Heimkommen.
    Function("beobachten") {
      guard #available(iOS 17.2, *) else { return }
      Task {
        for await daten in Activity<TuerAktivitaetAttributes>.pushToStartTokenUpdates {
          self.sendEvent("onStartToken", ["token": hex(daten)])
        }
      }
      Task {
        for await aktivitaet in Activity<TuerAktivitaetAttributes>.activityUpdates {
          Task {
            for await daten in aktivitaet.pushTokenUpdates {
              self.sendEvent("onActivityToken", ["token": hex(daten)])
            }
          }
        }
      }
    }
  }
}

private func hex(_ daten: Data) -> String {
  // Apple liefert rohe Bytes; APNs will sie klein und hexadezimal.
  daten.map { String(format: "%02x", $0) }.joined()
}
