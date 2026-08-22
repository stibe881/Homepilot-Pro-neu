import { Entity } from '../api/types';

/**
 * Szenen: den Ist-Zustand einfangen und gespeicherte Aktionen zurücklesen.
 *
 * Beides ist entscheidbar und beides ging schief, solange es in der
 * Bildschirm-Datei steckte: Der Schnappschuss sammelte turn_on statt der
 * gedimmten 15 %, und beim Bearbeiten fiel die Storen-Position weg.
 */

/** Eine Aktion, wie der Szenen-Editor sie hält. */
export interface SceneActionDraft {
  entity_id: string;
  command: string;
  rooms?: number[];
  /** Zielposition in Prozent, wenn das Kommando 'set_position' ist. */
  position?: number;
  /** Zielhelligkeit in Prozent, wenn das Kommando 'set_brightness' ist. */
  brightness?: number;
  /** Lichtfarbe (Hex) – wird beim Speichern zu einer eigenen
   *  set_color-Aktion. Kommt aus dem Schnappschuss. */
  color?: string;
  /** Eigene Übergangszeit dieser Lampe in Sekunden. 0 heisst «sofort,
   *  auch wenn die Szene langsam anfährt» – die Nachttischlampe beim
   *  Lichtwecker. undefined heisst: die Zeit der Szene gilt. */
  transition?: number;
  /** Weissanteil als Mirek (153 = tageslichtweiss … 500 = sehr warm).
   *  Nur in Abläufen; Szenen fragen bisher nicht danach. */
  colorTemp?: number;
  /** «An die Umgebungshelligkeit angepasst»: Der Hub nimmt beim Auslösen
   *  die Lux des Melders und rechnet die Helligkeit daraus. Nur sinnvoll,
   *  wenn ein Auslöser überhaupt Helligkeit misst. */
  adaptive?: boolean;
  /** Nachlauf in Sekunden: So lange bleibt die Lampe an, dann schaltet der
   *  Hub sie von selbst aus. 0 oder fehlend heisst «an lassen». */
  offAfter?: number;
}

/**
 * Die Aktion, die den aktuellen Zustand eines Geräts festhält (rein,
 * testbar) – Grundlage für «Aktuellen Zustand übernehmen».
 *
 * Mit Helligkeit und Farbe, nicht nur an/aus: Der Kopf von
 * core/scenes.py nennt als Beispiel wörtlich eine Szene «Kino» mit
 * brightness 15 – und genau die liess sich hier nicht bauen. Der
 * Schnappschuss sammelte turn_on ein, und die gedimmte Stimmung wurde
 * beim Auslösen zur vollen Deckenbeleuchtung.
 */
export function snapshotAction(
  entity: Entity
): { entity_id: string; command: string; rooms: number[]; brightness?: number; color?: string } {
  const basis = { entity_id: entity.id, rooms: [] as number[] };
  if (
    entity.kind === 'light' &&
    entity.state.state === 'on' &&
    entity.commands.includes('set_brightness') &&
    typeof entity.state.brightness === 'number'
  ) {
    return {
      ...basis,
      command: 'set_brightness',
      brightness: Math.round(entity.state.brightness),
      ...(entity.commands.includes('set_color') && typeof entity.state.color === 'string'
        ? { color: entity.state.color }
        : {}),
    };
  }
  return { ...basis, command: snapshotCommand(entity) };
}

/** Das Kommando, das den aktuellen Zustand eines Geräts festhält (rein,
 *  testbar) – für alles ohne Helligkeit. */
export function snapshotCommand(entity: Entity): string {
  const state = entity.state.state;
  if (entity.kind === 'cover') {
    const position = entity.state.position;
    if (typeof position === 'number') return position <= 5 ? 'close' : 'open';
    return state === 'closed' ? 'close' : 'open';
  }
  if (entity.kind === 'lock') return state === 'locked' ? 'lock' : 'unlock';
  if (entity.kind === 'vacuum') return state === 'cleaning' ? 'start' : 'dock';
  // «Aus laufender Musik»: spielt gerade etwas, nimmt die Szene das Abspielen
  // auf – aktiviert man sie später, läuft die Musik weiter.
  if (entity.kind === 'media_player') return state === 'playing' ? 'play' : 'pause';
  if (entity.kind === 'alarm') {
    // Der aktuelle Modus wird zur Szene; unscharf bleibt unscharf.
    if (state === 'unscharf' || !state) return 'disarm';
    const mode = String(entity.state.mode ?? '');
    return mode === 'nacht'
      ? 'arm_night'
      : mode === 'urlaub'
        ? 'arm_vacation'
        : 'arm_away';
  }
  return state === 'on' ? 'turn_on' : 'turn_off';
}

/**
 * Gespeicherte Szenen-Aktionen zurück in die Entwurfsform (rein, testbar).
 *
 * Zwei Dinge, die beim Bearbeiten sonst verloren gehen:
 *
 * - Die **Werte in data**. Vorher fiel schon die Storen-Position weg –
 *   wer eine Szene mit «50 %» öffnete und wieder speicherte, hatte
 *   danach eine mit der Vorgabe.
 * - Die **set_color-Zeile**, die beim Speichern aus dem Farb-Feld
 *   entstand. Sie gehört zurück an ihren set_brightness-Eintrag, sonst
 *   stünde das Licht zweimal in der Liste.
 */
export function sceneActionsToDraft(
  actions: {
    entity_id: string;
    command: string;
    data?: {
      rooms?: number[];
      position?: number;
      brightness?: number;
      color?: string;
      transition?: number;
    };
  }[]
): SceneActionDraft[] {
  const result: SceneActionDraft[] = [];
  for (const action of actions) {
    if (action.command === 'set_color') {
      const traeger = result.find(
        (entry) => entry.entity_id === action.entity_id && entry.command === 'set_brightness'
      );
      if (traeger) {
        traeger.color = String(action.data?.color ?? '');
        continue;
      }
    }
    result.push({
      entity_id: action.entity_id,
      command: action.command,
      rooms: action.data?.rooms,
      position: action.data?.position,
      brightness: action.data?.brightness,
      transition: action.data?.transition,
      color: action.command === 'set_color' ? String(action.data?.color ?? '') : undefined,
    });
  }
  return result;
}


/** Ein Befehl, der einen Zustand von vorher wiederherstellt. */
export interface RueckwegBefehl {
  entity_id: string;
  command: string;
  data?: Record<string, number | string>;
}

/**
 * Der Rückweg nach dem Ausprobieren einer Szene (rein, testbar).
 *
 * Vor dem Auslösen aufgerufen: Für jedes Gerät der Szene der Befehl, der
 * den *jetzigen* Zustand wiederherstellt. So wird aus «speichern, ins
 * Zimmer gehen, schauen, zurück, ändern» ein «Ausprobieren» mit einem
 * «Doch nicht» daneben.
 *
 * Nur, was sich gefahrlos zurückstellen lässt:
 *
 * - Lichter und Schalter samt Helligkeit – der Hauptfall.
 * - Storen auf ihre gemerkte Position.
 * - Ein Schloss wird höchstens wieder *ab*geschlossen. Ein Rückgängig,
 *   das eine Türe aufschliesst, ist keins.
 * - Die Alarmanlage gar nicht: Wer sie in einer Szene schaltet, soll das
 *   bewusst zurücknehmen, nicht über einen Sammelknopf.
 */
export function szenenRueckweg(
  entities: Entity[],
  entityIds: string[]
): RueckwegBefehl[] {
  const befehle: RueckwegBefehl[] = [];
  for (const id of new Set(entityIds)) {
    const entity = entities.find((entry) => entry.id === id);
    if (!entity) continue;
    const state = entity.state.state;
    if (entity.kind === 'cover') {
      if (
        typeof entity.state.position === 'number' &&
        entity.commands.includes('set_position')
      ) {
        befehle.push({
          entity_id: id,
          command: 'set_position',
          data: { position: Math.round(entity.state.position) },
        });
      }
      continue;
    }
    if (entity.kind === 'lock') {
      if (state === 'locked') befehle.push({ entity_id: id, command: 'lock' });
      continue;
    }
    if (entity.kind === 'alarm' || entity.kind === 'vacuum') continue;
    if (!entity.commands.includes('turn_off')) continue;
    if (state === 'on') {
      if (
        typeof entity.state.brightness === 'number' &&
        entity.commands.includes('set_brightness')
      ) {
        befehle.push({
          entity_id: id,
          command: 'set_brightness',
          data: { brightness: Math.round(entity.state.brightness) },
        });
      } else {
        befehle.push({ entity_id: id, command: 'turn_on' });
      }
    } else if (state === 'off') {
      befehle.push({ entity_id: id, command: 'turn_off' });
    }
  }
  return befehle;
}

/**
 * Die Szenen, die in diesem Raum etwas tun (rein, testbar).
 *
 * Bisher entschied allein das Feld `room` – ein einzelnes. «Feierabend»
 * betrifft Wohnzimmer, Küche und die Storen und erschien in höchstens
 * einem davon. Jetzt zählt zusätzlich, was die Szene *schaltet*: Sie
 * erscheint in jedem Raum, dessen Geräte sie anfasst. Das Feld bleibt
 * als Zuordnung von Hand bestehen.
 */
export function szenenFuerRaum<S extends { room?: string | null; entity_ids: string[] }>(
  scenes: S[],
  entities: Entity[],
  room: string
): S[] {
  const imRaum = new Set(
    entities.filter((entity) => entity.room === room).map((entity) => entity.id)
  );
  return scenes.filter(
    (scene) =>
      scene.room === room || scene.entity_ids.some((id) => imRaum.has(id))
  );
}
