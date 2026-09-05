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

    // Beide Token-Quellen beobachten, solange die App lebt - und das
    // für beide Kartentypen (Apple stellt die Start-Tokens je
    // Strukturtyp aus):
    //
    // - Das push-to-start-Token des Geräts. Damit *startet* der Hub
    //   eine Karte. Apple wechselt es gelegentlich - darum ein Strom
    //   statt einer einmaligen Abfrage.
    // - Je gestarteter Aktivität deren Update-Token. Damit aktualisiert
    //   und beendet der Hub die Karte. Bei den generischen Karten kommt
    //   die `art` mit, damit der Hub weiss, zu welcher sie gehört.
    Function("beobachten") {
      guard #available(iOS 17.2, *) else { return }
      // Aufräumen, bevor beobachtet wird: Karten, die beim Öffnen der
      // App schon liegen. `activityUpdates` unten meldet nur *neue*
      // Aktivitäten - eine, die gestartet wurde, während die App
      // nicht lief, hätte ihr Token sonst nie gemeldet. Genau daran
      // hingen die doppelten Türkarten: Der Hub konnte die alte ohne
      // Token nicht beenden, und die nächste Fahrt legte eine zweite
      // darüber. Doppelte (mehr als eine Tür-Karte, mehr als eine
      // Haus-Karte derselben Art) sind wortgleich - alle bis auf eine
      // enden sofort; die übrige meldet ihr Token, damit der Hub sie
      // später beenden kann.
      Task {
        let tueren = Activity<TuerAktivitaetAttributes>.activities
        for doppel in tueren.dropFirst() {
          await doppel.end(nil, dismissalPolicy: .immediate)
        }
        if let karte = tueren.first {
          if let token = karte.pushToken {
            self.sendEvent("onActivityToken", ["token": hex(token), "typ": "tuer"])
          }
          for await daten in karte.pushTokenUpdates {
            self.sendEvent("onActivityToken", ["token": hex(daten), "typ": "tuer"])
          }
        }
      }
      Task {
        var gesehen = Set<String>()
        for karte in Activity<HausAktivitaetAttributes>.activities {
          if gesehen.contains(karte.attributes.art) {
            await karte.end(nil, dismissalPolicy: .immediate)
            continue
          }
          gesehen.insert(karte.attributes.art)
          if let token = karte.pushToken {
            self.sendEvent(
              "onActivityToken",
              ["token": hex(token), "typ": "haus", "art": karte.attributes.art]
            )
          }
          Task {
            for await daten in karte.pushTokenUpdates {
              self.sendEvent(
                "onActivityToken",
                ["token": hex(daten), "typ": "haus", "art": karte.attributes.art]
              )
            }
          }
        }
      }
      Task {
        for await daten in Activity<TuerAktivitaetAttributes>.pushToStartTokenUpdates {
          self.sendEvent("onStartToken", ["token": hex(daten), "typ": "tuer"])
        }
      }
      Task {
        for await aktivitaet in Activity<TuerAktivitaetAttributes>.activityUpdates {
          Task {
            for await daten in aktivitaet.pushTokenUpdates {
              self.sendEvent("onActivityToken", ["token": hex(daten), "typ": "tuer"])
            }
          }
        }
      }
      Task {
        for await daten in Activity<HausAktivitaetAttributes>.pushToStartTokenUpdates {
          self.sendEvent("onStartToken", ["token": hex(daten), "typ": "haus"])
        }
      }
      Task {
        for await aktivitaet in Activity<HausAktivitaetAttributes>.activityUpdates {
          Task {
            for await daten in aktivitaet.pushTokenUpdates {
              self.sendEvent(
                "onActivityToken",
                ["token": hex(daten), "typ": "haus", "art": aktivitaet.attributes.art]
              )
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
