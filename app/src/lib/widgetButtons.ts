import { Entity, Scene } from '../api/types';

/**
 * Die Knöpfe im Homescreen-Widget.
 *
 * Bis vor Kurzem standen sie fest im Widget: Haustüre, Alles aus, Alarm.
 * Für den Anfang richtig, auf Dauer falsch – wer abends «Kino» drückt und
 * die Haustüre nie über das Widget öffnet, hat drei Knöpfe, von denen
 * zwei nichts für ihn tun.
 *
 * Also eine Liste von Schlüsseln, die die Person selbst zusammenstellt.
 * Aufgelöst wird sie hier: aus «scene:kino» wird ein Titel, ein Symbol
 * und die Adresse, die die App beim Antippen öffnet. Das Widget selbst
 * kennt nur noch das Ergebnis – es liest fertige Knöpfe aus der
 * App-Gruppe und muss weder Szenen noch Geräte verstehen.
 *
 * Warum überhaupt Adressen statt Befehle: Ein Widget-Tipp schaltet nichts
 * selbst, er öffnet die App an der richtigen Stelle. Ein Türöffner, der
 * sich vom gesperrten Bildschirm aus mit einem Tipp auslösen liesse, wäre
 * genau der Knopf, den man nicht will.
 */

export interface WidgetButton {
  /** Was gespeichert wird: 'door', 'alloff', 'alarm', 'scene:<id>',
   *  'entity:<id>'. */
  key: string;
  /** Beschriftung im Widget – kurz, dort ist wenig Platz. */
  title: string;
  /** SF-Symbol. Bewusst nur alte, sichere Namen: Ein Symbol, das die
   *  iOS-Fassung nicht kennt, zeichnet nichts, und der Knopf wäre leer. */
  symbol: string;
  /** homepilot://… – dieselben Adressen, die auch ein NFC-Aufkleber
   *  benutzt. */
  url: string;
  /** Schaltet der Knopf direkt (iOS 17), statt die App zu öffnen? */
  direct?: boolean;
  /** Was er dann aufruft – Pfad am Hub und JSON-Body. */
  actionPath?: string;
  actionBody?: string;
}

/** Mehr passt selbst auf die grosse Widget-Grösse nicht nebeneinander. */
export const MAX_BUTTONS = 4;

/** Womit jeder anfängt, solange nichts eingestellt wurde. */
export const STANDARD = ['door', 'alloff', 'alarm'];

const FEST: Record<string, WidgetButton> = {
  door: {
    key: 'door',
    title: 'Haustüre',
    symbol: 'key.fill',
    url: 'homepilot://door',
  },
  alloff: {
    key: 'alloff',
    title: 'Alles aus',
    symbol: 'power',
    url: 'homepilot://alloff',
  },
  alarm: {
    key: 'alarm',
    title: 'Alarm',
    symbol: 'shield.fill',
    url: 'homepilot://alarm',
  },
};

/** Symbol je Geräteart. Der Rückfall ist absichtlich ein Symbol und kein
 *  leeres Feld – lieber ein neutrales Kästchen als ein Knopf ohne Bild. */
const SYMBOLE: Record<string, string> = {
  light: 'lightbulb.fill',
  switch: 'power',
  outlet: 'power',
  lock: 'key.fill',
  cover: 'arrow.up.arrow.down',
  climate: 'thermometer',
  media_player: 'speaker.wave.2.fill',
  vacuum: 'wand.and.stars',
  fan: 'wind',
};

/** Befehle, die einen Knopf sinnvoll machen. */
const SCHALTBAR = new Set([
  'toggle',
  'turn_on',
  'turn_off',
  'open',
  'close',
  'open_door',
  'unlatch',
  'lock',
  'unlock',
  'start',
]);

/** Im Widget ist die Zeile schmal. Lieber gekürzt als umgebrochen. */
export function kurz(name: string, max = 14): string {
  const sauber = name.trim();
  if (sauber.length <= max) return sauber;
  return sauber.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Einen Schlüssel zu einem Knopf machen – oder `null`, wenn es das, was
 * er meint, nicht mehr gibt.
 *
 * Der Fall ist nicht theoretisch: Wer eine Szene löscht, deren Knopf im
 * Widget liegt, soll dort keinen Knopf sehen, der ins Leere führt.
 */
export function resolveButton(
  key: string,
  scenes: Scene[],
  entities: Entity[]
): WidgetButton | null {
  if (FEST[key]) return FEST[key];
  if (key.startsWith('scene:')) {
    const id = key.slice('scene:'.length);
    const scene = scenes.find((entry) => entry.id === id);
    if (!scene) return null;
    return {
      key,
      title: kurz(scene.name),
      symbol: 'sparkles',
      url: `homepilot://scene/${encodeURIComponent(id)}`,
    };
  }
  if (key.startsWith('entity:')) {
    const id = key.slice('entity:'.length);
    const entity = entities.find((entry) => entry.id === id);
    if (!entity) return null;
    return {
      key,
      title: kurz(entity.name),
      symbol: SYMBOLE[entity.kind] ?? 'square.grid.2x2.fill',
      url: `homepilot://entity/${encodeURIComponent(id)}`,
    };
  }
  return null;
}

/**
 * Die gespeicherte Liste zu Knöpfen machen.
 *
 * Verschwundenes fällt still heraus, Doppeltes ebenfalls, und mehr als
 * MAX_BUTTONS kommen nicht durch – die Liste kommt vom Hub und könnte
 * aus einer älteren Fassung stammen.
 */
export function resolveButtons(
  keys: string[] | undefined,
  scenes: Scene[],
  entities: Entity[]
): WidgetButton[] {
  const gewählt = keys ?? STANDARD;
  const gesehen = new Set<string>();
  const knöpfe: WidgetButton[] = [];
  for (const key of gewählt) {
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    const knopf = resolveButton(key, scenes, entities);
    if (knopf) knöpfe.push(knopf);
    if (knöpfe.length >= MAX_BUTTONS) break;
  }
  return knöpfe;
}

/**
 * Was sich noch hinzufügen lässt.
 *
 * Nur Schaltbares: Ein Temperaturfühler als Widget-Knopf wäre ein Knopf,
 * der beim Antippen nichts tun kann. Ausgeblendetes und in einer Leuchte
 * aufgegangene Lichter ebenfalls nicht – die tauchen in der App auch
 * nirgends auf.
 */
export function addableButtons(
  chosen: string[],
  scenes: Scene[],
  entities: Entity[]
): WidgetButton[] {
  const drin = new Set(chosen);
  const angebot: WidgetButton[] = [];
  for (const key of Object.keys(FEST)) {
    if (!drin.has(key)) angebot.push(FEST[key]);
  }
  for (const scene of scenes) {
    const key = `scene:${scene.id}`;
    if (drin.has(key)) continue;
    const knopf = resolveButton(key, scenes, entities);
    if (knopf) angebot.push(knopf);
  }
  for (const entity of entities) {
    const key = `entity:${entity.id}`;
    if (drin.has(key)) continue;
    if (entity.combined_into) continue;
    if (!entity.commands.some((command) => SCHALTBAR.has(command))) continue;
    const knopf = resolveButton(key, scenes, entities);
    if (knopf) angebot.push(knopf);
  }
  return angebot;
}

/**
 * Welcher Befehl hinter einem Geräteknopf steckt.
 *
 * Umschalten, wo das Gerät es kann – sonst das Gegenteil des jetzigen
 * Zustands. `null` heisst: Dieses Gerät lässt sich so nicht bedienen,
 * dann passiert nichts. Schlösser stehen bewusst nicht hier; die
 * bekommen ihre Rückfrage, statt einen Befehl.
 */
export function widgetCommand(entity: Entity): string | null {
  const kann = (command: string) => entity.commands.includes(command);
  if (kann('toggle')) return 'toggle';
  const an = entity.state.state === 'on' || entity.state.state === 'open';
  if (an) {
    if (kann('turn_off')) return 'turn_off';
    if (kann('close')) return 'close';
  } else {
    if (kann('turn_on')) return 'turn_on';
    if (kann('open')) return 'open';
  }
  return null;
}

/**
 * Einen Knopf um eine Stelle verschieben.
 *
 * Rein, damit sich das Verhalten am Rand prüfen lässt: Der erste kann
 * nicht weiter nach oben, der letzte nicht weiter nach unten – dort
 * passiert nichts, statt dass der Knopf ans andere Ende springt.
 */
export function moveButton(
  keys: string[],
  index: number,
  richtung: -1 | 1
): string[] {
  const ziel = index + richtung;
  if (index < 0 || index >= keys.length) return keys;
  if (ziel < 0 || ziel >= keys.length) return keys;
  const next = [...keys];
  [next[index], next[ziel]] = [next[ziel], next[index]];
  return next;
}


/**
 * Darf dieser Knopf direkt schalten? (rein, testbar)
 *
 * Seit iOS 17 kann ein Widget-Knopf selbst schalten, ohne die App zu
 * öffnen. Für den Türöffner und den Alarm bleibt der Umweg Absicht –
 * ein Schloss vom Sperrbildschirm ohne Rückfrage ist genau der Knopf,
 * den man nicht will. Für eine Szene oder ein Licht ist der Umweg keine
 * Sicherheit mehr, nur noch Reibung.
 */
export function darfDirekt(key: string, entities: Entity[]): boolean {
  if (key.startsWith('scene:')) return true;
  if (!key.startsWith('entity:')) return false;
  const entity = entities.find((entry) => entry.id === key.slice('entity:'.length));
  if (!entity) return false;
  return entity.kind === 'light' || entity.kind === 'switch';
}

/** Warum ein Knopf (nicht) direkt schalten kann. */
export type DirektGrund = 'geht' | 'kein-hausstand' | 'nicht-erlaubt';

/**
 * Kann dieser Knopf direkt schalten – und wenn nein, warum nicht?
 * (rein, testbar)
 *
 * Der Schalter dafür war vorher unsichtbar, sobald der Hausstand aus
 * war: kein Blitz, kein Hinweis, nichts. Genau dort fehlte die
 * Erklärung. Der gemeldete Fall: «Mit den Widgets steuert man nichts,
 * es öffnet sich nur die App» – und in der App stand nirgends, warum.
 */
export function direktMoeglich(
  key: string,
  entities: Entity[],
  dataEnabled: boolean
): DirektGrund {
  if (!darfDirekt(key, entities)) return 'nicht-erlaubt';
  // Direkt schalten braucht das Token in der App-Gruppe, und das liegt
  // nur dort, wenn der Hausstand eingeschaltet ist.
  if (!dataEnabled) return 'kein-hausstand';
  return 'geht';
}

/**
 * Welche Knöpfe direkt schalten, solange niemand etwas gewählt hat
 * (rein, testbar).
 *
 * Vorher war die Vorgabe «keiner»: Jedes frisch angelegte Widget öffnete
 * bloss die App, und der Schalter dafür war ein Blitzsymbol zwischen
 * vier anderen Symbolen. Wer ein Licht aufs Widget legt, will es
 * schalten – für Tür und Alarm bleibt der Umweg ohnehin, dafür sorgt
 * `darfDirekt`.
 */
export function standardDirekt(keys: string[], entities: Entity[]): string[] {
  return keys.filter((key) => darfDirekt(key, entities));
}

/**
 * Die Direkt-Angaben an die aufgelösten Knöpfe hängen (rein, testbar).
 *
 * Nur wenn der Hausstand eingeschaltet ist: Direkt schalten braucht das
 * Token in der App-Gruppe, und das liegt nur dort, wenn man sich für
 * den Hausstand entschieden hat – dieselbe Abwägung, ein Schalter.
 */
export function mitDirekt(
  buttons: WidgetButton[],
  directKeys: string[],
  entities: Entity[],
  dataEnabled: boolean
): WidgetButton[] {
  const ohneDirekt = (knopf: WidgetButton): WidgetButton => {
    const rest = { ...knopf };
    delete rest.direct;
    delete rest.actionPath;
    delete rest.actionBody;
    return rest;
  };
  if (!dataEnabled) {
    return buttons.map(ohneDirekt);
  }
  return buttons.map((knopf) => {
    if (!directKeys.includes(knopf.key) || !darfDirekt(knopf.key, entities)) {
      return ohneDirekt(knopf);
    }
    if (knopf.key.startsWith('scene:')) {
      const id = knopf.key.slice('scene:'.length);
      return {
        ...knopf,
        direct: true,
        actionPath: `/api/scenes/${encodeURIComponent(id)}/activate`,
        actionBody: '',
      };
    }
    const id = knopf.key.slice('entity:'.length);
    const entity = entities.find((entry) => entry.id === id);
    const command = entity?.commands.includes('toggle') ? 'toggle' : 'turn_on';
    return {
      ...knopf,
      direct: true,
      actionPath: `/api/entities/${encodeURIComponent(id)}/command`,
      actionBody: JSON.stringify({ command }),
    };
  });
}
