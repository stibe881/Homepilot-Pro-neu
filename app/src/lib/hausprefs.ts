import { HubSettings } from '../api/types';
import { HousePrefs } from '../hooks/usePrefs';

/**
 * Was aus den alten Ablagen in die haushaltsweite gehört.
 *
 * Bis vor Kurzem lagen die Oberflächen-Einstellungen an zwei Orten, und
 * beide waren falsch:
 *
 * - Ausgeblendete Geräte, Sperren und die Gerätereihenfolge im Speicher
 *   der App – also auf genau diesem Telefon. Neue App, neues Gerät,
 *   Weboberfläche: alles weg.
 * - Kachel-Reihenfolgen, Widget-Knöpfe und die Face-ID-Hürde beim
 *   Benutzer auf dem Hub – geräteübergreifend immerhin, aber Livia sah
 *   eine andere Wohnung als Stefan.
 *
 * Jetzt steht beides zusammen im Haus. Damit dabei nichts verloren geht,
 * wandert einmalig herüber, was da war – und nur dann, wenn im Haus noch
 * nichts steht. Sonst überschriebe ein Telefon aus der Schublade beim
 * ersten Öffnen die Einrichtung aller anderen.
 *
 * Die persönliche Ablage hat Vorrang vor der gerätelokalen: Sie war
 * schon geräteübergreifend und damit die jüngere Wahrheit. Nur wo sie
 * nichts weiss, springt das Gerät ein.
 */
export function altesUebernehmen(
  haus: HousePrefs,
  lokal: HubSettings,
  persoenlich: Record<string, unknown>
): HousePrefs | null {
  // Steht im Haus schon etwas, ist die Übernahme gelaufen.
  if (Object.keys(haus).length > 0) return null;

  const next: HousePrefs = {};

  const order: Record<string, string[]> = {
    ...(typeof persoenlich.order === 'object' && persoenlich.order
      ? persoenlich.order
      : {}),
  };
  // Die alte Gerätereihenfolge aus den Geräte-Einstellungen: nur, wenn
  // die persönliche Ablage für diese Ansicht nichts kennt.
  if (lokal.order && lokal.order.length > 0 && !order.devices) {
    order.devices = lokal.order;
  }
  if (Object.keys(order).length > 0) next.order = order;

  if (lokal.hidden && lokal.hidden.length > 0) next.hidden = lokal.hidden;
  if (lokal.locked && lokal.locked.length > 0) next.locked = lokal.locked;

  if (typeof persoenlich.bioLock === 'boolean') next.bioLock = persoenlich.bioLock;
  if (typeof persoenlich.widgetData === 'boolean') {
    next.widgetData = persoenlich.widgetData;
  }
  if (Array.isArray(persoenlich.widgetButtons) && persoenlich.widgetButtons.length > 0) {
    next.widgetButtons = persoenlich.widgetButtons;
  }

  // Nichts zu holen – dann auch nichts schreiben, sonst stünde im Haus
  // ein leeres Objekt, und die Übernahme gälte als erledigt, obwohl ein
  // anderes Gerät vielleicht noch etwas beizutragen hätte.
  return Object.keys(next).length > 0 ? next : null;
}
