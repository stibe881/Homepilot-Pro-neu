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
import { fernbedienungMoeglich } from './fernsehkachel';
import { isTelevision } from './geraeteart';

export type AktionsArt = 'licht' | 'storen' | 'musik' | 'geraet';

export interface Raumaktion {
  art: AktionsArt;
  /** Bei einem Geräte-Knopf: die Entität dahinter. Zugleich der
   *  Schlüssel in der Knopf-Auswahl - die Sammelknöpfe heissen dort
   *  nach ihrer Art, ein Gerät nach seiner Kennung. */
  id?: string;
  label: string;
  /** Ionicons-Name; die Kachel setzt ihn ein, die Liste kennt ihn nur. */
  icon: string;
  /** Leuchtet der Knopf? «An» heisst: Es läuft etwas, ein Tipp beendet es. */
  an: boolean;
  /** Was beim Tippen hinausgeht – eines je betroffenem Gerät. */
  befehle: { entityId: string; command: string }[];
  /** Dieser Knopf macht ein Blatt auf, statt zu schalten.
   *
   *  Wie beim Sammelknopf «Musik», der den Player öffnet: Ein Fernseher
   *  hat nicht «an» und «aus», sondern eine Fernbedienung - und wer auf
   *  der Raumkachel auf «Fernseher» tippt, will umschalten, lauter
   *  stellen, pausieren. Das Ein- und Ausschalten liegt in der
   *  Fernbedienung ganz oben. */
  oeffnet?: 'fernbedienung';
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
      // Kein Play/Pause-Symbol mehr: Der Knopf öffnet seit dem Musik-
      // Blatt den Player (DashboardScreen), statt blind zu schalten -
      // das Symbol soll kein Schalten versprechen. Die Note füllt sich,
      // solange hier Musik läuft.
      icon: laeuft ? 'musical-notes' : 'musical-notes-outline',
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
 * Ein einzelnes Gerät als Kachel-Knopf (rein, testbar).
 *
 * Der Fall dahinter: In Levins Zimmer stand nur «Licht» zur Wahl - was
 * der Raum an Sammelknöpfen nicht hergibt, liess sich auch nicht
 * hinzufügen, und ein einzelnes Gerät («Sternenhimmel») schon gar
 * nicht. Jetzt kann jedes schaltbare Gerät des Raums ein eigener Knopf
 * sein. `null` heisst: Daraus wird kein Knopf - ein Fühler hat nichts
 * zu drücken.
 */
export function geraetAktion(entity: Entity): Raumaktion | null {
  const knopf = (icon: string, an: boolean, command: string): Raumaktion => ({
    art: 'geraet',
    id: entity.id,
    label: entity.name,
    icon,
    an,
    befehle: [{ entityId: entity.id, command }],
  });

  if (
    (entity.kind === 'light' || entity.kind === 'switch') &&
    entity.commands.includes('toggle')
  ) {
    const an = entity.state.state === 'on';
    return knopf(
      entity.kind === 'light'
        ? an
          ? 'bulb'
          : 'bulb-outline'
        : an
          ? 'flash'
          : 'flash-outline',
      an,
      'toggle'
    );
  }
  if (entity.kind === 'cover') {
    if (!entity.commands.includes('open') && !entity.commands.includes('close')) {
      return null;
    }
    const stehtOffen = offen(entity);
    // Wie beim Sammelknopf: Offen ist kein Betrieb - der Pfeil sagt,
    // wohin die Fahrt geht.
    return knopf(stehtOffen ? 'arrow-down' : 'arrow-up', false, stehtOffen ? 'close' : 'open');
  }
  if (entity.kind === 'media_player') {
    const laeuft = entity.state.state === 'playing' || entity.state.state === 'on';
    // Der Fernseher öffnet die Fernbedienung, statt blind zu schalten -
    // dieselbe Entscheidung wie beim Sammelknopf «Musik», der den
    // Player aufmacht. Ein Fernseher, der auf ein Tippen bloss angeht,
    // beantwortet die halbe Frage: Danach steht man vor einem laufenden
    // Gerät und sucht die Fernbedienung.
    if (isTelevision(entity) && fernbedienungMoeglich(entity)) {
      return {
        ...knopf(laeuft ? 'tv' : 'tv-outline', laeuft, laeuft ? 'turn_off' : 'turn_on'),
        oeffnet: 'fernbedienung',
      };
    }
    // Ohne Steuerkreuz (eine Box, ein alter Chromecast) bleibt es beim
    // Schalter: Ein Blatt mit nichts darin wäre schlechter als der
    // Knopf, den es ersetzt.
    if (isTelevision(entity) && entity.commands.includes('turn_on')) {
      return knopf(laeuft ? 'tv' : 'tv-outline', laeuft, laeuft ? 'turn_off' : 'turn_on');
    }
    if (entity.commands.includes('toggle')) {
      return knopf(laeuft ? 'musical-notes' : 'musical-notes-outline', laeuft, 'toggle');
    }
    if (entity.commands.includes('play') && entity.commands.includes('pause')) {
      return knopf(
        laeuft ? 'musical-notes' : 'musical-notes-outline',
        laeuft,
        laeuft ? 'pause' : 'play'
      );
    }
    return null;
  }
  // Eine Hue-Lichtszene («Sternenhimmel») ist genau das, wofür man einen
  // eigenen Knopf will: ein Griff, eine Stimmung.
  if (entity.kind === 'scene' && entity.commands.includes('activate')) {
    return knopf('color-palette-outline', entity.state.state === 'on', 'activate');
  }
  if (entity.kind === 'vacuum' && entity.commands.includes('start')) {
    const saugt = entity.state.state === 'cleaning';
    return knopf(
      saugt ? 'sparkles' : 'sparkles-outline',
      saugt,
      saugt && entity.commands.includes('dock') ? 'dock' : 'start'
    );
  }
  return null;
}

/** Die Geräte eines Raums, die ein eigener Knopf sein könnten (rein,
 *  testbar) - für die Auswahl hinter dem langen Druck. */
export function waehlbareGeraete(items: Entity[]): Raumaktion[] {
  return items
    .map(geraetAktion)
    .filter((aktion): aktion is Raumaktion => aktion !== null);
}

/** Höchstens so viele Knöpfe trägt eine Kachel - vier passen auf einem
 *  Telefon nicht mehr nebeneinander, ohne dass die Beschriftung bricht. */
export const KNOEPFE_HOECHSTENS = 3;

/**
 * Die Knöpfe einer Kachel, Sammel- und Geräteknöpfe zusammen (rein,
 * testbar).
 *
 * Ohne Wahl bleibt alles beim Alten: die Sammelknöpfe, die der Raum
 * hergibt. Mit Wahl kommen auch einzelne Geräte dazu - und die
 * Obergrenze gilt hier noch einmal, falls eine Wahl von einem anderen
 * Gerät mehr enthält, als die Kachel tragen kann.
 *
 * **Die Wahl gibt die Reihenfolge vor.** Vorher stand auf der Kachel,
 * was gewählt war, aber immer in der eingebauten Abfolge (Licht,
 * Storen, Musik, dann die Geräte) - wer «Musik» zuerst wollte, konnte
 * nichts tun. Jetzt zählt, in welcher Folge die Knöpfe angetippt
 * wurden; im Blatt steht die Nummer neben jedem gewählten Chip.
 *
 * Doppelte Einträge fallen weg: Eine Wahl von einem anderen Gerät oder
 * aus einer älteren Fassung soll keinen Knopf zweimal auf die Kachel
 * bringen.
 */
export function kachelKnoepfe(
  items: Entity[],
  auswahl: string[] | undefined
): Raumaktion[] {
  const standard = raumaktionen(items);
  if (auswahl === undefined) return standard;
  const alle = [...standard, ...waehlbareGeraete(items)];
  const gesehen = new Set<string>();
  const gewaehlt: Raumaktion[] = [];
  for (const art of auswahl) {
    if (gesehen.has(art)) continue;
    const aktion = alle.find((eintrag) => (eintrag.id ?? eintrag.art) === art);
    if (aktion === undefined) continue;
    gesehen.add(art);
    gewaehlt.push(aktion);
  }
  return gewaehlt.slice(0, KNOEPFE_HOECHSTENS);
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
  const ton = raumTon(name);
  return [`hsl(${ton}, 38%, 44%)`, `hsl(${(ton + 22) % 360}, 42%, 25%)`];
}

/**
 * Der Farbwinkel eines Raums (rein, testbar).
 *
 * Herausgelöst, damit die Farbe nicht nur auf der Übersichtskachel
 * lebt: Sie soll sich durch die Raumseite ziehen, damit man beim
 * Hinsehen weiss, wo man ist, bevor man den Namen liest. Wer sie
 * anderswo braucht, mischt sich aus dem Winkel seine eigene Sättigung -
 * ein Kopfbild verträgt kräftige Farbe, ein Schleier über dem Verlauf
 * nicht.
 *
 * Aus dem Namen gerechnet und nicht gespeichert: Dasselbe Zimmer hat
 * damit immer dieselbe Farbe, auf jedem Gerät, ohne dass jemand sie
 * einstellen muss.
 */
export function raumTon(name: string): number {
  let summe = 0;
  for (const zeichen of name.trim().toLowerCase()) {
    summe = (summe * 31 + zeichen.charCodeAt(0)) % 100000;
  }
  // 250° bis 30°, über den Nullpunkt hinweg: Blau, Violett, Rot,
  // Orange - die Töne, die auf einem blaugrauen Verlauf noch als Farbe
  // gelesen werden. Grün und Gelb fehlen mit Absicht, sie kippen dort
  // ins Schmutzige.
  return (250 + (summe % 140)) % 360;
}

/**
 * Ein Schleier in der Farbe des Raums (rein, testbar).
 *
 * Zwei Stopps für einen Verlauf, der oben anfängt und nach unten
 * ausgeht. Bewusst sehr blass: Er soll den Raum kennzeichnen, nicht die
 * Seite einfärben - darüber steht weisse Schrift, und die muss lesbar
 * bleiben.
 */
export function raumSchleier(name: string, staerke = 0.26): [string, string] {
  const ton = raumTon(name);
  return [`hsla(${ton}, 55%, 58%, ${staerke})`, `hsla(${ton}, 55%, 58%, 0)`];
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
