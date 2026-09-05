/**
 * Die aufgeklappte Wetterkarte: heute Stunde für Stunde.
 *
 * Der Hub schickt am Wetter-Gerät die restlichen Stunden des Tages mit
 * (`hours`, integrations/weather.py). Hier wird daraus, was die Karte
 * zeichnet - und zwar streng: Die Liste kommt über das Netz und aus
 * einem Hub, der älter sein kann als die App. Was kein Zeitstempel ist,
 * fällt weg, statt als «undefined°» in der Reihe zu stehen.
 */

export interface Stunde {
  /** «14:00» - fürs Spaltenköpfchen. */
  zeit: string;
  temp: number | null;
  text: string;
  icon: string;
  /** Regenwahrscheinlichkeit in Prozent, wie in der Wochenzeile. */
  rain: number | null;
}

/** Die Stundenliste des Hubs in Zeilen für die Karte (rein, testbar). */
export function stundenZeilen(roh: unknown): Stunde[] {
  if (!Array.isArray(roh)) return [];
  const zeilen: Stunde[] = [];
  for (const eintrag of roh) {
    if (!eintrag || typeof eintrag !== 'object') continue;
    const wert = eintrag as Record<string, unknown>;
    const zeit = uhrzeit(wert.time);
    if (!zeit) continue;
    zeilen.push({
      zeit,
      temp: typeof wert.temp === 'number' ? Math.round(wert.temp) : null,
      text: typeof wert.text === 'string' ? wert.text : '',
      icon: typeof wert.icon === 'string' ? wert.icon : 'cloud-outline',
      rain: typeof wert.rain === 'number' ? wert.rain : null,
    });
  }
  return zeilen;
}

/**
 * «2026-09-05T14:00» → «14:00» (rein).
 *
 * Bewusst ohne `new Date()`: Der Hub schickt die Zeit bereits in der
 * Zone des Hauses (Europe/Zurich), und ein Date-Parsen im Browser
 * deutete sie je nach Gerät als UTC um - dieselbe Falle wie beim Regen.
 */
function uhrzeit(roh: unknown): string | null {
  const treffer = /T(\d{2}:\d{2})/.exec(String(roh ?? ''));
  return treffer ? treffer[1] : null;
}
