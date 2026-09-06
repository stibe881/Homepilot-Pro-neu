/**
 * Das Fundbüro - wo die Bluetooth-Anhänger zuletzt gesehen wurden.
 *
 * Die Anhänger (Schlüsselbund, Rucksack; integrations/bletags.py) lagen
 * bisher als graue Sensor-Kacheln zwischen den Geräten und sagten dort
 * «weg», wenn man sie am dringendsten suchte. Hier wird daraus die
 * Antwort auf die eigentliche Frage: «Wo liegt der Schlüssel?» - Raum,
 * Abstand, und wenn er weg ist, wo und wie lange her man ihn zuletzt
 * gehört hat. Rein und ohne Netz; die Entitäten liegen längst in der App.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Entity = Record<string, any>;

export interface Fundstueck {
  id: string;
  name: string;
  /** Ist der Anhänger gerade im Haus zu hören? */
  daheim: boolean;
  /** Die eine Zeile: «Küche · 1.5 m» oder «Weg - zuletzt im Flur, vor 2 Std». */
  zeile: string;
}

/** «vor 5 Min», «vor 2 Std», «vor 3 Tagen» (rein, testbar). */
export function vorZeit(sekunden: number): string {
  if (sekunden < 90) return 'gerade eben';
  const minuten = Math.round(sekunden / 60);
  if (minuten < 90) return `vor ${minuten} Min`;
  const stunden = Math.round(sekunden / 3600);
  if (stunden < 36) return `vor ${stunden} Std`;
  return `vor ${Math.round(sekunden / 86400)} Tagen`;
}

function zeileFuer(entity: Entity, jetztSekunden: number): { daheim: boolean; zeile: string } {
  const state = entity.state ?? {};
  const raum = typeof state.room === 'string' && state.room ? state.room : null;
  if (raum) {
    const abstand =
      typeof state.distance === 'number' ? ` · ${state.distance} m` : '';
    return { daheim: true, zeile: `${raum}${abstand}` };
  }
  const zuletzt = typeof state.last_room === 'string' && state.last_room ? state.last_room : null;
  const wann =
    typeof state.last_seen_at === 'number' && state.last_seen_at > 0
      ? vorZeit(Math.max(0, jetztSekunden - state.last_seen_at))
      : null;
  if (zuletzt) {
    return {
      daheim: false,
      zeile: wann ? `Weg - zuletzt: ${zuletzt}, ${wann}` : `Weg - zuletzt: ${zuletzt}`,
    };
  }
  // Noch nie gehört - meist ist die Anbindung frisch oder der Empfänger
  // aus. Das soll dastehen, statt dass die Zeile «weg» behauptet.
  return { daheim: false, zeile: 'Noch nie gehört - läuft der Empfänger?' };
}

/**
 * Die Fundbüro-Zeilen aus der Entitätenliste (rein, testbar).
 *
 * Was daheim ist, steht zuoberst - gesucht wird aber meist das andere,
 * darum bleibt die Reihenfolge innerhalb der Gruppen stabil nach Name.
 */
export function fundstuecke(entities: Entity[], jetztSekunden: number): Fundstueck[] {
  const tags = entities.filter(
    (entity) => typeof entity.id === 'string' && entity.id.startsWith('bletags.')
  );
  const zeilen = tags.map((entity) => {
    const stand = zeileFuer(entity, jetztSekunden);
    return {
      id: entity.id as string,
      name: String(entity.label ?? entity.name ?? entity.id),
      ...stand,
    };
  });
  return zeilen.sort(
    (a, b) => Number(b.daheim) - Number(a.daheim) || a.name.localeCompare(b.name, 'de')
  );
}
