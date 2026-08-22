import SwiftUI
import WidgetKit

// Widget für Homescreen und Sperrbildschirm.
//
// Zwei Dinge in einem: die Abkürzungen, für die man sonst die App öffnet
// – und der Blick aufs Haus, für den man sie ebenfalls öffnen müsste:
// Steht eine Türe offen? Was steht als Nächstes an?
//
// Beides kommt aus der geteilten App-Gruppe (siehe src/lib/widget.ts),
// aber unter verschiedenen Bedingungen:
//
// - Die **Knöpfe** liegen immer dort. Welche es sind, stellt man in der
//   App unter Einstellungen → Widgets zusammen; hier steht nur, wie sie
//   gezeichnet werden. Fehlen sie – frisch installiert, App noch nicht
//   geöffnet –, zeigt das Widget die drei, mit denen jeder anfängt.
// - **Adresse und Token** nur, wenn der Hausstand eingeschaltet ist.
//   Damit fragt das Widget /api/glance an – eine eigene, winzige Antwort
//   statt der ganzen Geräteliste. Es läuft alle Viertelstunde auf einem
//   Telefon, das gerade nichts anderes tut; was es nicht braucht, soll
//   es nicht übertragen.
//
// Der Preis des zweiten Teils: Das Token liegt damit auch im
// Widget-Prozess. Für eine blosse Knopfleiste wäre das die Sache nicht
// wert; für ein Widget, das «Türe offen» zeigt, ist die Abwägung eine
// andere. Wer sie anders trifft, lässt den Schalter aus – dann steht
// dort kein Token, und das Widget zeigt nur die Knöpfe. Genau deshalb
// unterscheidet die Statuszeile «abgeschaltet» von «nicht erreichbar»:
// Das eine ist eine Entscheidung, das andere eine Störung.

let appGroup = "group.me.stibe.homepilot"

struct Shortcut: Decodable {
    /// Wofür der Knopf steht – 'door', 'alloff', 'alarm', 'scene:…',
    /// 'entity:…'. Das Widget wertet ihn nur an einer Stelle aus: Auf
    /// dem runden Sperrbildschirm-Widget zeigt die Türe, ob sie zu ist.
    let key: String
    let title: String
    let symbol: String
    let url: URL
}

/// Womit jeder anfängt, solange die App nichts hinterlegt hat.
private let standardShortcuts: [Shortcut] = [
    Shortcut(
        key: "door",
        title: "Haustüre",
        symbol: "key.fill",
        url: URL(string: "homepilot://door")!
    ),
    Shortcut(
        key: "alloff",
        title: "Alles aus",
        symbol: "power",
        url: URL(string: "homepilot://alloff")!
    ),
    Shortcut(
        key: "alarm",
        title: "Alarm",
        symbol: "shield.fill",
        url: URL(string: "homepilot://alarm")!
    ),
]

func ladeShortcuts() -> [Shortcut] {
    guard
        let roh = UserDefaults(suiteName: appGroup)?.string(forKey: "buttons"),
        let daten = roh.data(using: .utf8),
        let gelesen = try? JSONDecoder().decode([Shortcut].self, from: daten),
        !gelesen.isEmpty
    else {
        return standardShortcuts
    }
    // Vier ist das Höchstmass der App. Hier noch einmal, weil die Ablage
    // aus einer älteren Fassung stammen könnte - und fünf Knöpfe würden
    // auf der kleinen Grösse ineinanderlaufen.
    return Array(gelesen.prefix(4))
}

/// Wie es um den Hausstand steht.
///
/// Drei Fälle, und sie auseinanderzuhalten ist der halbe Zweck: «aus»
/// ist eine Entscheidung in der App, «nichtErreicht» eine Störung. Beide
/// als «nicht erreichbar» anzuzeigen hiesse, jedem frisch angelegten
/// Widget einen Fehler unterzuschieben, den es nicht gibt.
enum Hausstand {
    case aus
    case nichtErreicht
    case da(doorsOpen: [String], lightsOn: Int, nextEvent: String?, alarm: String?)
}

func ladeGlance() async -> Hausstand {
    let defaults = UserDefaults(suiteName: appGroup)
    guard
        let base = defaults?.string(forKey: "hubUrl"),
        let token = defaults?.string(forKey: "hubToken"),
        let url = URL(string: base + "/api/glance")
    else {
        return .aus
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
            return .nichtErreicht
        }
        var termin: String? = nil
        if let event = json["next_event"] as? [String: Any] {
            termin = event["summary"] as? String
        }
        // Der Alarmzustand kam schon immer mit und wurde weggeworfen –
        // dabei ist «habe ich scharf geschaltet?» genau die Frage, für
        // die man ein Sperrbildschirm-Widget anlegt.
        return .da(
            doorsOpen: (json["doors_open"] as? [String]) ?? [],
            lightsOn: (json["lights_on"] as? Int) ?? 0,
            nextEvent: termin,
            alarm: json["alarm"] as? String
        )
    } catch {
        return .nichtErreicht
    }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), glance: .aus, shortcuts: standardShortcuts)
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        Task {
            completion(
                Entry(date: Date(), glance: await ladeGlance(), shortcuts: ladeShortcuts())
            )
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        Task {
            let glance = await ladeGlance()
            let knöpfe = ladeShortcuts()
            // Alle 15 Minuten: Häufiger lässt iOS ohnehin nicht zu, und für
            // «steht die Türe offen» ist es kein Alarm, sondern ein Blick im
            // Vorbeigehen. Wer es genau wissen will, tippt einmal.
            let nächste = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
            completion(
                Timeline(
                    entries: [Entry(date: Date(), glance: glance, shortcuts: knöpfe)],
                    policy: .after(nächste)
                )
            )
        }
    }
}

struct Entry: TimelineEntry {
    let date: Date
    let glance: Hausstand
    let shortcuts: [Shortcut]

    /// Fürs runde Sperrbildschirm-Widget: Steht etwas offen?
    var etwasOffen: Bool {
        if case .da(let türen, _, _, _) = glance { return !türen.isEmpty }
        return false
    }

    var termin: String? {
        if case .da(_, _, let termin, _) = glance { return termin }
        return nil
    }
}

struct StatusZeile: View {
    let glance: Hausstand

    var body: some View {
        switch glance {
        case .aus:
            // Kein Fehler, sondern der Auslieferungszustand: Der Hausstand
            // ist in der App nicht eingeschaltet. Das hier hinzuschreiben
            // ist der ganze Unterschied zwischen «du musst etwas tun» und
            // «etwas ist kaputt».
            Label("in der App einschalten", systemImage: "switch.2")
                .font(.caption2)
                .foregroundStyle(.secondary)
        case .nichtErreicht:
            // Eingeschaltet, aber nichts bekommen. Dann sagt das Widget
            // das ausdrücklich, statt den letzten Stand weiter als
            // Tatsache auszugeben - eine veraltete Anzeige über eine
            // offene Türe wäre schlimmer als gar keine.
            Label("nicht erreichbar", systemImage: "wifi.slash")
                .font(.caption2)
                .foregroundStyle(.secondary)
        case .da(let türen, let lichter, _, let alarm):
            if !türen.isEmpty {
                Label(
                    türen.count == 1
                        ? "\(türen[0]) offen"
                        : "\(türen.count) Türen offen",
                    systemImage: "lock.open.fill"
                )
                .font(.caption)
                .foregroundStyle(.red)
            } else {
                Label(
                    lichter == 0
                        ? "Alles zu, kein Licht"
                        : "Alles zu · \(lichter) Licht\(lichter == 1 ? "" : "er")",
                    systemImage: "lock.fill"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            // «Habe ich scharf geschaltet?» – die Frage, für die man das
            // Widget anlegt, und die man sich im Auto stellt. «unscharf»
            // wird nicht angezeigt: Der Normalzustand braucht keine Zeile.
            if let alarm = alarm, alarm != "unscharf" {
                Label(
                    alarm == "scharf"
                        ? "Alarm scharf"
                        : alarm == "scharfschaltend"
                            ? "Alarm wird scharf"
                            : alarm == "ausgeloest"
                                ? "Alarm ausgelöst!"
                                : alarm,
                    systemImage: alarm == "ausgeloest" ? "bell.badge.fill" : "shield.fill"
                )
                .font(.caption2)
                .foregroundStyle(alarm == "ausgeloest" ? Color.red : Color.secondary)
            }
        }
    }
}

struct HomePilotWidgetView: View {
    @Environment(\.widgetFamily) var family
    var entry: Provider.Entry

    /// Sperrbildschirm, rund: Dort passt genau ein Knopf hin – der erste.
    private var erster: Shortcut {
        entry.shortcuts.first ?? standardShortcuts[0]
    }

    /// Liegt dort die Türe, sagt das Symbol zugleich, ob sie zu ist.
    private var rundesSymbol: String {
        if erster.key == "door" {
            return entry.etwasOffen ? "lock.open.fill" : "lock.fill"
        }
        return erster.symbol
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            Link(destination: erster.url) {
                Image(systemName: rundesSymbol).font(.title2)
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                StatusZeile(glance: entry.glance)
                if let termin = entry.termin {
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
                    ForEach(entry.shortcuts, id: \.url) { knopf in
                        Link(destination: knopf.url) {
                            Image(systemName: knopf.symbol)
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
                if let termin = entry.termin {
                    Label(termin, systemImage: "calendar")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Divider()
                HStack(spacing: 18) {
                    ForEach(entry.shortcuts, id: \.url) { knopf in
                        Link(destination: knopf.url) {
                            VStack(spacing: 3) {
                                Image(systemName: knopf.symbol)
                                Text(knopf.title).font(.caption2)
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
        .description("Türstatus, nächster Termin – und deine Knöpfe.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryCircular,
            .accessoryRectangular,
        ])
    }
}
