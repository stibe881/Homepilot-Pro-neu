import ExpoModulesCore
import WidgetKit

/// Die geteilte Ablage der App-Gruppe - als eigenes lokales Modul.
///
/// Dieselben Handgriffe gäbe es auch im Paket @bacons/apple-targets
/// (ExtensionStorage), und lange lief die Ablage darüber. Nur kam
/// dessen Modul in keinem EAS-Build je an: Die Innenansicht der
/// Widget-Einstellungen zählte 41 native Module, keines davon
/// «ExtensionStorage» - während die drei lokalen Module dieses Projekts
/// in jedem Build registriert sind. Statt weiter zu ergründen, warum
/// der Bau-Server genau dieses eine Fremdpaket auslässt, liegt die
/// Ablage jetzt auf dem Weg, der hier nachweislich funktioniert.
///
/// Die Signaturen entsprechen absichtlich denen des Pakets
/// ((key, value, group) und (key, group)): lib/widget.ts spricht beide
/// Fassungen mit demselben Griff an.
public class WidgetAblageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WidgetAblage")

    Function("setString") { (key: String, value: String, group: String?) in
      UserDefaults(suiteName: group)?.set(value, forKey: key)
    }

    Function("get") { (key: String, group: String?) -> String? in
      guard let defaults = UserDefaults(suiteName: group) else { return nil }
      if let value = defaults.string(forKey: key) { return value }
      // Nicht-Text (etwa eine Zahl aus einer aelteren Fassung) lesbar
      // machen statt nil zu sagen - die App entscheidet selbst, was sie
      // damit anfaengt.
      if let value = defaults.object(forKey: key) { return String(describing: value) }
      return nil
    }

    Function("remove") { (key: String, group: String?) in
      UserDefaults(suiteName: group)?.removeObject(forKey: key)
    }

    Function("reloadWidget") { (timeline: String?) in
      if let timeline {
        WidgetCenter.shared.reloadTimelines(ofKind: timeline)
      } else {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }
  }
}
