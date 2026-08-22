import { Platform } from 'react-native';

/**
 * Ein kurzes Spüren beim Schalten.
 *
 * Wer im Dunkeln oder im Vorbeigehen tippt, sieht die Kachel nicht
 * unbedingt an – ein kurzer Impuls sagt trotzdem, dass die App den Griff
 * angenommen hat. Bewusst nur beim Ein- und Ausschalten und bei Fehlern,
 * nicht beim Ziehen eines Reglers: Ein Dauerbrummen beim Dimmen wäre
 * lästiger als hilfreich.
 *
 * Das Modul wird zur Laufzeit geholt und Fehler werden verschluckt. Wer
 * die App aus einem älteren Klon startet, hat expo-haptics noch nicht
 * installiert – dann fehlt eben das Vibrieren, statt dass der Bildschirm
 * weiss bleibt. Auf dem Web gibt es die Schnittstelle gar nicht.
 */

type Haptics = {
  impactAsync: (style: unknown) => Promise<void>;
  notificationAsync: (style: unknown) => Promise<void>;
  ImpactFeedbackStyle: { Light: unknown; Medium: unknown };
  NotificationFeedbackType: { Warning: unknown };
};

let module_: Haptics | null | undefined;

function load(): Haptics | null {
  if (module_ !== undefined) return module_;
  if (Platform.OS === 'web') {
    module_ = null;
    return null;
  }
  try {
    module_ = require('expo-haptics') as Haptics;
  } catch {
    module_ = null;
  }
  return module_;
}

// Die .catch(() => {}) unten sind Absicht: Haptik ist eine Zugabe.
// Ein Gerät ohne Motor (Web, alte iPads) darf deswegen nie eine
// Fehlermeldung sehen.

/** Bestätigt eine Schaltung – der übliche Fall. */
export function tapped() {
  const haptics = load();
  haptics?.impactAsync(haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Etwas Grösseres wurde ausgelöst: Szene, Alarm scharf. */
export function triggered() {
  const haptics = load();
  haptics?.impactAsync(haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Es hat nicht geklappt. */
export function failed() {
  const haptics = load();
  haptics
    ?.notificationAsync(haptics.NotificationFeedbackType.Warning)
    .catch(() => {});
}
