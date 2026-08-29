import SwiftUI

/// HomePilot am Handgelenk - bewusst nur drei Dinge.
///
/// Die Uhr ist für die Momente, in denen das Telefon in der Tasche
/// bleibt: vor der Türe mit vollen Händen, der Blick beim Rausgehen
/// («ist alles zu?»), der Timer mit Teigfingern in der Küche. Alles
/// Übrige - Räume, Szenen, Musik - gehört auf einen Bildschirm, der
/// grösser ist als eine Briefmarke.
@main
struct HomePilotWatchApp: App {
  @StateObject private var verbindung = Verbindung.shared

  init() {
    Verbindung.shared.starten()
  }

  var body: some Scene {
    WindowGroup {
      HauptView().environmentObject(verbindung)
    }
  }
}

struct HauptView: View {
  @EnvironmentObject var verbindung: Verbindung

  var body: some View {
    if verbindung.zugang.bereit {
      // Senkrechtes Blättern, wie es die Uhr von Haus aus tut: Blick,
      // Türe, Timer. Ohne Türe fällt die Seite einfach weg. Jede Seite
      // in ihrem eigenen Stack - nur dort zeigt die Uhr den Titel an.
      TabView {
        NavigationStack { BlickView() }
        if verbindung.zugang.mitTuere {
          NavigationStack { TuerView() }
        }
        NavigationStack { TimerView() }
      }
    } else {
      // Der Kontext kommt vom Telefon (Verbindung.swift) - bis dahin
      // gibt es nichts zu bedienen, und das soll die Uhr auch sagen.
      Text("Einmal HomePilot auf dem iPhone öffnen – die App schickt die Zugangsdaten herüber.")
        .font(.footnote)
        .multilineTextAlignment(.center)
        .padding()
    }
  }
}

// ── Der Blick: ist alles zu? ────────────────────────────────────────────

struct BlickView: View {
  @EnvironmentObject var verbindung: Verbindung
  @Environment(\.scenePhase) private var scenePhase
  @State private var blick: Blick?
  @State private var fehler = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 8) {
        if let blick {
          if blick.doors_open.isEmpty {
            Label("Alles zu", systemImage: "checkmark.circle.fill")
              .foregroundStyle(.green)
          } else {
            // Beim Rausgehen zählt, *was* offen ist, nicht wie viel -
            // deshalb die Namen und keine Zahl.
            Label("Offen", systemImage: "exclamationmark.triangle.fill")
              .foregroundStyle(.orange)
            ForEach(blick.doors_open, id: \.self) { name in
              Text(name).font(.footnote).foregroundStyle(.secondary)
            }
          }
          Label(
            blick.lights_on == 0
              ? "Kein Licht an"
              : blick.lights_on == 1 ? "1 Licht an" : "\(blick.lights_on) Lichter an",
            systemImage: "lightbulb"
          )
          if let alarm = blick.alarm {
            Label(alarmWort(alarm), systemImage: "shield")
          }
        } else if fehler {
          Text("Hub nicht erreichbar.").font(.footnote).foregroundStyle(.secondary)
        } else {
          ProgressView()
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .navigationTitle("Zuhause")
    .task { await laden() }
    .onChange(of: scenePhase) { neu in
      // Beim Heben des Handgelenks frisch nachsehen - ein Blick von
      // vorhin ist genau der, dem man nicht trauen darf.
      if neu == .active { Task { await laden() } }
    }
  }

  private func laden() async {
    do {
      blick = try await HubClient.blick(verbindung.zugang)
      fehler = false
    } catch {
      fehler = blick == nil
    }
  }

  private func alarmWort(_ stand: String) -> String {
    switch stand {
    case "scharf": return "Alarm scharf"
    case "scharfschaltend": return "Alarm schaltet scharf"
    case "ausgeloest": return "Alarm ausgelöst!"
    default: return "Alarm unscharf"
    }
  }
}

// ── Die Haustüre ────────────────────────────────────────────────────────

struct TuerView: View {
  @EnvironmentObject var verbindung: Verbindung
  @State private var frage = false
  @State private var laeuft = false
  @State private var meldung: String?

  var body: some View {
    VStack(spacing: 10) {
      Button {
        frage = true
      } label: {
        VStack(spacing: 6) {
          Image(systemName: "key.fill").font(.title2)
          Text(verbindung.zugang.doorLabel.isEmpty ? "Türe" : verbindung.zugang.doorLabel)
            .font(.headline)
          Text("Öffnen").font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 90)
      }
      .disabled(laeuft)
      if let meldung {
        Text(meldung).font(.footnote).foregroundStyle(.secondary)
      }
    }
    // Dieselbe Hürde wie in der App: Eine Türe öffnet nie auf den ersten
    // Tipp - am Handgelenk streift man Knöpfe schneller, als man schaut.
    .confirmationDialog("Wirklich öffnen?", isPresented: $frage) {
      Button("Öffnen", role: .destructive) {
        Task { await oeffnen() }
      }
      Button("Abbrechen", role: .cancel) {}
    }
    .navigationTitle("Türe")
  }

  private func oeffnen() async {
    laeuft = true
    meldung = nil
    do {
      try await HubClient.tuerOeffnen(verbindung.zugang)
      meldung = "Offen."
    } catch {
      meldung = "Hat nicht geklappt."
    }
    laeuft = false
  }
}

// ── Die Küchen-Timer ────────────────────────────────────────────────────

struct TimerView: View {
  @EnvironmentObject var verbindung: Verbindung
  @Environment(\.scenePhase) private var scenePhase
  @State private var timers: [KuechenTimer] = []
  @State private var geladen = false

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        ForEach(timers) { timer in
          Button {
            // Antippen bricht ab - ein Timer, den man auf der Uhr
            // ansieht, ist meistens einer, den man loswerden will.
            Task { await loeschen(timer.id) }
          } label: {
            HStack {
              VStack(alignment: .leading) {
                // Zählt von selbst herunter, ohne dass die Uhr jede
                // Sekunde beim Hub anfragen müsste. `max`, weil ein
                // eben abgelaufener Timer sonst einen ungültigen
                // Bereich ergäbe - und der stürzt ab statt «0:00».
                Text(
                  timerInterval: Date.now...max(
                    Date(timeIntervalSince1970: timer.ends_at), Date.now),
                  countsDown: true
                )
                .font(.headline)
                Text(timer.text).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
              }
              Spacer()
              Image(systemName: "xmark.circle").foregroundStyle(.secondary)
            }
          }
        }
        if geladen && timers.isEmpty {
          Text("Kein Timer läuft.").font(.footnote).foregroundStyle(.secondary)
        }
        // Die drei Griffe aus der Küche - wer etwas anderes braucht,
        // hat das Telefon ohnehin neben dem Kochbuch liegen.
        HStack {
          ForEach([5, 10, 15], id: \.self) { minuten in
            Button("\(minuten)′") {
              Task { await starten(minuten) }
            }
          }
        }
      }
    }
    .navigationTitle("Timer")
    .task { await laden() }
    .onChange(of: scenePhase) { neu in
      if neu == .active { Task { await laden() } }
    }
  }

  private func laden() async {
    if let neu = try? await HubClient.timers(verbindung.zugang) {
      timers = neu
      geladen = true
    }
  }

  private func starten(_ minuten: Int) async {
    if let neu = try? await HubClient.timerStarten(verbindung.zugang, minuten: minuten) {
      timers = neu
    }
  }

  private func loeschen(_ id: String) async {
    if let neu = try? await HubClient.timerLoeschen(verbindung.zugang, id: id) {
      timers = neu
    }
  }
}
