/**
 * Die Raumkachel mit Kopfbild: drei Knöpfe statt neun Zeilen.
 *
 * Die alte Kachel führte jedes Gerät in einer eigenen Zeile auf. Das ist
 * vollständig und darum dicht: Neun Geräte ergaben eine Kachel, die höher
 * war als ihre Nachbarn, und alle Zeilen wogen gleich viel – das brennende
 * Deckenlicht sah aus wie der Fernseher, der seit gestern still ist.
 *
 * Diese Kachel zeigt stattdessen, was man im Vorbeigehen wirklich tut:
 * **Licht, Storen, Musik.** Alles Einzelne ist einen Tipp entfernt, dort,
 * wo ohnehin die volle Raumansicht steht.
 *
 * Drei und nicht mehr: Vier Knöpfe passen auf einem Telefon nicht mehr
 * nebeneinander, ohne dass die Beschriftung umbricht. Was ein Zimmer
 * nicht hat, fehlt einfach – ein Storen-Knopf im Bad ohne Storen wäre ein
 * Knopf, der nichts tut.
 *
 * Reines Rechnen: hinein die Geräte des Raums, heraus die Knöpfe und die
 * Befehle, die dahinterliegen.
 */

import { Entity } from '../api/types';

export type AktionsArt = 'licht' | 'storen' | 'musik';

export interface Raumaktion {
  art: AktionsArt;
  label: string;
  /** Ionicons-Name; die Kachel setzt ihn ein, die Liste kennt ihn nur. */
  icon: string;
  /** Leuchtet der Knopf? «An» heisst: Es läuft etwas, ein Tipp beendet es. */
  an: boolean;
  /** Was beim Tippen hinausgeht – eines je betroffenem Gerät. */
  befehle: { entityId: string; command: string }[];
}

/** Lichter des Raums – Leuchten wie Schalter, die sich schalten lassen. */
function lichter(items: Entity[]): Entity[] {
  return items.filter(
    (entity) =>
      (entity.kind === 'light' || entity.kind === 'switch') &&
      entity.commands.includes('toggle')
  );
}

function storen(items: Entity[]): Entity[] {
  return items.filter(
    (entity) =>
      entity.kind === 'cover' &&
      (entity.commands.includes('open') || entity.commands.includes('close'))
  );
}

function boxen(items: Entity[]): Entity[] {
  return items.filter(
    (entity) =>
      entity.kind === 'media_player' &&
      (entity.commands.includes('toggle') ||
        (entity.commands.includes('play') && entity.commands.includes('pause')))
  );
}

/** Steht diese Store (mindestens halb) offen? */
function offen(entity: Entity): boolean {
  const position = entity.state.position;
  if (typeof position === 'number') return position > 1;
  return entity.state.state !== 'closed';
}

/**
 * Die Schnellknöpfe dieses Raums (rein, testbar).
 *
 * Jeder Knopf schaltet alles seiner Art auf einmal – «Licht» im
 * Wohnzimmer meint die drei Lampen darin, nicht eine davon. Die Richtung
 * entscheidet der Bestand: Brennt irgendetwas, macht der Tipp alles aus.
 * Andersherum wäre der zweite Tipp auf denselben Knopf wirkungslos, und
 * man drückte im Dunkeln weiter.
 */
export function raumaktionen(items: Entity[]): Raumaktion[] {
  const aktionen: Raumaktion[] = [];

  const lampen = lichter(items);
  if (lampen.length > 0) {
    const brennt = lampen.some((entity) => entity.state.state === 'on');
    aktionen.push({
      art: 'licht',
      label: 'Licht',
      icon: brennt ? 'bulb' : 'bulb-outline',
      an: brennt,
      // «toggle» je Lampe wäre falsch: Brennen zwei von drei, machte der
      // eine Tipp zwei aus und die dritte an. Also ausdrücklich.
      befehle: lampen
        .filter((entity) => (entity.state.state === 'on') === brennt)
        .map((entity) => ({
          entityId: entity.id,
          command: brennt ? 'turn_off' : 'turn_on',
        })),
    });
  }

  const rollos = storen(items);
  if (rollos.length > 0) {
    const stehtOffen = rollos.some(offen);
    aktionen.push({
      art: 'storen',
      label: 'Storen',
      icon: stehtOffen ? 'arrow-down' : 'arrow-up',
      // Storen kennen kein «an»: Offen ist kein Betrieb, den man beendet.
      // Der Knopf sagt über seinen Pfeil, wohin es geht.
      an: false,
      befehle: rollos
        .filter((entity) => offen(entity) === stehtOffen)
        .map((entity) => ({
          entityId: entity.id,
          command: stehtOffen ? 'close' : 'open',
        })),
    });
  }

  // Nur eine Box je Raum: Zwei gleichzeitig zu starten ist nichts, was
  // jemand von einem Knopf erwartet. Die spielende gewinnt.
  const spielt = boxen(items).find((entity) => entity.state.state === 'playing');
  const box = spielt ?? boxen(items)[0];
  if (box) {
    const laeuft = box.state.state === 'playing';
    aktionen.push({
      art: 'musik',
      label: 'Musik',
      icon: laeuft ? 'pause' : 'play',
      an: laeuft,
      befehle: [
        {
          entityId: box.id,
          command: box.commands.includes('toggle') ? 'toggle' : laeuft ? 'pause' : 'play',
        },
      ],
    });
  }

  return aktionen;
}

/**
 * Die Farbe einer Kachel ohne Foto (rein, testbar).
 *
 * Kein Grau und kein Fragezeichen: Ein Zimmer ohne Bild soll nach einer
 * Entscheidung aussehen, nicht nach einem Fehler. Der Farbton kommt aus
 * dem Namen – dasselbe Zimmer bekommt so immer dieselbe Farbe, und zwei
 * Zimmer nebeneinander fast nie dieselbe.
 *
 * Der Bereich ist eng gehalten (Violett über Rot bis Ocker, gedeckt): Der
 * Kopf trägt weissen Text, und quer durch den ganzen Farbkreis wären
 * Giftgrün und Knallgelb dabei.
 *
 * Er beginnt bewusst erst bei 250 Grad und nicht im Blau: Der Hintergrund
 * der App ist ein blaues Grau (#8B9AB0 hell, #2B3341 dunkel), und ein
 * blaugrauer Kopf darauf las sich nicht als Fläche, sondern als Loch.
 * Die Sattheit ist aus demselben Grund höher, als eine Fläche sie
 * bräuchte.
 */
export function raumFarben(name: string): [string, string] {
  let summe = 0;
  for (const zeichen of name.trim().toLowerCase()) {
    summe = (summe * 31 + zeichen.charCodeAt(0)) % 100000;
  }
  const ton = 250 + (summe % 140); // 250° bis 30° (über den Nullpunkt)
  return [`hsl(${ton % 360}, 38%, 44%)`, `hsl(${(ton + 22) % 360}, 42%, 25%)`];
}

/**
 * Was unter dem Bild steht (rein, testbar).
 *
 * Eine Zeile, nicht drei: Der Zustand des Raums («21,3° · 47 %»), was
 * gerade läuft, und wie viele Geräte es überhaupt sind – aber nur, was
 * wirklich etwas sagt. «0 an» ist keine Auskunft, «alles ruhig» schon.
 */
export function raumStand(items: Entity[], zeile: string): string {
  const an = items.filter(
    (entity) => entity.state.state === 'on' || entity.state.state === 'playing'
  ).length;
  const teile = zeile ? [zeile] : [];
  teile.push(an > 0 ? `${an} an` : 'alles ruhig');
  return teile.join(' · ');
}
