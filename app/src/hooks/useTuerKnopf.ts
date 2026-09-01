import { useEffect, useRef } from 'react';

import { Entity, HubSettings } from '../api/types';
import { schreibeTuerKnopf, tuerKnopfWerte } from '../lib/widget';

/**
 * Den Öffnen-Knopf der Sperrbildschirm-Karte versorgen.
 *
 * Der Knopf (targets/widget, TuerOeffnenIntent) läuft im Widget-Prozess
 * und öffnet die Türe OHNE Entsperren - er braucht dafür Adresse, Token
 * und den fertigen Befehl aus der App-Gruppe. Dieser Haken schreibt sie
 * hinein, solange der Opt-in gesetzt ist, und räumt sie weg, sobald er
 * fällt.
 *
 * `an === null` heisst «noch nicht bekannt» (die Einstellungen sind noch
 * unterwegs) - dann passiert bewusst nichts: Beim App-Start kurz zu
 * löschen und gleich wieder zu schreiben hiesse, dass der Knopf auf
 * einer gerade liegenden Karte für einen Moment stürbe.
 */
export function useTuerKnopf(
  settings: HubSettings,
  entities: Entity[],
  an: boolean | null
): void {
  const zuletzt = useRef('');
  const werte = an ? tuerKnopfWerte(settings, entities) : null;
  // Weggeräumt wird nur, wenn der Opt-in wirklich aus ist. Steht er an
  // und ist die Türe bloss (noch) nicht bekannt - die Geräte des Hubs
  // sind unterwegs, oder er antwortet gerade nicht -, bleibt liegen,
  // was liegt. Vorher räumte genau dieser Fall den Knopf weg: Die App
  // ging auf, die Antwort des Hubs war noch nicht da, und die Karte auf
  // dem Sperrbildschirm verlor still ihren direkten Öffner.
  const seriell =
    an === null
      ? zuletzt.current
      : an === false
        ? 'aus'
        : werte
          ? JSON.stringify(werte)
          : zuletzt.current;

  useEffect(() => {
    if (seriell === zuletzt.current) return;
    zuletzt.current = seriell;
    schreibeTuerKnopf(seriell === 'aus' ? null : JSON.parse(seriell));
  }, [seriell]);
}
