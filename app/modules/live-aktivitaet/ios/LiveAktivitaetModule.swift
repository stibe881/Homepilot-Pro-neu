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
//
// **Warum sofort beim Start beobachtet wird.** Startet der Hub eine
// Karte per Push, während die App nicht läuft, weckt iOS die App kurz
// auf und gibt ihr Rechenzeit - genau dafür: damit sie das Token der
// neuen Aktivität abholen und weitergeben kann. Nur mit diesem Token
// kann der Hub die Karte später wieder *beenden*. Bisher fing das
// Beobachten erst an, wenn der Bildschirm stand und die Verbindung zum
// Hub hielt; in diesem Weckfenster passiert beides nicht. Ergebnis: Der
// Fernseher ging aus, der Hub wollte die Karte beenden, hatte aber nie
// ein Token - und die Karte lag stundenlang auf dem Sperrbildschirm,
// bis jemand die App öffnete.
//
// Dass ein `OnCreate` gefährlich sein kann, steht in AufnahmeModule
// (Punkt 223 der Werkbank): `expo-audio` fasste dort beim App-Start die
// Audio-Sitzung an und liess die App schwarz starten. Hier wird beim
// Start **nichts** eingerichtet, was schiefgehen könnte - nur Tasks, die
// auf Apples Ströme warten, hinter `#available(iOS 17.2, *)`.
public class LiveAktivitaetModule: Module {
  /// Tokens, die kamen, bevor JS zuhörte. `sendEvent` ohne Zuhörer
  /// verpufft - und beim Wecken im Hintergrund läuft der Hook noch
  /// nicht. Also aufheben und beim ersten `offeneTokens()` nachreichen.
  private var offen: [[String: String]] = []
  private let schloss = NSLock()
  /// Läuft die Beobachtung schon? `beobachten()` darf mehrmals kommen
  /// (jeder Anmelde-Wechsel ruft es), soll aber nicht jedes Mal einen
  /// weiteren Satz Tasks auf dieselben Ströme setzen.
  private var laeuft = false

  public func definition() -> ModuleDefinition {
    Name("LiveAktivitaet")

    Events("onStartToken", "onActivityToken")

    // Sobald es die App gibt - auch wenn iOS sie nur kurz weckt.
    OnCreate { self.starten() }

    // Kann dieses Telefon ferngestartete Live-Aktivitäten? Nein heisst:
    // zu altes iOS oder in den Einstellungen abgeschaltet - die App
    // zeigt die Funktion dann gar nicht erst.
    AsyncFunction("verfuegbar") { () -> Bool in
      guard #available(iOS 17.2, *) else { return false }
      return ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Was gemeldet wurde, bevor JS zuhörte - einmal abholen und weg.
    AsyncFunction("offeneTokens") { () -> [[String: String]] in
      self.schloss.lock()
      defer { self.schloss.unlock() }
      let liste = self.offen
      self.offen = []
      return liste
    }

    Function("beobachten") { self.starten() }
  }

  /// Ein Token melden - an JS, wenn dort jemand zuhört, und in die
  /// Ablage, damit es auch sonst nicht verlorengeht. Doppelt gemeldet
  /// schadet nichts: Der Hub ersetzt Start-Tokens je Telefon und legt
  /// dasselbe Aktivitäts-Token kein zweites Mal ab (token_merken).
  private func melden(_ ereignis: String, _ daten: [String: String]) {
    schloss.lock()
    offen.append(daten.merging(["ereignis": ereignis]) { alt, _ in alt })
    // Eine Karte, die nie abgeholt wird, soll den Speicher nicht füllen.
    if offen.count > 20 { offen.removeFirst(offen.count - 20) }
    schloss.unlock()
    sendEvent(ereignis, daten)
  }

  /// Beide Token-Quellen beobachten, solange die App lebt - und das für
  /// beide Kartentypen (Apple stellt die Start-Tokens je Strukturtyp
  /// aus):
  ///
  /// - Das push-to-start-Token des Geräts. Damit *startet* der Hub eine
  ///   Karte. Apple wechselt es gelegentlich - darum ein Strom statt
  ///   einer einmaligen Abfrage.
  /// - Je gestarteter Aktivität deren Update-Token. Damit aktualisiert
  ///   und beendet der Hub die Karte. Bei den generischen Karten kommt
  ///   die `art` mit, damit der Hub weiss, zu welcher sie gehört.
  private func starten() {
    guard #available(iOS 17.2, *) else { return }
    schloss.lock()
    let schon = laeuft
    laeuft = true
    schloss.unlock()
    if schon { return }

    // Aufräumen, bevor beobachtet wird: Karten, die beim Start der App
    // schon liegen. `activityUpdates` unten meldet nur *neue*
    // Aktivitäten - eine, die gestartet wurde, während die App nicht
    // lief, hätte ihr Token sonst nie gemeldet. Genau daran hingen die
    // doppelten Türkarten: Der Hub konnte die alte ohne Token nicht
    // beenden, und die nächste Fahrt legte eine zweite darüber.
    // Doppelte (mehr als eine Tür-Karte, mehr als eine Haus-Karte
    // derselben Art) sind wortgleich - alle bis auf eine enden sofort;
    // die übrige meldet ihr Token, damit der Hub sie später beenden
    // kann.
    Task {
      let tueren = Activity<TuerAktivitaetAttributes>.activities
      for doppel in tueren.dropFirst() {
        await doppel.end(nil, dismissalPolicy: .immediate)
      }
      if let karte = tueren.first {
        if let token = karte.pushToken {
          self.melden("onActivityToken", ["token": hex(token), "typ": "tuer"])
        }
        for await daten in karte.pushTokenUpdates {
          self.melden("onActivityToken", ["token": hex(daten), "typ": "tuer"])
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
          self.melden(
            "onActivityToken",
            ["token": hex(token), "typ": "haus", "art": karte.attributes.art]
          )
        }
        Task {
          for await daten in karte.pushTokenUpdates {
            self.melden(
              "onActivityToken",
              ["token": hex(daten), "typ": "haus", "art": karte.attributes.art]
            )
          }
        }
      }
    }
    Task {
      for await daten in Activity<TuerAktivitaetAttributes>.pushToStartTokenUpdates {
        self.melden("onStartToken", ["token": hex(daten), "typ": "tuer"])
      }
    }
    Task {
      for await aktivitaet in Activity<TuerAktivitaetAttributes>.activityUpdates {
        Task {
          for await daten in aktivitaet.pushTokenUpdates {
            self.melden("onActivityToken", ["token": hex(daten), "typ": "tuer"])
          }
        }
      }
    }
    Task {
      for await daten in Activity<HausAktivitaetAttributes>.pushToStartTokenUpdates {
        self.melden("onStartToken", ["token": hex(daten), "typ": "haus"])
      }
    }
    Task {
      for await aktivitaet in Activity<HausAktivitaetAttributes>.activityUpdates {
        // Frisch per Push gestartet: Das Token kann schon dastehen,
        // bevor der Strom das erste Mal etwas schickt. Wer nur auf den
        // Strom wartet, verpasst dieses eine - und genau daran hing die
        // Karte, die der Hub nie beenden konnte.
        if let token = aktivitaet.pushToken {
          self.melden(
            "onActivityToken",
            ["token": hex(token), "typ": "haus", "art": aktivitaet.attributes.art]
          )
        }
        Task {
          for await daten in aktivitaet.pushTokenUpdates {
            self.melden(
              "onActivityToken",
              ["token": hex(daten), "typ": "haus", "art": aktivitaet.attributes.art]
            )
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
