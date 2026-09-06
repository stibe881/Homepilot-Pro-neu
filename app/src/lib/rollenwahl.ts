/**
 * Wer wem welche Rolle geben darf.
 *
 * Bis hierher stand die Rolle beim Anlegen fest. Wer einen Mitbewohner
 * versehentlich als Gast eingeladen hatte, musste ihn löschen und neu
 * einladen – mit neuem Token, das auf jedem seiner Geräte wieder
 * eingerichtet sein wollte.
 *
 * Der Hub setzt dieselben Schranken noch einmal (core/users.py,
 * api/routes/users.py); hier stehen sie, damit die App einen Grund
 * hinschreiben kann, statt einen Knopf anzubieten, der in eine
 * Fehlermeldung läuft.
 */

export interface Rollenperson {
  name: string;
  role: string;
  /** Aus der App angelegt – Benutzer aus der config.yaml gehören der Datei. */
  editable?: boolean;
}

export interface Rollenurteil {
  erlaubt: boolean;
  /** Warum nicht – ein Satz für die Zeile unter den Knöpfen. */
  grund?: string;
}

/**
 * Darf die Rolle dieser Person hier geändert werden? (rein, testbar)
 *
 * `besitzer` ist die Anzahl der Besitzer im Haus. Sie entscheidet den
 * letzten Fall: Ein Haus ohne Besitzer verwaltet niemand mehr, und zurück
 * käme man nur über die config.yaml auf dem Rechner im Keller.
 */
export function darfRolleAendern(
  person: Rollenperson,
  ich: string | null | undefined,
  besitzer: number
): Rollenurteil {
  if (!person.editable) {
    return {
      erlaubt: false,
      grund: 'Steht in der config.yaml – dort die Rolle ändern und den Hub neu starten.',
    };
  }
  if (person.name === (ich ?? '')) {
    return {
      erlaubt: false,
      grund:
        'Die eigene Rolle nicht – sonst nimmt man sich versehentlich selbst die Verwaltung.',
    };
  }
  if (person.role === 'besitzer' && besitzer <= 1) {
    return {
      erlaubt: false,
      grund: 'Der letzte Besitzer bleibt Besitzer. Erst jemand anderen dazu machen.',
    };
  }
  return { erlaubt: true };
}

/** Wie viele Besitzer das Haus hat (rein, testbar). */
export function besitzerZahl(leute: { role: string }[]): number {
  return (leute ?? []).filter((person) => person.role === 'besitzer').length;
}

/**
 * Hat diese Rolle nur EINE Zimmerwahl? (rein, testbar)
 *
 * Punkt 245 der Werkbank: Bei der Rolle «kind» springen `rooms`
 * (Schranke) und `simple_rooms` (Kinder-Ansicht) im Hub füreinander ein
 * (core/users.py, kid_rooms) – wer nur eines setzt, meint beide. Zwei
 * getrennte Klappen dafür wären tote Bedienung: Das Antippen der einen
 * änderte still auch die andere. Also stellt die Verwaltung Kindern
 * genau eine Wahl hin.
 */
export function eineZimmerwahl(role: string): boolean {
  return role === 'kind';
}

/**
 * Was die eine Zimmerwahl an den Hub schickt (rein, testbar).
 *
 * Beide Felder, mit derselben Liste: Der Rückgriff des Hubs füllt nur
 * das *leere* Feld. Stünde vom früheren Rollenwechsel noch ein alter
 * Wert im anderen, liefen Ansicht und Schranke auseinander – das Kind
 * sähe ein Zimmer, das es nicht schalten darf, oder umgekehrt.
 */
export function zimmerPatch(rooms: string[]): {
  rooms: string[];
  simple_rooms: string[];
} {
  return { rooms: [...rooms], simple_rooms: [...rooms] };
}
