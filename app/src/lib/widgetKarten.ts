/**
 * Eigene Widgets – je eines für ein Gerät oder eine Szene.
 *
 * Bis hierher gab es genau ein Widget: eine Knopfleiste mit Türstatus.
 * Wer wissen wollte, ob das Küchenlicht brennt, musste die App öffnen –
 * obwohl ein Widget genau dafür da ist, im Vorbeigehen gelesen zu
 * werden. Und wer eine Szene aufs Widget wollte, bekam einen von vier
 * kleinen Knöpfen, keine Karte.
 *
 * Hier steht, was eine solche Karte ist. Zusammengestellt wird sie in
 * Einstellungen → Widgets; auf den Homescreen legt sie iOS, und dort
 * wählt man beim Anlegen aus, welche der Karten dieses Widget zeigt.
 *
 * Dieselbe Schlüsselsprache wie bei den Knöpfen (`entity:…`, `scene:…`),
 * damit beides aus derselben Auswahl kommt und niemand zwei Vokabeln
 * lernen muss. Die Abkürzungen `door`, `alloff` und `alarm` fehlen
 * bewusst: Eine Karte zeigt einen Zustand, und «Alles aus» hat keinen.
 */
import { Entity, Scene } from '../api/types';

import { kurz, resolveButton } from './widgetButtons';

/** Was am Ende in der App-Gruppe liegt und das Widget zeichnet. */
export interface WidgetKarte {
  /** 'entity:<id>' oder 'scene:<id>'. */
  key: string;
  /** Die Kennung dahinter – damit das Widget den Zustand erfragen kann. */
  id: string;
  kind: 'entity' | 'scene';
  title: string;
  symbol: string;
  /** homepilot://… – wohin ein Tipp führt, wenn nicht direkt geschaltet
   *  wird. */
  url: string;
  /** Was der Knopf auf der Karte aufruft. Fehlt, wenn der Hausstand aus
   *  ist: Ohne Token im Widget kann es nichts schalten. */
  actionPath?: string;
  actionBody?: string;
}

/**
 * Mehr Karten als das: Wer zwölf Widgets auf dem Homescreen hat, sucht
 * beim Anlegen des dreizehnten in einer Liste statt in seiner Wohnung.
 */
export const MAX_KARTEN = 8;

/** Auf einer Karte ist mehr Platz als auf einem Knopf – dort sind es
 *  vierzehn Zeichen, hier passt der ganze «Aussentemperatur»-Fühler
 *  hin. */
const TITEL_LAENGE = 22;

/** Was keine Karte werden kann. Nicht aus Strenge, sondern weil eine
 *  Karte einen Zustand in zwei Worten zeigt – und eine Kamera, ein
 *  Kalender oder die Wetterlage das nicht haben. */
const OHNE_KARTE = new Set(['camera', 'calendar', 'weather']);

/**
 * Einen Schlüssel zu einer Karte machen – oder `null`, wenn es das, was
 * er meint, nicht mehr gibt (rein, testbar).
 *
 * Der Fall ist nicht theoretisch: Wer eine Szene löscht, deren Karte auf
 * dem Homescreen liegt, soll dort keine Karte sehen, die ins Leere
 * zeigt.
 */
export function resolveKarte(
  key: string,
  scenes: Scene[],
  entities: Entity[],
  dataEnabled: boolean
): WidgetKarte | null {
  const knopf = resolveButton(key, scenes, entities);
  if (!knopf) return null;
  if (key.startsWith('scene:')) {
    const id = key.slice('scene:'.length);
    const scene = scenes.find((entry) => entry.id === id);
    return {
      key,
      id,
      kind: 'scene',
      title: kurz(scene?.name ?? knopf.title, TITEL_LAENGE),
      symbol: knopf.symbol,
      url: knopf.url,
      ...(dataEnabled
        ? {
            actionPath: `/api/scenes/${encodeURIComponent(id)}/activate`,
            actionBody: '',
          }
        : {}),
    };
  }
  if (!key.startsWith('entity:')) return null;
  const id = key.slice('entity:'.length);
  const entity = entities.find((entry) => entry.id === id);
  if (!entity || OHNE_KARTE.has(entity.kind)) return null;
  // Schalten nur, wo das Gerät es kann. Ein Fühler bekommt keine
  // Schaltfläche – eine Karte, die beim Antippen nichts tut, ist
  // schlimmer als eine, die nur anzeigt.
  const befehl = entity.commands.includes('toggle')
    ? 'toggle'
    : entity.commands.includes('turn_on')
      ? 'turn_on'
      : null;
  return {
    key,
    id,
    kind: 'entity',
    title: kurz(entity.name, TITEL_LAENGE),
    symbol: knopf.symbol,
    url: knopf.url,
    ...(dataEnabled && befehl
      ? {
          actionPath: `/api/entities/${encodeURIComponent(id)}/command`,
          actionBody: JSON.stringify({ command: befehl }),
        }
      : {}),
  };
}

/**
 * Die gespeicherte Liste zu Karten machen (rein, testbar).
 *
 * Verschwundenes fällt still heraus, Doppeltes ebenfalls – die Liste
 * kommt vom Hub und kann älter sein als der Gerätebestand.
 */
export function resolveKarten(
  keys: string[] | undefined,
  scenes: Scene[],
  entities: Entity[],
  dataEnabled: boolean
): WidgetKarte[] {
  const gesehen = new Set<string>();
  const karten: WidgetKarte[] = [];
  for (const key of keys ?? []) {
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    const karte = resolveKarte(key, scenes, entities, dataEnabled);
    if (karte) karten.push(karte);
    if (karten.length >= MAX_KARTEN) break;
  }
  return karten;
}

/** Was sich noch als Karte hinzufügen lässt (rein, testbar). */
export function addableKarten(
  chosen: string[],
  scenes: Scene[],
  entities: Entity[]
): WidgetKarte[] {
  const drin = new Set(chosen);
  const angebot: WidgetKarte[] = [];
  for (const scene of scenes) {
    const key = `scene:${scene.id}`;
    if (drin.has(key)) continue;
    const karte = resolveKarte(key, scenes, entities, false);
    if (karte) angebot.push(karte);
  }
  for (const entity of entities) {
    const key = `entity:${entity.id}`;
    if (drin.has(key)) continue;
    // In einer Leuchte aufgegangene Lichter tauchen in der App auch
    // nirgends auf – sie sollen hier nicht als Einzelnes auferstehen.
    if (entity.combined_into) continue;
    const karte = resolveKarte(key, scenes, entities, false);
    if (karte) angebot.push(karte);
  }
  return angebot;
}

/** Woher die Karte kommt – damit «Küche» als Szene und «Küche» als Licht
 *  in der Auswahl auseinanderzuhalten sind. */
export function karteArt(karte: WidgetKarte): string {
  return karte.kind === 'scene' ? 'Szene' : 'Gerät';
}

/**
 * Der Satz über der Liste (rein, testbar).
 *
 * Er sagt, wo die Karten landen: **im HomePilot-Widget**, unter den
 * Knöpfen. Die erste Fassung schickte einen stattdessen zum «Widget
 * bearbeiten» einer eigenen Widget-Art – und die hier zusammengestellten
 * Karten tauchten im Widget nie auf, weil niemand ahnte, dass man dafür
 * ein zweites Widget anlegen muss.
 */
export function kartenSatz(anzahl: number): string {
  if (anzahl === 0) {
    return 'Noch keine. Eine Karte zeigt ein Gerät oder eine Szene im HomePilot-Widget – mit Zustand und einem Knopf.';
  }
  const wort = anzahl === 1 ? 'Eine Karte steht' : `${anzahl} Karten stehen`;
  return `${wort} im HomePilot-Widget, unterhalb der Knöpfe. Die mittlere Grösse zeigt vier, die grosse alle acht samt Zustand.`;
}

export { kurz };
