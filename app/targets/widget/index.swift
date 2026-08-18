import SwiftUI
import WidgetKit

// Widget für Homescreen und Sperrbildschirm.
//
// Bewusst ohne Live-Daten aus dem Hub: Ein Widget, das den Zustand zeigt,
// bräuchte Adresse und Token in einer App-Gruppe und würde alle paar
// Minuten das Haus anfragen – für drei Knöpfe ist das der falsche Preis,
// und ein Token, das im Widget-Prozess liegt, ist eine Angriffsfläche
// mehr. Stattdessen sind es Abkürzungen: Ein Tipp öffnet die App genau
// dort, wo die Handlung passiert.
//
// Die Adressen sind dieselben, die auch eine Push-Nachricht benutzt –
// die App kennt sie bereits.

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

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: Date()) }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        // Statische Knöpfe: Es gibt nichts, das von selbst veraltet.
        completion(Timeline(entries: [Entry(date: Date())], policy: .never))
    }
}

struct Entry: TimelineEntry {
    let date: Date
}

struct HomePilotWidgetView: View {
    @Environment(\.widgetFamily) var family
    var entry: Provider.Entry

    var body: some View {
        switch family {
        case .accessoryCircular:
            // Sperrbildschirm, rund: nur die Türe – mehr passt nicht.
            Link(destination: shortcuts[0].url) {
                Image(systemName: shortcuts[0].symbol)
                    .font(.title2)
            }
        case .accessoryRectangular:
            HStack(spacing: 12) {
                ForEach(shortcuts.indices, id: \.self) { index in
                    Link(destination: shortcuts[index].url) {
                        VStack(spacing: 2) {
                            Image(systemName: shortcuts[index].symbol)
                            Text(shortcuts[index].title)
                                .font(.caption2)
                        }
                    }
                }
            }
        default:
            VStack(alignment: .leading, spacing: 10) {
                Text("HomePilot")
                    .font(.headline)
                ForEach(shortcuts.indices, id: \.self) { index in
                    Link(destination: shortcuts[index].url) {
                        HStack(spacing: 10) {
                            Image(systemName: shortcuts[index].symbol)
                                .frame(width: 22)
                            Text(shortcuts[index].title)
                            Spacer()
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
        .description("Türe, Alles aus und Alarm – ohne die App zu öffnen.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryCircular,
            .accessoryRectangular,
        ])
    }
}
