import SwiftUI
import WidgetKit

// Widget für Homescreen und Sperrbildschirm.
//
// Zwei Dinge in einem: die drei Abkürzungen, für die man sonst die App
// öffnet – und der Blick aufs Haus, für den man sie ebenfalls öffnen
// müsste: Steht eine Türe offen? Was steht als Nächstes an?
//
// Die Adressen der Abkürzungen sind dieselben, die auch eine
// Push-Nachricht benutzt – die App kennt sie bereits.
//
// Woher die Daten kommen: Die App legt Adresse und Token in der
// geteilten App-Gruppe ab (siehe src/lib/widget.ts). Das Widget fragt
// damit /api/glance an – eine eigene, winzige Antwort statt der ganzen
// Geräteliste. Es läuft alle Viertelstunde auf einem Telefon, das gerade
// nichts anderes tut; was es nicht braucht, soll es nicht übertragen.
//
// Der Preis: Das Token liegt damit auch im Widget-Prozess. Früher stand
// hier, dass genau das die Sache nicht wert sei – für eine blosse
// Knopfleiste stimmte das auch. Für ein Widget, das «Türe offen» zeigt,
// ist die Abwägung eine andere. Wer sie anders trifft, schaltet den
// Inhalt in der App ab: Dann steht in der App-Gruppe nichts, und das
// Widget zeigt wieder nur die Abkürzungen.

let appGroup = "group.me.stibe.homepilot"

struct Shortcut {
    let title: String
    let symbol: String
    let url: URL
}

private let shortcuts: [Shortcut] = [
    Shortcut(
        title: "Haustüre",
        symbol: "key.fill",
        url: URL(string: "homepilot://door")!
    ),
    Shortcut(
        title: "Alles aus",
        symbol: "power",
        url: URL(string: "homepilot://alloff")!
    ),
    Shortcut(
        title: "Alarm",
        symbol: "shield.fill",
        url: URL(string: "homepilot://alarm")!
    ),
]

struct Glance {
    let doorsOpen: [String]
    let lightsOn: Int
    let nextEvent: String?
    /// Nichts erreicht. Dann zeigt das Widget das ausdrücklich an, statt
    /// den letzten Stand weiter als Tatsache auszugeben - eine veraltete
    /// Anzeige über eine offene Türe wäre schlimmer als gar keine.
    let ok: Bool

    static let leer = Glance(doorsOpen: [], lightsOn: 0, nextEvent: nil, ok: false)
}

func ladeGlance() async -> Glance {
    let defaults = UserDefaults(suiteName: appGroup)
    guard
        let base = defaults?.string(forKey: "hubUrl"),
        let token = defaults?.string(forKey: "hubToken"),
        let url = URL(string: base + "/api/glance")
    else {
        return .leer
    }

    var request = URLRequest(url: url)
    request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    // Kurz: Das Widget hat keine Zeit, auf ein Haus zu warten, das gerade
    // nicht da ist.
    request.timeoutInterval = 8

    do {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard
            let http = response as? HTTPURLResponse, http.statusCode == 200,
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return .leer
        }
        var termin: String? = nil
        if let event = json["next_event"] as? [String: Any] {
            termin = event["summary"] as? String
        }
        return Glance(
            doorsOpen: (json["doors_open"] as? [String]) ?? [],
            lightsOn: (json["lights_on"] as? Int) ?? 0,
            nextEvent: termin,
            ok: true
        )
    } catch {
        return .leer
    }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), glance: .leer)
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        Task { completion(Entry(date: Date(), glance: await ladeGlance())) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        Task {
            let glance = await ladeGlance()
            // Alle 15 Minuten: Häufiger lässt iOS ohnehin nicht zu, und für
            // «steht die Türe offen» ist es kein Alarm, sondern ein Blick im
            // Vorbeigehen. Wer es genau wissen will, tippt einmal.
            let nächste = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
            completion(
                Timeline(
                    entries: [Entry(date: Date(), glance: glance)],
                    policy: .after(nächste)
                )
            )
        }
    }
}

struct Entry: TimelineEntry {
    let date: Date
    let glance: Glance
}

struct StatusZeile: View {
    let glance: Glance

    var body: some View {
        if !glance.ok {
            Label("nicht erreichbar", systemImage: "wifi.slash")
                .font(.caption2)
                .foregroundStyle(.secondary)
        } else if !glance.doorsOpen.isEmpty {
            Label(
                glance.doorsOpen.count == 1
                    ? "\(glance.doorsOpen[0]) offen"
                    : "\(glance.doorsOpen.count) Türen offen",
                systemImage: "lock.open.fill"
            )
            .font(.caption)
            .foregroundStyle(.red)
        } else {
            Label(
                glance.lightsOn == 0
                    ? "Alles zu, kein Licht"
                    : "Alles zu · \(glance.lightsOn) Licht\(glance.lightsOn == 1 ? "" : "er")",
                systemImage: "lock.fill"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }
}

struct HomePilotWidgetView: View {
    @Environment(\.widgetFamily) var family
    var entry: Provider.Entry

    var body: some View {
        switch family {
        case .accessoryCircular:
            // Sperrbildschirm, rund: nur die Türe – mehr passt nicht. Das
            // Symbol sagt zugleich, ob sie zu ist.
            Link(destination: shortcuts[0].url) {
                Image(
                    systemName: entry.glance.doorsOpen.isEmpty
                        ? "lock.fill" : "lock.open.fill"
                )
                .font(.title2)
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                StatusZeile(glance: entry.glance)
                if let termin = entry.glance.nextEvent {
                    Text(termin)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        case .systemSmall:
            VStack(alignment: .leading, spacing: 8) {
                StatusZeile(glance: entry.glance)
                Spacer(minLength: 0)
                HStack(spacing: 14) {
                    ForEach(shortcuts.indices, id: \.self) { index in
                        Link(destination: shortcuts[index].url) {
                            Image(systemName: shortcuts[index].symbol)
                        }
                    }
                }
            }
            .padding(4)
        default:
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("HomePilot").font(.headline)
                    Spacer()
                    StatusZeile(glance: entry.glance)
                }
                if let termin = entry.glance.nextEvent {
                    Label(termin, systemImage: "calendar")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Divider()
                HStack(spacing: 18) {
                    ForEach(shortcuts.indices, id: \.self) { index in
                        Link(destination: shortcuts[index].url) {
                            VStack(spacing: 3) {
                                Image(systemName: shortcuts[index].symbol)
                                Text(shortcuts[index].title).font(.caption2)
                            }
                        }
                    }
                }
            }
            .padding(4)
        }
    }
}

@main
struct HomePilotWidget: Widget {
    let kind: String = "HomePilotWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            if #available(iOS 17.0, *) {
                HomePilotWidgetView(entry: entry)
                    .containerBackground(.fill.tertiary, for: .widget)
            } else {
                HomePilotWidgetView(entry: entry)
                    .padding()
            }
        }
        .configurationDisplayName("HomePilot")
        .description("Türstatus, nächster Termin – und die drei Knöpfe.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryCircular,
            .accessoryRectangular,
        ])
    }
}
