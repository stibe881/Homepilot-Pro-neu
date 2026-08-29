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
 * Zeigt dieses Gerät jetzt das Vollbild? (rein, testbar)
 *
 * Drei Bedingungen, und die dritte ist die neue: Es klingelt gerade,
 * dieses Klingeln wurde hier noch nicht weggewischt - und das Gerät
 * steht im Wandpanel-Modus.
 *
 * Vorher sprang das Bild auf jedem angemeldeten Gerät auf. Gemeint war
 * es fürs Panel im Flur: Dort steht man davor, sieht, wer läutet, und
 * drückt auf. Auf dem Telefon in der Hosentasche ist dasselbe Vollbild
 * etwas anderes - es reisst einem die App unter der Hand weg, mitten in
 * dem, was man gerade tat, und das auch dann, wenn man gar nicht zuhause
 * ist. Wer unterwegs wissen will, dass jemand vor der Türe steht,
 * bekommt eine Nachricht; die kann man lesen, wenn man mag.
 *
 * Der Modus gehört zum Gerät, nicht zur Person (api/types.ts): Genau
 * darum lässt sich das hier so entscheiden. Dasselbe Konto am Panel und
 * am Telefon - das eine zeigt, das andere nicht.
 */
export function vollbildZeigen(opts: {
  /** Steht dieses Gerät im Wandpanel-Modus? */
  panel?: boolean;
  /** Kennung des laufenden Klingelns – null heisst: es klingelt nicht. */
  ringKey: string | null;
  /** Welches Klingeln hier schon weggewischt wurde. */
  weggewischt: string | null;
}): boolean {
  if (!opts.panel) return false;
  if (!opts.ringKey) return false;
  return opts.weggewischt !== opts.ringKey;
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

/** Ein Schritt: eine Türe, ein Befehl. */
export interface KlingelSchritt {
  entity: Entity;
  befehl: string;
}

/** Ein Knopf im Klingel-Vollbild – ein Handgriff, oft über zwei Türen. */
export interface KlingelAktion {
  id: string;
  /** Was dieser Knopf schickt, in dieser Reihenfolge: unten zuerst. */
  schritte: KlingelSchritt[];
  /** Was auf dem Knopf steht. */
  label: string;
  /** Macht dieser Knopf am Ende eine Türe wirklich auf? */
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

/** Der zurückhaltendste Befehl, den diese Türe kann (rein, testbar).
 *
 *  Der Riegel, wenn sie einen hat - sonst bleibt nur das Öffnen. Eine
 *  Gegensprechanlage kann nur summen; sie hat kein «nur aufschliessen». */
export function leiserBefehl(entity: Entity): string | null {
  for (const befehl of ['unlock', 'unlatch', 'open_door']) {
    if (entity.commands.includes(befehl)) return befehl;
  }
  return null;
}

/** Die Türen in der Reihenfolge, in der man sie durchschreitet (rein). */
export function tuerenFuerKlingel(entities: Entity[], ausloeser?: Entity): Entity[] {
  const tueren = entities.filter(
    (entity) => entity.kind === 'lock' && oeffnungsBefehl(entity) !== null
  );
  // Die Türe der Klingel zuerst: Sie ist die untere, durch die der Besuch
  // zuerst muss - und die, die man gerade ansieht.
  const eigene = (entity: Entity) =>
    !!ausloeser &&
    (entity.id === ausloeser.id ||
      entity.integration === ausloeser.integration ||
      (!!entity.room && entity.room === ausloeser.room));
  return [...tueren.filter(eigene), ...tueren.filter((entity) => !eigene(entity))];
}

/** Wie ein Weg heisst, wenn er über alle Türen geht. */
function alleWort(anzahl: number): string {
  return anzahl === 2 ? 'Beide' : 'Alle Türen';
}

/**
 * Was beim Klingeln zur Auswahl steht (rein, testbar).
 *
 * Bei *einer* Türe steht, was sie kann: aufschliessen (Riegel) und
 * öffnen (Falle) sind zwei verschiedene Handgriffe, und wer bloss
 * aufschliessen will, weil der Besuch selbst drücken kann, soll das
 * können.
 *
 * Bei *zwei* Türen war genau das der Umweg. Wer im Treppenhaus wartet,
 * muss durch beide - und man tippte erst unten auf, wartete, tippte oben
 * auf. Deshalb hier ganze Wege statt einzelner Türen:
 *
 * 1. **Nur unten.** Der Besuch kommt ins Treppenhaus, oben klingelt er
 *    nochmal - das ist der normale Fall beim Paketboten.
 * 2. **Beide aufschliessen.** Beide Riegel zurück; die Wohnungstüre
 *    bleibt zu und muss gedrückt werden.
 * 3. **Beide öffnen.** Auch die Falle - der Besuch kann durchlaufen.
 *
 * Wo eine Türe nur eines kann, fallen doppelte Wege weg: Ein Knopf, der
 * dasselbe tut wie der darüber, ist unter Zeitdruck eine Falle.
 */
export function klingelAktionen(
  entities: Entity[],
  ausloeser?: Entity
): KlingelAktion[] {
  const tueren = tuerenFuerKlingel(entities, ausloeser);
  if (tueren.length === 0) return [];

  const wort = (befehl: string) => BEFEHLE[befehl]?.wort ?? 'öffnen';
  const oeffnet = (befehl: string) => BEFEHLE[befehl]?.oeffnet ?? false;

  // Eine Türe: wie gehabt, ein Knopf je Handgriff.
  if (tueren.length === 1) {
    const tuere = tueren[0];
    const aktionen: KlingelAktion[] = [];
    for (const befehl of ['unlock', 'unlatch', 'open_door']) {
      if (!BEFEHLE[befehl] || !tuere.commands.includes(befehl)) continue;
      aktionen.push({
        id: `${tuere.id}:${befehl}`,
        schritte: [{ entity: tuere, befehl }],
        label: `${tuere.name} ${wort(befehl)}`,
        oeffnet: oeffnet(befehl),
      });
    }
    return aktionen.slice(0, HOECHSTENS_AKTIONEN);
  }

  const unten = tueren[0];
  const untenLeise = leiserBefehl(unten) as string;
  const wege: KlingelAktion[] = [
    {
      id: 'unten',
      schritte: [{ entity: unten, befehl: untenLeise }],
      label: `${unten.name} ${wort(untenLeise)}`,
      oeffnet: oeffnet(untenLeise),
    },
  ];

  const leise = tueren.map((entity) => ({
    entity,
    befehl: leiserBefehl(entity) as string,
  }));
  const stark = tueren.map((entity) => ({
    entity,
    befehl: oeffnungsBefehl(entity) as string,
  }));
  const gleich = (a: KlingelSchritt[], b: KlingelSchritt[]) =>
    a.length === b.length &&
    a.every((schritt, i) => schritt.befehl === b[i].befehl);

  // Benannt nach der letzten Türe: Dort endet der Weg, und dort liegt
  // der Unterschied zwischen «aufschliessen» und «öffnen». Was unten
  // passiert, ist in beiden Fällen dasselbe.
  const letzterLeise = leise[leise.length - 1].befehl;
  wege.push({
    id: 'alle-leise',
    schritte: leise,
    label: `${alleWort(tueren.length)} ${wort(letzterLeise)}`,
    oeffnet: leise.some((schritt) => oeffnet(schritt.befehl)),
  });

  // Nur, wenn er wirklich etwas anderes tut: Kann keine Türe mehr als
  // aufschliessen, wäre der dritte Knopf eine Wiederholung.
  if (!gleich(leise, stark)) {
    wege.push({
      id: 'alle-stark',
      schritte: stark,
      label: `${alleWort(tueren.length)} öffnen`,
      oeffnet: true,
    });
  }
  return wege.slice(0, HOECHSTENS_AKTIONEN);
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
