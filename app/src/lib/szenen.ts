import { Entity } from '../api/types';

/**
 * Szenen: den Ist-Zustand einfangen und gespeicherte Aktionen zurücklesen.
 *
 * Beides ist entscheidbar und beides ging schief, solange es in der
 * Bildschirm-Datei steckte: Der Schnappschuss sammelte turn_on statt der
 * gedimmten 15 %, und beim Bearbeiten fiel die Storen-Position weg.
 */

/**
 * Befehle, deren Richtung in unsichtbaren Zusatzdaten steckt.
 *
 * Die Kamera kennt nur `set_privacy` und meint mit `enabled` das eine
 * oder das andere; der Lautsprecher kennt nur `mute` und meint mit
 * `muted` dasselbe Spiel. In der Auswahl braucht es dafür je zwei Chips –
 * ein Chip, der je nach unsichtbarem Zusatz etwas anderes tut, ist
 * keiner. Diese Schlüssel gibt es nur in der Oberfläche; gespeichert wird
 * der echte Befehl.
 */
const RICHTUNGEN = [
  { key: 'privacy_on', command: 'set_privacy', feld: 'enabled', wert: true },
  { key: 'privacy_off', command: 'set_privacy', feld: 'enabled', wert: false },
  { key: 'mute_on', command: 'mute', feld: 'muted', wert: true },
  { key: 'mute_off', command: 'mute', feld: 'muted', wert: false },
] as const;

export const PRIVATSPHAERE_EIN = 'privacy_on';
export const PRIVATSPHAERE_AUS = 'privacy_off';
export const STUMM_EIN = 'mute_on';
export const STUMM_AUS = 'mute_off';

/** Oberflächen-Schlüssel → gespeicherter Befehl (rein, testbar). */
export function richtungBefehl(
  command: string
): { command: string; data: Record<string, boolean> } | null {
  const treffer = RICHTUNGEN.find((eintrag) => eintrag.key === command);
  return treffer ? { command: treffer.command, data: { [treffer.feld]: treffer.wert } } : null;
}

/** Gespeicherter Befehl → Oberflächen-Schlüssel (rein, testbar).
 *
 * Fehlt der Zusatz, gilt die «ein»-Richtung: Wer den Privatsphäre-Modus
 * oder «stumm» in eine Szene nimmt, will fast immer einschalten – und ein
 * Chip muss leuchten, sonst sieht die Zeile aus wie versehentlich drin. */
export function richtungSchluessel(
  command: string,
  data: Record<string, unknown> | undefined
): string | null {
  const passend = RICHTUNGEN.filter((eintrag) => eintrag.command === command);
  if (passend.length === 0) return null;
  const gesetzt = data?.[passend[0].feld];
  return (gesetzt === false ? passend.find((e) => !e.wert) : passend.find((e) => e.wert))!.key;
}

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
  /** Ziel-Lautstärke in Prozent, wenn das Kommando 'set_volume' ist. */
  volume?: number;
  /** Name der Playlist, wenn das Kommando 'play_playlist' ist. */
  playlist?: string;
  /** Paket-ID der App, wenn das Kommando 'launch_app' ist. */
  app?: string;
  /** Auf welcher Box die Playlist spielen soll. Leer heisst «dort, wo
   *  zuletzt Musik lief» – in einer Szene ist das eine Wette. */
  device?: string;
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
  if (entity.kind === 'camera') {
    // Nicht der Online-Zustand, sondern der Privatsphäre-Schalter: Das
    // ist das Einzige, was sich an einer Kamera stellen lässt.
    return entity.state.privacy === 'on' ? PRIVATSPHAERE_EIN : PRIVATSPHAERE_AUS;
  }
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
      enabled?: boolean;
      muted?: boolean;
      volume?: number;
      name?: string;
      app?: string;
      device?: string;
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
    const richtung = richtungSchluessel(action.command, action.data);
    result.push({
      entity_id: action.entity_id,
      command: richtung ?? action.command,
      rooms: action.data?.rooms,
      position: action.data?.position,
      brightness: action.data?.brightness,
      volume: action.data?.volume,
      // Die Playlist steht beim Hub unter 'name' – ein eigenes Feld im
      // Entwurf, damit sie nicht mit dem Namen der Szene verwechselt wird.
      playlist: action.data?.name,
      app: action.data?.app,
      device: action.data?.device,
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
/**
 * Die Szenen, die auf die Raumkachel passen (rein, testbar).
 *
 * Auf der Übersicht steht neben dem Raumnamen Platz, der bisher leer
 * blieb – und die Szene des Zimmers lag zwei Tipps entfernt: erst den
 * Raum öffnen, dann die Szene. Für «Kino» im Wohnzimmer ist das ein Weg
 * zu viel.
 *
 * Bewusst nur wenige: Eine Kachel, die sechs Szenenknöpfe trägt, ist
 * keine Übersicht mehr. Wer alle braucht, öffnet den Raum – dort stehen
 * sie vollständig. Vorrang haben Szenen, die diesem Raum ausdrücklich
 * zugeteilt sind; erst danach die, die bloss ein Gerät darin schalten.
 */
export function szenenFuerKachel<
  S extends { room?: string | null; entity_ids: string[] },
>(scenes: S[], entities: Entity[], room: string, max = 2): S[] {
  const passend = szenenFuerRaum(scenes, entities, room);
  const eigene = passend.filter((scene) => scene.room === room);
  const fremde = passend.filter((scene) => scene.room !== room);
  return [...eigene, ...fremde].slice(0, Math.max(0, max));
}

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
