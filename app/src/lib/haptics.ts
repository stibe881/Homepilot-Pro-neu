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
 * Zwei Impulse dicht hintereinander werden zu einem: Ein Tastendruck
 * läuft durch zwei Stellen, die beide ein Spüren auslösen wollen – die
 * Taste selbst und das Absenden in `useHub`. Beide haben recht, jede
 * für sich; zusammen fühlen sie sich matschig an und verwischen den
 * Unterschied zwischen einem feinen Ticken und einem schweren Druck.
 * Wer wirklich zweimal in 60 ms drückt, meint ohnehin einen Druck.
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

/** So dicht dürfen zwei Impulse nicht aufeinanderfolgen (Millisekunden). */
export const ZUSAMMEN_MS = 60;

/**
 * Darf jetzt ein Impuls raus? (rein, testbar)
 *
 * ``null`` heisst: noch keiner gewesen. Gilt nur fürs Ticken und
 * Drücken – eine Absage (``failed``) kommt immer durch, auch wenn der
 * Hub sie in zwanzig Millisekunden zurückschickt. Sie ist die Auskunft,
 * auf die es dann ankommt.
 */
export function darfSpueren(letzter: number | null, jetzt: number): boolean {
  return letzter === null || jetzt - letzter >= ZUSAMMEN_MS;
}

let letzterImpuls: number | null = null;

function impuls(waehle: (h: Haptics) => unknown, jetzt = Date.now()): void {
  const haptics = load();
  if (!haptics) return;
  if (!darfSpueren(letzterImpuls, jetzt)) return;
  letzterImpuls = jetzt;
  haptics.impactAsync(waehle(haptics)).catch(() => {});
}

/** Bestätigt eine Schaltung – der übliche Fall. */
export function tapped() {
  impuls((h) => h.ImpactFeedbackStyle.Light);
}

/** Etwas Grösseres wurde ausgelöst: Szene, Alarm scharf, «OK» auf der
 *  Fernbedienung. */
export function triggered() {
  impuls((h) => h.ImpactFeedbackStyle.Medium);
}

/** Es hat nicht geklappt.
 *
 *  Kommt immer durch – anders als das Ticken. Eine Absage kann
 *  Millisekunden nach dem Druck eintreffen, und genau dann ist sie die
 *  Auskunft, auf die es ankommt. */
export function failed() {
  const haptics = load();
  haptics
    ?.notificationAsync(haptics.NotificationFeedbackType.Warning)
    .catch(() => {});
}
