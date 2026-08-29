import ActivityKit
import SwiftUI
import WidgetKit
import AppIntents

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
    /// Ab iOS 17: Der Knopf schaltet direkt, statt die App zu öffnen.
    /// Die App setzt das nur für Szenen und Lichter – und nur, wenn der
    /// Hausstand (und damit das Token) in der App-Gruppe liegt.
    let direct: Bool?
    let actionPath: String?
    let actionBody: String?
}

/// Womit jeder anfängt, solange die App nichts hinterlegt hat.
private let standardShortcuts: [Shortcut] = [
    Shortcut(
        key: "door",
        title: "Haustüre",
        symbol: "key.fill",
        url: URL(string: "homepilot://door")!,
        direct: nil,
        actionPath: nil,
        actionBody: nil
    ),
    Shortcut(
        key: "alloff",
        title: "Alles aus",
        symbol: "power",
        url: URL(string: "homepilot://alloff")!,
        direct: nil,
        actionPath: nil,
        actionBody: nil
    ),
    Shortcut(
        key: "alarm",
        title: "Alarm",
        symbol: "shield.fill",
        url: URL(string: "homepilot://alarm")!,
        direct: nil,
        actionPath: nil,
        actionBody: nil
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
    case da(
        doorsOpen: [String],
        lightsOn: Int,
        nextEvent: String?,
        alarm: String?,
        running: [Maschine]
    )
}

/// Eine laufende Maschine, wie der Hub sie schickt (core/laufzeit.py).
///
/// `percent` fehlt, solange der Hub die Programmdauer dieses Geräts noch
/// nicht kennt - dann steht nur die Restzeit da. Ein Balken, der auf
/// einer geratenen Gesamtdauer sitzt, sagt weniger als die blosse Zahl.
struct Maschine {
    let name: String
    let program: String?
    let minutesLeft: Int?
    let percent: Double?

    /// «noch 23 min» - oder das Programm, wenn die Maschine keine
    /// Restzeit meldet.
    var text: String {
        if let rest = minutesLeft { return "noch \(rest) min" }
        return program ?? "läuft"
    }
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
        // «running» fehlt, wenn nichts läuft - der Normalfall, und die
        // Antwort trägt das Feld dann gar nicht erst.
        let maschinen: [Maschine] = ((json["running"] as? [[String: Any]]) ?? []).map {
            Maschine(
                name: ($0["name"] as? String) ?? "Gerät",
                program: $0["program"] as? String,
                minutesLeft: $0["minutes_left"] as? Int,
                percent: $0["percent"] as? Double
            )
        }
        return .da(
            doorsOpen: (json["doors_open"] as? [String]) ?? [],
            lightsOn: (json["lights_on"] as? Int) ?? 0,
            nextEvent: termin,
            alarm: json["alarm"] as? String,
            running: maschinen
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
            // Ohne «!»: Ein Zeitplan ist keine Stelle, an der die App
            // sterben darf. Fällt der Kalender aus (Zeitzonenwechsel,
            // exotisches Gebietsschema), sind 900 Sekunden dasselbe.
            let nächste = Calendar.current.date(byAdding: .minute, value: 15, to: Date())
                ?? Date().addingTimeInterval(900)
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
        if case .da(let türen, _, _, _, _) = glance { return !türen.isEmpty }
        return false
    }

    var termin: String? {
        if case .da(_, _, let termin, _, _) = glance { return termin }
        return nil
    }

    var maschinen: [Maschine] {
        if case .da(_, _, _, _, let laufend) = glance { return laufend }
        return []
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
        case .da(let türen, let lichter, _, let alarm, _):
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

/// Die laufende Maschine mit ihrem Fortschritt.
///
/// Der Balken ist das eigentliche Stück Auskunft: «noch 23 min» muss man
/// gegen die Programmlänge rechnen, ein halb voller Balken nicht. Fehlt
/// die Gesamtdauer (der Hub hat dieses Gerät noch nicht zweimal laufen
/// sehen), bleibt der Balken weg - lieber eine Zahl weniger als ein
/// Balken, der etwas anderes behauptet als er weiss.
struct MaschinenZeile: View {
    let maschine: Maschine
    /// Auf dem Sperrbildschirm ist alles einfarbig; ein Balken in
    /// Akzentfarbe wäre dort schlicht nicht sichtbar.
    var schmal: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(
                "\(maschine.name) · \(maschine.text)",
                systemImage: "washer"
            )
            .font(schmal ? .caption2 : .caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            if let anteil = maschine.percent {
                ProgressView(value: anteil)
                    .progressViewStyle(.linear)
                    .tint(schmal ? .primary : .accentColor)
                    .frame(height: 3)
            }
        }
    }
}

/// Der Schaltbefehl hinter einem Direkt-Knopf.
///
/// Läuft im Widget-Prozess, ohne die App zu öffnen. Pfad und Body kommen
/// aus der App-Gruppe – das Widget versteht weder Szenen noch Geräte, es
/// ruft nur auf, was die App ihm hingelegt hat. Fehler verschluckt der
/// Aufruf bewusst: Ein Widget hat keinen Platz für eine Fehlermeldung,
/// und der nächste Blick auf den Hausstand zeigt, ob es geklappt hat.
@available(iOS 17.0, *)
struct SchaltIntent: AppIntent {
    static var title: LocalizedStringResource = "HomePilot schalten"

    @Parameter(title: "Pfad")
    var pfad: String

    @Parameter(title: "Body")
    var body: String

    init() {}

    init(pfad: String, body: String) {
        self.pfad = pfad
        self.body = body
    }

    func perform() async throws -> some IntentResult {
        let defaults = UserDefaults(suiteName: appGroup)
        guard
            let base = defaults?.string(forKey: "hubUrl"),
            let token = defaults?.string(forKey: "hubToken"),
            !pfad.isEmpty,
            let url = URL(string: base + pfad)
        else {
            return .result()
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        if !body.isEmpty {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body.data(using: .utf8)
        }
        request.timeoutInterval = 8
        _ = try? await URLSession.shared.data(for: request)
        return .result()
    }
}

/// Ein Knopf: schaltet direkt (iOS 17, wenn die App es erlaubt hat) oder
/// öffnet die App an der richtigen Stelle – der Weg, der für Tür und
/// Alarm immer bleibt.
struct KnopfInhalt<Inhalt: View>: View {
    let knopf: Shortcut
    @ViewBuilder let inhalt: () -> Inhalt

    var body: some View {
        if #available(iOS 17.0, *), knopf.direct == true {
            Button(intent: SchaltIntent(pfad: knopf.actionPath ?? "", body: knopf.actionBody ?? "")) {
                inhalt()
            }
            .buttonStyle(.plain)
        } else {
            Link(destination: knopf.url) {
                inhalt()
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
                // Die laufende Maschine sticht den Termin: Der Kalender
                // steht auf demselben Sperrbildschirm noch dreimal, die
                // Restzeit der Waschmaschine nirgends. Und es ist die
                // Frage, für die man das Telefon aus der Tasche nimmt.
                if let maschine = entry.maschinen.first {
                    MaschinenZeile(maschine: maschine, schmal: true)
                } else if let termin = entry.termin {
                    Text(termin)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        case .systemSmall:
            VStack(alignment: .leading, spacing: 8) {
                StatusZeile(glance: entry.glance)
                // Nur die erste: Auf dem kleinen Widget nimmt jede
                // weitere Zeile den Knöpfen ihren Platz, und sie stehen
                // ohnehin nach Restzeit - oben ist die, für die man
                // aufsteht.
                if let maschine = entry.maschinen.first {
                    MaschinenZeile(maschine: maschine)
                }
                Spacer(minLength: 0)
                HStack(spacing: 14) {
                    ForEach(entry.shortcuts, id: \.url) { knopf in
                        KnopfInhalt(knopf: knopf) {
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
                ForEach(entry.maschinen, id: \.name) { maschine in
                    MaschinenZeile(maschine: maschine)
                }
                Divider()
                HStack(spacing: 18) {
                    ForEach(entry.shortcuts, id: \.url) { knopf in
                        KnopfInhalt(knopf: knopf) {
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

// ── Haustür-Live-Aktivität ─────────────────────────────────────────────────
//
// Die Karte, die auf dem Sperrbildschirm liegt, solange man unterwegs
// ist. Gestartet und beendet wird sie vom Hub über einen APNs-Push
// (core/liveaktivitaet.py) - die App ist im Moment des Weggehens ja
// gerade nicht offen. Der Tipp auf die Karte führt in die App zur Türe,
// mit der gewohnten Rückfrage: Ein Knopf auf dem Sperrbildschirm darf
// nicht mehr als die App - dieselbe Entscheidung wie beim Türknopf im
// Widget oben.

/// Wortgleich in der App (modules/live-aktivitaet) - beide Programme
/// müssen den Typ kennen, und der Start-Push trägt seinen Namen.
struct TuerAktivitaetAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var text: String
    }

    var tuer: String
}

/// Öffnet die Haustüre direkt vom Sperrbildschirm - OHNE Entsperren.
///
/// Bewusster Opt-in (Profil → Live-Aktivitäten → «Öffnen ohne
/// Entsperren», Standard aus): Wer ihn setzt, entscheidet, dass jeder
/// mit dem Telefon in der Hand die Türe öffnen kann - Face ID und die
/// «Wirklich öffnen?»-Rückfrage der App laufen hier nicht. Die App legt
/// dafür Adresse, Token und den fertigen Befehl in die App-Gruppe
/// (lib/widget.ts, syncTuerKnopf); ohne diese Ablage tut der Knopf
/// nichts und die Karte zeigt den bisherigen Weg in die App.
@available(iOS 17.0, *)
struct TuerOeffnenIntent: AppIntent {
    static var title: LocalizedStringResource = "Haustüre öffnen"
    // Absichtlich KEIN openAppWhenRun: Der ganze Zweck ist, dass die
    // Türe aufgeht, während das Telefon gesperrt in der Hand liegt.

    func perform() async throws -> some IntentResult {
        guard
            let ablage = UserDefaults(suiteName: appGroup),
            ablage.string(forKey: "tuerKnopf") == "1",
            let url = ablage.string(forKey: "tuerUrl"),
            let token = ablage.string(forKey: "tuerToken"),
            let pfad = ablage.string(forKey: "tuerPfad"),
            let befehl = ablage.string(forKey: "tuerBefehl"),
            let ziel = URL(string: url + pfad)
        else { return .result() }
        var request = URLRequest(url: ziel, timeoutInterval: 10)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = befehl.data(using: .utf8)
        // Fehler bewusst geschluckt: Auf dem Sperrbildschirm gibt es
        // keinen Ort für eine Meldung - ob die Türe aufging, hört man.
        _ = try? await URLSession.shared.data(for: request)
        return .result()
    }
}

/// Ob der Opt-in gesetzt ist - die Karte zeichnet danach Knopf oder Link.
func tuerKnopfAktiv() -> Bool {
    UserDefaults(suiteName: appGroup)?.string(forKey: "tuerKnopf") == "1"
}

/// Der Öffnen-Knopf der Türkarte - je nach Opt-in direkt (App-Intent,
/// ohne Entsperren) oder der bisherige Weg in die App (Link, mit
/// Rückfrage und Face ID). Eigene View statt Bedingung im Karten-Layout:
/// `#available` und eine zweite Bedingung im selben `if` verträgt der
/// ViewBuilder nicht überall - verschachtelt ist es eindeutig.
@available(iOS 16.2, *)
struct TuerOeffnenKnopf: View {
    var body: some View {
        if #available(iOS 17.0, *) {
            if tuerKnopfAktiv() {
                Button(intent: TuerOeffnenIntent()) { etikett }
                    .buttonStyle(.plain)
            } else {
                appLink
            }
        } else {
            appLink
        }
    }

    private var appLink: some View {
        Link(destination: URL(string: "homepilot://door")!) { etikett }
    }

    private var etikett: some View {
        Text("Öffnen")
            .font(.headline)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(.tint, in: Capsule())
            .foregroundStyle(.white)
    }
}

@available(iOS 16.2, *)
struct TuerAktivitaet: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TuerAktivitaetAttributes.self) { context in
            // Sperrbildschirm und Banner.
            HStack(spacing: 12) {
                Image(systemName: "key.fill")
                    .font(.title2)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Unterwegs")
                        .font(.headline)
                    Text("\(context.attributes.tuer) im Schnellzugriff")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                TuerOeffnenKnopf()
            }
            .padding(14)
            .activityBackgroundTint(Color.black.opacity(0.6))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "key.fill").font(.title2)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.tuer).font(.headline)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Link(destination: URL(string: "homepilot://door")!) {
                        Text("Öffnen").font(.headline)
                    }
                }
            } compactLeading: {
                Image(systemName: "key.fill")
            } compactTrailing: {
                EmptyView()
            } minimal: {
                Image(systemName: "key.fill")
            }
            .widgetURL(URL(string: "homepilot://door"))
        }
    }
}

// ── Die generische Karte ──────────────────────────────────────────────────
//
// Eine Form für alles, was der Hub auf den Sperrbildschirm legt:
// Küchen-Timer, Waschmaschine, Grill, Sauger, Erinnerung, Alarmanlage.
// Inhalt und Lebensdauer bestimmt der Hub (core/livekarten.py) - hier
// steht nur, wie Titel, Text, Countdown und Fortschritt gezeichnet
// werden. Eine neue Kartenart braucht deshalb kein neues Swift.

/// Wortgleich in der App (modules/live-aktivitaet).
struct HausAktivitaetAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var titel: String
        var text: String
        var symbol: String
        var farbe: String?
        var endet: Double?
        var fortschritt: Double?
        var url: String?
    }

    var art: String
}

/// Die Spanne bis zum Ende - nie rückwärts.
///
/// `Date()...ende` ist ein `ClosedRange`, und der verlangt, dass die obere
/// Grenze nicht vor der unteren liegt. Ist sie es doch, bricht Swift den
/// Prozess ab (`brk 1`) - keine Ausnahme, kein Auffangen. Genau das ist am
/// 29. August passiert: Eine Live-Aktivität, deren Zeit abgelaufen war,
/// trug ein `endet` in der Vergangenheit. Bei jedem Zeichnen stürzte die
/// Widget-Erweiterung ab, iOS drosselte sie (procRole «Throttle»), und auf
/// dem Sperrbildschirm blieb die Karte leer.
///
/// Abgelaufen heisst hier «bei null», nicht «kaputt»: Die Spanne endet
/// dann im Jetzt, der Zähler steht auf 0:00. Das ist auch fachlich richtig
/// - der Timer *ist* abgelaufen.
@available(iOS 16.2, *)
private func laufendeSpanne(bis endet: Double) -> ClosedRange<Date> {
    let jetzt = Date()
    let ende = Date(timeIntervalSince1970: endet)
    return jetzt...max(ende, jetzt)
}

@available(iOS 16.2, *)
private func kartenFarbe(_ name: String?) -> Color {
    switch name {
    case "rot": return .red
    case "orange": return .orange
    default: return .accentColor
    }
}

@available(iOS 16.2, *)
struct HausKarteInhalt: View {
    let state: HausAktivitaetAttributes.ContentState

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: state.symbol)
                .font(.title2)
                .foregroundStyle(kartenFarbe(state.farbe))
            VStack(alignment: .leading, spacing: 2) {
                Text(state.titel).font(.headline)
                if !state.text.isEmpty {
                    Text(state.text)
                        .font(.caption)
                        .foregroundStyle(state.farbe == "rot" ? .red : .secondary)
                }
                if let fortschritt = state.fortschritt {
                    ProgressView(value: fortschritt)
                        .tint(kartenFarbe(state.farbe))
                }
            }
            Spacer()
            if let endet = state.endet {
                // Zählt von selbst herunter - dafür braucht es keinen
                // einzigen weiteren Push.
                Text(
                    timerInterval: laufendeSpanne(bis: endet),
                    countsDown: true
                )
                .font(.title2.monospacedDigit())
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 90)
            }
        }
        .padding(14)
    }
}

@available(iOS 16.2, *)
struct HausKarte: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: HausAktivitaetAttributes.self) { context in
            HausKarteInhalt(state: context.state)
                .widgetURL(URL(string: context.state.url ?? "homepilot://"))
                .activityBackgroundTint(Color.black.opacity(0.6))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    HausKarteInhalt(state: context.state)
                }
            } compactLeading: {
                Image(systemName: context.state.symbol)
                    .foregroundStyle(kartenFarbe(context.state.farbe))
            } compactTrailing: {
                if let endet = context.state.endet {
                    Text(
                        timerInterval: laufendeSpanne(bis: endet),
                        countsDown: true
                    )
                    .monospacedDigit()
                    .frame(maxWidth: 60)
                }
            } minimal: {
                Image(systemName: context.state.symbol)
                    .foregroundStyle(kartenFarbe(context.state.farbe))
            }
            .widgetURL(URL(string: context.state.url ?? "homepilot://"))
        }
    }
}

// ── Eigene Widgets: je eines für ein Gerät oder eine Szene ────────────────
//
// Das Widget oben ist eine Knopfleiste: vier Abkürzungen und ein Blick
// aufs Haus. Was es nicht kann, ist «zeig mir das Küchenlicht» - und
// genau dafür legt man sich ein Widget hin.
//
// Die Karten stellt man in der App zusammen (Einstellungen → Widgets);
// hier landen sie als Liste in der App-Gruppe. Welche davon ein
// bestimmtes Widget zeigt, wählt man auf dem Homescreen aus: langer
// Druck → «Widget bearbeiten». So liegen mehrere nebeneinander, jedes
// mit seinem eigenen Gerät - was mit einem festen Widget nicht ginge.

struct Karte: Decodable {
    /// 'entity:…' oder 'scene:…' - zugleich die Kennung in der Auswahl.
    let key: String
    /// Die Kennung dahinter, mit der der Hub nach dem Zustand gefragt wird.
    let id: String
    /// 'entity' oder 'scene'.
    let kind: String
    let title: String
    let symbol: String
    let url: URL
    /// Was der Knopf aufruft. Fehlt, wenn der Hausstand aus ist - ohne
    /// Token kann das Widget nichts schalten und zeigt nur an.
    let actionPath: String?
    let actionBody: String?
}

func ladeKarten() -> [Karte] {
    guard
        let roh = UserDefaults(suiteName: appGroup)?.string(forKey: "karten"),
        let daten = roh.data(using: .utf8),
        let gelesen = try? JSONDecoder().decode([Karte].self, from: daten)
    else {
        return []
    }
    return gelesen
}

/// Wie es um das Gerät auf der Karte steht.
///
/// Dieselbe Dreiteilung wie beim Hausstand, aus demselben Grund: «aus»
/// ist eine Entscheidung in der App, «nicht erreicht» eine Störung. Ein
/// Widget, das beides als Fehler zeigt, schickt einen zum Sicherungskasten,
/// obwohl nur ein Schalter aus ist.
enum Kartenstand {
    case aus
    case nichtErreicht
    case da(text: String, an: Bool, erreichbar: Bool)
}

func ladeKartenstand(_ karte: Karte) async -> Kartenstand {
    // Eine Szene hat keinen Zustand - sie ist ein Knopf. Gar nicht erst
    // zu fragen ist ehrlicher, als eine leere Antwort zu deuten.
    if karte.kind != "entity" { return .aus }
    let defaults = UserDefaults(suiteName: appGroup)
    guard
        let base = defaults?.string(forKey: "hubUrl"),
        let token = defaults?.string(forKey: "hubToken"),
        let kennung = karte.id.addingPercentEncoding(
            withAllowedCharacters: .urlQueryAllowed
        ),
        let url = URL(string: base + "/api/glance?ids=" + kennung)
    else {
        return .aus
    }
    var request = URLRequest(url: url)
    request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    request.timeoutInterval = 8
    do {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard
            let http = response as? HTTPURLResponse, http.statusCode == 200,
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let zeilen = json["entities"] as? [[String: Any]],
            let zeile = zeilen.first
        else {
            return .nichtErreicht
        }
        return .da(
            text: (zeile["text"] as? String) ?? "–",
            an: (zeile["on"] as? Bool) ?? false,
            erreichbar: (zeile["available"] as? Bool) ?? true
        )
    } catch {
        return .nichtErreicht
    }
}

/// Eine Karte, wie sie in der Auswahl von iOS erscheint.
@available(iOS 17.0, *)
struct KartenWahl: AppEntity {
    let id: String
    let titel: String
    let art: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Karte"

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: LocalizedStringResource(stringLiteral: titel),
            subtitle: LocalizedStringResource(stringLiteral: art)
        )
    }

    static var defaultQuery = KartenQuery()
}

/// Woher die Auswahl kommt: aus der Liste, die die App hinterlegt hat.
@available(iOS 17.0, *)
struct KartenQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [KartenWahl] {
        alle().filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [KartenWahl] {
        alle()
    }

    private func alle() -> [KartenWahl] {
        ladeKarten().map { karte in
            KartenWahl(
                id: karte.key,
                titel: karte.title,
                art: karte.kind == "scene" ? "Szene" : "Gerät"
            )
        }
    }
}

@available(iOS 17.0, *)
struct KarteIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "HomePilot-Karte"
    static var description = IntentDescription(
        "Welches Gerät oder welche Szene dieses Widget zeigt."
    )

    @Parameter(title: "Karte")
    var karte: KartenWahl?

    init() {}
}

@available(iOS 17.0, *)
struct KarteEntry: TimelineEntry {
    let date: Date
    let karte: Karte?
    let stand: Kartenstand
}

@available(iOS 17.0, *)
struct KarteProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> KarteEntry {
        KarteEntry(date: Date(), karte: ladeKarten().first, stand: .aus)
    }

    func snapshot(for configuration: KarteIntent, in context: Context) async -> KarteEntry {
        await eintrag(fuer: configuration)
    }

    func timeline(for configuration: KarteIntent, in context: Context) async -> Timeline<KarteEntry> {
        let eintrag = await eintrag(fuer: configuration)
        // Wie beim grossen Widget: Häufiger lässt iOS ohnehin nicht zu.
        let naechste = Calendar.current.date(byAdding: .minute, value: 15, to: Date())
            ?? Date().addingTimeInterval(900)
        return Timeline(entries: [eintrag], policy: .after(naechste))
    }

    /// Die gewählte Karte - oder die erste, solange keine gewählt ist.
    ///
    /// Ein frisch angelegtes Widget zeigt damit sofort etwas, statt bis
    /// zum ersten «Widget bearbeiten» leer zu bleiben.
    private func eintrag(fuer configuration: KarteIntent) async -> KarteEntry {
        let karten = ladeKarten()
        let gewaehlt = configuration.karte.flatMap { wahl in
            karten.first(where: { $0.key == wahl.id })
        }
        guard let karte = gewaehlt ?? karten.first else {
            return KarteEntry(date: Date(), karte: nil, stand: .aus)
        }
        return KarteEntry(date: Date(), karte: karte, stand: await ladeKartenstand(karte))
    }
}

@available(iOS 17.0, *)
struct KarteInhalt: View {
    @Environment(\.widgetFamily) var family
    let entry: KarteEntry

    private var zustandstext: String? {
        switch entry.stand {
        case .aus: return nil
        case .nichtErreicht: return "nicht erreichbar"
        case .da(let text, _, let erreichbar): return erreichbar ? text : "nicht erreichbar"
        }
    }

    private var leuchtet: Bool {
        if case .da(_, let an, let erreichbar) = entry.stand { return an && erreichbar }
        return false
    }

    var body: some View {
        if let karte = entry.karte {
            inhalt(karte)
        } else {
            // Nicht «Fehler», sondern der Hinweis, was fehlt: In der App
            // ist noch keine Karte zusammengestellt.
            VStack(alignment: .leading, spacing: 4) {
                Image(systemName: "square.dashed").font(.title3)
                Text("Noch keine Karte")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("In der App unter Einstellungen → Widgets")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(2)
            }
        }
    }

    @ViewBuilder
    private func inhalt(_ karte: Karte) -> some View {
        if family == .accessoryRectangular {
            VStack(alignment: .leading, spacing: 2) {
                Label(karte.title, systemImage: karte.symbol)
                    .font(.headline)
                    .lineLimit(1)
                if let text = zustandstext {
                    Text(text).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: karte.symbol)
                        .font(.title2)
                        .foregroundStyle(leuchtet ? .yellow : .secondary)
                    Spacer()
                }
                Text(karte.title).font(.headline).lineLimit(2)
                if let text = zustandstext {
                    Text(text).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                knopf(karte)
            }
            .padding(4)
        }
    }

    /// Schalten, wo die App es erlaubt hat - sonst der Weg in die App.
    ///
    /// Dieselbe Abwägung wie bei den Knöpfen oben: Ohne Hausstand liegt
    /// kein Token im Widget, und ohne Token kann es nichts aufrufen.
    @ViewBuilder
    private func knopf(_ karte: Karte) -> some View {
        if let pfad = karte.actionPath, !pfad.isEmpty {
            Button(intent: SchaltIntent(pfad: pfad, body: karte.actionBody ?? "")) {
                Label(
                    karte.kind == "scene" ? "Starten" : (leuchtet ? "Ausschalten" : "Einschalten"),
                    systemImage: karte.kind == "scene" ? "play.fill" : "power"
                )
                .font(.caption)
                .lineLimit(1)
            }
            .buttonStyle(.bordered)
        } else {
            Link(destination: karte.url) {
                Label("Öffnen", systemImage: "arrow.up.right")
                    .font(.caption)
                    .lineLimit(1)
            }
        }
    }
}

@available(iOS 17.0, *)
struct KarteWidget: Widget {
    let kind: String = "HomePilotKarte"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: KarteIntent.self,
            provider: KarteProvider()
        ) { entry in
            KarteInhalt(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("HomePilot Karte")
        .description("Ein Gerät oder eine Szene – mit Zustand und einem Knopf.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryRectangular,
        ])
    }
}

@main
struct HomePilotBundle: WidgetBundle {
    var body: some Widget {
        HomePilotWidget()
        if #available(iOS 16.2, *) {
            TuerAktivitaet()
            HausKarte()
        }
        // Die eigenen Karten. Erst ab iOS 17: Erst dort lässt sich ein
        // Widget je Exemplar einstellen - und ohne das wären alle Karten
        // dieselbe.
        if #available(iOS 17.0, *) {
            KarteWidget()
        }
    }
}

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
