import { Entity, Scene } from '../api/types';
import { haustuerFuerWatch } from './watchkontext';

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
 * Warum jeder Knopf eine Adresse trägt: Sie ist der Rückfall. Auf altem
 * iOS (vor 17) und ohne Hausstand in der App-Gruppe öffnet ein Tipp die
 * App an der richtigen Stelle; wo beides da ist, entscheidet
 * `darfDirekt`, ob er stattdessen selbst schaltet.
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

/** Acht, seit die Knöpfe im Widget in Reihen umbrechen: mittel und
 *  gross zeigen zwei Reihen zu vier, die kleine Grösse die ersten vier.
 *  Vorher waren es vier - und wer seine Szenen ins Widget wollte, musste
 *  dafür Tür oder Alarm opfern. */
export const MAX_BUTTONS = 8;

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


/** Womit ein Schloss die Türe wirklich öffnet – oder null, wenn es das
 *  nicht kann. Dieselbe Wahl wie beim Watch-Kontext: erst `open_door`,
 *  sonst `unlatch`. Ein Schloss, das nur ver- und entriegelt, bleibt
 *  draussen – ihm blind `unlatch` zu schicken wäre ein Knopf, der nichts
 *  tut. */
export function tuerBefehl(entity: Entity): string | null {
  if (entity.commands.includes('open_door')) return 'open_door';
  if (entity.commands.includes('unlatch')) return 'unlatch';
  return null;
}

/**
 * Darf dieser Knopf direkt schalten? (rein, testbar)
 *
 * Seit iOS 17 kann ein Widget-Knopf selbst schalten, ohne die App zu
 * öffnen. Für eine Szene oder ein Licht ist der Umweg über die App keine
 * Sicherheit, nur Reibung. Der Türöffner behält ihn, **solange die
 * Tür-Rückfrage eingeschaltet ist** – dieselbe Abwägung wie in der App
 * (lib/tuerbestaetigung.ts): Wer die Rückfrage ausdrücklich abgestellt
 * hat, will auch am Widget keinen Umweg mehr. Die gemeldete Klage war
 * genau die: zwei Schlösser auf dem Widget, und jeder Tipp öffnete nur
 * die App. Nur «Alles aus» und der Alarm bleiben immer beim Umweg –
 * die räumen das halbe Haus ab, das soll man sehen, bevor es passiert.
 */
export function darfDirekt(
  key: string,
  entities: Entity[],
  tuerOhneRueckfrage = false
): boolean {
  if (key.startsWith('scene:')) return true;
  if (key === 'door') {
    if (!tuerOhneRueckfrage) return false;
    const tuer = haustuerFuerWatch(entities);
    return tuer !== null && tuerBefehl(tuer) !== null;
  }
  if (!key.startsWith('entity:')) return false;
  const entity = entities.find((entry) => entry.id === key.slice('entity:'.length));
  if (!entity) return false;
  if (entity.kind === 'lock') {
    return tuerOhneRueckfrage && tuerBefehl(entity) !== null;
  }
  return entity.kind === 'light' || entity.kind === 'switch';
}

/** Warum ein Knopf (nicht) direkt schalten kann. */
export type DirektGrund = 'geht' | 'kein-hausstand' | 'rueckfrage' | 'nicht-erlaubt';

/**
 * Kann dieser Knopf direkt schalten – und wenn nein, warum nicht?
 * (rein, testbar)
 *
 * Der Schalter dafür war vorher unsichtbar, sobald der Hausstand aus
 * war: kein Blitz, kein Hinweis, nichts. Genau dort fehlte die
 * Erklärung. Der gemeldete Fall: «Mit den Widgets steuert man nichts,
 * es öffnet sich nur die App» – und in der App stand nirgends, warum.
 * «rueckfrage» ist der neue dritte Grund: Ein Schloss dürfte, sobald
 * die Tür-Rückfrage aus ist – auch das muss die App sagen können.
 */
export function direktMoeglich(
  key: string,
  entities: Entity[],
  dataEnabled: boolean,
  tuerOhneRueckfrage = false
): DirektGrund {
  if (!darfDirekt(key, entities, tuerOhneRueckfrage)) {
    return darfDirekt(key, entities, true) ? 'rueckfrage' : 'nicht-erlaubt';
  }
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
 * schalten – wo der Umweg bleiben muss, dafür sorgt `darfDirekt`.
 */
export function standardDirekt(
  keys: string[],
  entities: Entity[],
  tuerOhneRueckfrage = false
): string[] {
  return keys.filter((key) => darfDirekt(key, entities, tuerOhneRueckfrage));
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
  dataEnabled: boolean,
  tuerOhneRueckfrage = false
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
    if (
      !directKeys.includes(knopf.key) ||
      !darfDirekt(knopf.key, entities, tuerOhneRueckfrage)
    ) {
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
    if (knopf.key === 'door') {
      // Dieselbe Türe und derselbe Befehl wie auf der Uhr - zwei
      // Meinungen darüber, was «die Haustüre» ist, wären eine zu viel.
      const tuer = haustuerFuerWatch(entities)!;
      return {
        ...knopf,
        direct: true,
        actionPath: `/api/entities/${encodeURIComponent(tuer.id)}/command`,
        actionBody: JSON.stringify({ command: tuerBefehl(tuer) }),
      };
    }
    const id = knopf.key.slice('entity:'.length);
    const entity = entities.find((entry) => entry.id === id);
    // Ein Schloss öffnet die Türe, alles andere schaltet um.
    const command =
      entity?.kind === 'lock'
        ? tuerBefehl(entity)
        : entity?.commands.includes('toggle')
          ? 'toggle'
          : 'turn_on';
    return {
      ...knopf,
      direct: true,
      actionPath: `/api/entities/${encodeURIComponent(id)}/command`,
      actionBody: JSON.stringify({ command }),
    };
  });
}
