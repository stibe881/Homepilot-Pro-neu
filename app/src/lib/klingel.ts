/**
 * Was das Klingel-Vollbild anbietet, und wie lange es stehen bleibt.
 *
 * Wer klingelt, steht vor der Haustüre – aber hineinkommen muss er
 * durch zwei: unten die Haustüre, oben die Wohnungstüre. Bisher bot das
 * Vollbild nur die erste an, und für die zweite musste man das Bild
 * wegwischen und in den Geräten suchen, während der Besuch im
 * Treppenhaus wartet.
 */
import { Entity } from '../api/types';

/** So lange bleibt das Vollbild stehen, wenn niemand etwas tut.
 *
 *  Es von Hand wegwischen zu müssen ist die schlechtere Vorgabe: Am
 *  Wandpanel bliebe sonst ein Kamerabild der Strasse stehen, bis es
 *  jemand bemerkt. */
export const AUTO_SCHLIESSEN_SEKUNDEN = 60;

/** Welcher Befehl diese Türe tatsächlich öffnet (rein, testbar).
 *
 *  Die Reihenfolge ist kein Geschmack: `unlock` macht bei einem Nuki
 *  bloss den Riegel auf, die Türe bleibt zu. Wer im Treppenhaus steht,
 *  kommt erst mit `unlatch` herein – die Falle wird gezogen. */
export function oeffnungsBefehl(entity: Entity): string | null {
  for (const befehl of ['open_door', 'unlatch', 'unlock']) {
    if (entity.commands.includes(befehl)) return befehl;
  }
  return null;
}

/** Ob dieser Befehl die Türe wirklich aufmacht oder nur entriegelt. */
export function befehlLabel(entity: Entity): string {
  const befehl = oeffnungsBefehl(entity);
  return befehl === 'unlock' ? `${entity.name} entriegeln` : `${entity.name} öffnen`;
}

/**
 * Wer klingelt gerade? (rein, testbar)
 *
 * Die Frage sah lange leichter aus, als sie ist. Gesucht wurde eine
 * Kamera mit `ring: on` – und genau daran ging der Fall vorbei, der hier
 * im Haus zählt: Die Haustüre ist eine Ring-Gegensprechanlage, und die
 * legt der Hub als Türe an, nicht als Kamera (sie hat einen Türöffner,
 * kein Bild). Es klingelte also, das Feld stand auf «on», und niemand
 * sah hin. Was das Vollbild auslöst, ist das Klingeln selbst – die
 * Geräteart hat damit nichts zu tun.
 */
export function klingeltGerade(entities: Entity[]): Entity | undefined {
  const klingelnde = entities.filter((entity) => entity.state?.ring === 'on');
  // Klingelt beides – Türklingel mit Kamera und Anlage –, gewinnt die
  // Kamera: Sie ist die, die etwas zu zeigen hat.
  return klingelnde.find((entity) => entity.kind === 'camera') ?? klingelnde[0];
}

/**
 * Welches Bild zum Klingeln gehört (rein, testbar).
 *
 * Eine Gegensprechanlage hat keines. Hängt aber eine Kamera an derselben
 * Türe, zeigt man die – wer klingelt, will man sehen, und dass Bild und
 * Klingel technisch zwei Geräte sind, ist nicht das Problem dessen, der
 * gerade zur Türe geht.
 */
export function klingelBild(
  entities: Entity[],
  ausloeser?: Entity
): Entity | undefined {
  if (!ausloeser) return undefined;
  if (ausloeser.kind === 'camera') return ausloeser;
  return entities.find(
    (entity) =>
      entity.kind === 'camera' &&
      ((!!entity.room && entity.room === ausloeser.room) ||
        entity.integration === ausloeser.integration)
  );
}

/** Ein Knopf im Klingel-Vollbild: eine Türe und ein Befehl. */
export interface KlingelAktion {
  /** Eindeutig über beide Felder – eine Türe kann zwei Knöpfe stellen. */
  id: string;
  entity: Entity;
  befehl: string;
  /** Was auf dem Knopf steht. */
  label: string;
  /** Macht dieser Befehl die Türe wirklich auf? */
  oeffnet: boolean;
}

/** Wie ein Befehl auf Deutsch heisst und ob er die Türe aufmacht. */
const BEFEHLE: Record<string, { wort: string; oeffnet: boolean }> = {
  // Die Gegensprechanlage summt die Haustüre auf.
  open_door: { wort: 'öffnen', oeffnet: true },
  // Beim Nuki wird die Falle gezogen – die Türe geht wirklich auf.
  unlatch: { wort: 'öffnen', oeffnet: true },
  // Nur der Riegel. Die Türe bleibt zu, man muss sie drücken.
  unlock: { wort: 'aufschliessen', oeffnet: false },
};

/** Höchstens so viele Knöpfe. Mehr ist unter Zeitdruck eine Suchaufgabe. */
export const HOECHSTENS_AKTIONEN = 4;

/**
 * Was beim Klingeln zur Auswahl steht (rein, testbar).
 *
 * Zwei Änderungen gegenüber «eine Türe, ein Knopf»:
 *
 * Erstens kann eine Türe zwei Dinge. Ein Nuki schliesst auf (Riegel) und
 * öffnet (Falle) – das sind zwei verschiedene Handgriffe, und bisher bot
 * das Vollbild nur den zweiten an. Wer bloss aufschliessen wollte, weil
 * der Besuch selbst drücken kann, fand den Knopf nicht.
 *
 * Zweitens steht die Türe der Klingel selbst vorn: Sie gehört zu dem,
 * was man gerade ansieht. Die Wohnungstüre steht nirgends als «zur
 * Klingel gehörig» geschrieben und kommt danach.
 */
export function klingelAktionen(
  entities: Entity[],
  ausloeser?: Entity
): KlingelAktion[] {
  const tueren = entities.filter(
    (entity) => entity.kind === 'lock' && oeffnungsBefehl(entity) !== null
  );
  const eigene = (entity: Entity) =>
    !!ausloeser &&
    (entity.id === ausloeser.id ||
      entity.integration === ausloeser.integration ||
      (!!entity.room && entity.room === ausloeser.room));
  const geordnet = [
    ...tueren.filter(eigene),
    ...tueren.filter((entity) => !eigene(entity)),
  ];
  const aktionen: KlingelAktion[] = [];
  for (const entity of geordnet) {
    // Erst aufschliessen, dann öffnen: die vorsichtigere Handlung zuerst.
    // Ein Fehlgriff auf dem oberen Knopf lässt die Türe wenigstens zu.
    for (const befehl of ['unlock', 'unlatch', 'open_door']) {
      const wort = BEFEHLE[befehl];
      if (!wort || !entity.commands.includes(befehl)) continue;
      aktionen.push({
        id: `${entity.id}:${befehl}`,
        entity,
        befehl,
        label: `${entity.name} ${wort.wort}`,
        oeffnet: wort.oeffnet,
      });
    }
  }
  return aktionen.slice(0, HOECHSTENS_AKTIONEN);
}

/** Wie viele Sekunden noch bleiben (rein, testbar).
 *
 *  Aus der Uhr gerechnet, nicht aus gezählten Takten: Der Takt der App
 *  hält an, solange sie im Hintergrund ist. Wer eine halbe Stunde später
 *  zurückkommt, hätte sonst noch 59 Sekunden vor sich. */
export function restSekunden(frist: number, jetzt: number): number {
  return Math.max(0, Math.ceil((frist - jetzt) / 1000));
}

/** Der Zeitpunkt, an dem das Vollbild von selbst geht. */
export function neueFrist(jetzt: number): number {
  return jetzt + AUTO_SCHLIESSEN_SEKUNDEN * 1000;
}

/**
 * Die Zustandszeile der Haustüren-Kachel auf der Startseite (rein,
 * testbar).
 *
 * Dort stand fest «Gegensprechanlage» – das Wort sagt nichts, was die
 * Überschrift «Haustüre» nicht schon sagt, und es steht an der Stelle,
 * an der die Nachbarkachel «Abgeschlossen» zeigt. Eine Zeile, die immer
 * dasselbe sagt, ist keine Auskunft.
 *
 * Jetzt steht dort etwas oder nichts: «Nicht erreichbar», wenn die
 * Anlage weg ist; sonst der Zeitpunkt des letzten Klingelns, solange er
 * von heute ist. Nichts zu schreiben ist besser als Füllwort.
 */
export function haustuerZeile(
  state: Record<string, unknown> | undefined,
  jetzt: Date
): string | null {
  if (!state) return null;
  if (String(state.state ?? '') === 'offline') return 'Nicht erreichbar';
  const roh = state.last_ring;
  if (typeof roh !== 'string' && typeof roh !== 'number') return null;
  const datum = new Date(typeof roh === 'number' ? roh * 1000 : roh);
  if (Number.isNaN(datum.getTime())) return null;
  // Ein Klingeln von vorgestern beantwortet keine Frage, die sich jemand
  // auf der Startseite stellt.
  if (datum.toDateString() !== jetzt.toDateString()) return null;
  const uhr = `${String(datum.getHours()).padStart(2, '0')}:${String(
    datum.getMinutes()
  ).padStart(2, '0')}`;
  return `Zuletzt geklingelt ${uhr}`;
}
