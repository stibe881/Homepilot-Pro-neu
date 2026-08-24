/**
 * Die Zeile unter dem Namen einer Integration im System-Bildschirm.
 *
 * Dort stand «0 Geräte» auch bei Integrationen, die gar keine eigenen
 * führen: Life360 meldet an den Geofence weiter, die Personen gehören
 * deshalb dem Geofence. Die Null war wahr und trotzdem falsch – sie las
 * sich wie eine Störung und beantwortete die Frage nicht, für die man
 * dort hinschaut: Liefert das Ding überhaupt etwas?
 *
 * Wer es selbst sagen kann, sagt es über `health()`. Dann tritt die Zahl
 * zurück und macht dem Satz Platz, statt ihm eine Null voranzustellen.
 */

export type Integrationszustand = {
  ok: boolean;
  error?: string | null;
  entities: number;
  unavailable?: number;
  health?: Record<string, unknown> | null;
};

/** Was unter dem Namen steht – `null` heisst «diese Zeile entfällt» (rein, testbar). */
export function integrationDetail(integration: Integrationszustand): string | null {
  if (!integration.ok) {
    return integration.error || 'Gestört – ohne Begründung';
  }
  const anzahl = integration.entities ?? 0;
  if (anzahl === 0) {
    // Die eigene Auskunft steht ohnehin gleich darunter; eine Null davor
    // wäre nur der irreführende Teil davon.
    if (typeof integration.health?.detail === 'string' && integration.health.detail) {
      return null;
    }
    // Ohne eigene Auskunft bleibt es bei einer Feststellung – aber als
    // Satz, nicht als Zahl, die nach Ausfall aussieht.
    return 'Keine eigenen Geräte';
  }
  const wort = anzahl === 1 ? 'Gerät' : 'Geräte';
  const stumm = integration.unavailable ?? 0;
  return `${anzahl} ${wort}${stumm > 0 ? `, ${stumm} nicht erreichbar` : ''}`;
}
