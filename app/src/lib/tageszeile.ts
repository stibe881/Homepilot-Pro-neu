import { Entity } from '../api/types';

/**
 * Die tageszeitliche Schnellzeile der Startseite (Punkt 257 der Werkbank).
 *
 * Die Startseite ordnet ihre Blöcke morgens schon um (morningFirst in
 * OverviewScreen) - aber der Handgriff, den die Tageszeit nahelegt,
 * fehlte: Morgens will man die Storen hochlassen, abends das vergessene
 * Licht löschen und die Storen schliessen. Diese Zeile bietet genau
 * diese Sammelgriffe an - und nur dann, wenn es wirklich etwas zu tun
 * gibt. Eine Zeile «0 Storen auf» wäre keine Auskunft, sondern Möblierung.
 *
 * Bewusst nur eine kleine Zeile und kein Umsortieren der Kacheln: Wer
 * seine Startseite kennt, soll sie zu jeder Stunde am selben Ort
 * wiederfinden.
 *
 * Der Griff schaltet nicht sofort, sondern zeigt erst, *was* er
 * schalten würde. «4 Lichter aus» sagt nämlich nicht, ob das Licht im
 * Kinderzimmer dabei ist - und wer das erst nach dem Tippen merkt, hat
 * ein Kind im Dunkeln. Deshalb dieselbe Rückfrage wie bei «Alles aus»
 * (components/AllOff.tsx), mit denselben Häkchen zum Ausnehmen.
 */

export interface TagesBefehl {
  entityId: string;
  command: string;
  /** Name und Raum reisen mit: Das Blatt hinter dem Griff zeigt, *was*
   *  gleich geschaltet wird, und dafür genügt eine Kennung nicht. */
  name: string;
  room?: string | null;
}

export interface TagesGriff {
  key: 'storen_auf' | 'licht_aus' | 'storen_zu';
  label: string;
  icon: 'arrow-up' | 'arrow-down' | 'bulb-outline';
  /** Überschrift des Blatts, das der Griff öffnet. */
  titel: string;
  /** Das Zeitwort für den Ausführen-Knopf: «3 ausschalten». */
  tunWort: string;
  /** Ausdrücklich je Gerät - wie bei den Raumknöpfen (lib/raumkarte.ts):
   *  ein toggle könnte in die falsche Richtung schalten. */
  befehle: TagesBefehl[];
}

/**
 * Der Szenen-Griff, der abends neben «Licht aus» und «Storen zu» steht.
 *
 * Anders als die Geräte-Griffe oben ohne Rückfrage: Eine Szene («Kino»,
 * «Schlafen») schaltet, was jemand im Ablauf-Editor dafür festgelegt
 * hat - das noch einmal aufzuzählen wäre dieselbe Liste an zwei Orten.
 */
export interface TagesSzenenGriff {
  key: 'abend_szene';
  sceneId: string;
  label: string;
  icon: string;
}

/** Name und Raum an den Befehl heften (rein, testbar). */
function befehl(entity: Entity, command: string): TagesBefehl {
  return { entityId: entity.id, command, name: entity.name, room: entity.room };
}

/** Steht diese Store (mindestens einen Spalt) offen? Dieselbe Lesart wie
 *  die Raumknöpfe (lib/raumkarte.ts) - eine Store in Beschattung steht
 *  unten und zählt morgens deshalb zu denen, die aufgehen sollen. */
function coverOffen(entity: Entity): boolean {
  const position = entity.state.position;
  if (typeof position === 'number') return position > 1;
  return entity.state.state !== 'closed';
}

function storen(entities: Entity[], befehl: 'open' | 'close'): Entity[] {
  return entities.filter(
    (entity) => entity.kind === 'cover' && entity.commands.includes(befehl)
  );
}

function brennende(entities: Entity[]): Entity[] {
  return entities.filter(
    (entity) =>
      entity.kind === 'light' &&
      entity.state.state === 'on' &&
      (entity.commands.includes('turn_off') || entity.commands.includes('toggle'))
  );
}

/** «3 Storen auf», aber «Store auf» - eine Eins vor dem einzigen Storen
 *  wäre Buchhaltung (rein, testbar). */
export function griffLabel(anzahl: number, einzahl: string, mehrzahl: string): string {
  return anzahl === 1 ? einzahl : `${anzahl} ${mehrzahl}`;
}

/** Ist gerade der Abend, in dem «Licht aus» und «Storen zu» erscheinen?
 *  (rein, testbar) Ab 21 Uhr und über Mitternacht hinaus bis 2: Wer um
 *  halb eins den letzten Gang macht, brennt genauso Licht wie um halb
 *  elf. Dieselbe Uhr wie in tagesGriffe - eine zweite Zahl für dasselbe
 *  Fenster liefe irgendwann auseinander. */
export function istAbendfenster(now: Date): boolean {
  const stunde = now.getHours();
  return stunde >= 21 || stunde < 2;
}

/**
 * Die Griffe, die zur Stunde passen (rein, testbar).
 *
 * Morgens dasselbe Fenster wie morningFirst (5 bis 11 Uhr) - zwei
 * eigene Uhren auf einer Seite wären zwei Meinungen darüber, wann
 * Morgen ist. Abends ab 21 Uhr und über Mitternacht hinaus bis 2:
 * Wer um halb eins den letzten Gang macht, brennt genauso Licht wie
 * um halb elf. Dazwischen bleibt die Zeile weg.
 */
export function tagesGriffe(entities: Entity[], now: Date): TagesGriff[] {
  const stunde = now.getHours();
  const griffe: TagesGriff[] = [];

  if (stunde >= 5 && stunde < 11) {
    const unten = storen(entities, 'open').filter((entity) => !coverOffen(entity));
    if (unten.length > 0) {
      griffe.push({
        key: 'storen_auf',
        label: griffLabel(unten.length, 'Store auf', 'Storen auf'),
        icon: 'arrow-up',
        titel: 'Diese Storen sind unten',
        tunWort: 'öffnen',
        befehle: unten.map((entity) => befehl(entity, 'open')),
      });
    }
    return griffe;
  }

  if (istAbendfenster(now)) {
    const an = brennende(entities);
    if (an.length > 0) {
      griffe.push({
        key: 'licht_aus',
        label: griffLabel(an.length, 'Licht aus', 'Lichter aus'),
        icon: 'bulb-outline',
        titel: 'Diese Lichter brennen',
        tunWort: 'ausschalten',
        befehle: an.map((entity) =>
          befehl(entity, entity.commands.includes('turn_off') ? 'turn_off' : 'toggle')
        ),
      });
    }
    const offen = storen(entities, 'close').filter(coverOffen);
    if (offen.length > 0) {
      griffe.push({
        key: 'storen_zu',
        label: griffLabel(offen.length, 'Store zu', 'Storen zu'),
        icon: 'arrow-down',
        titel: 'Diese Storen stehen offen',
        tunWort: 'schliessen',
        befehle: offen.map((entity) => befehl(entity, 'close')),
      });
    }
  }

  return griffe;
}

/**
 * Der Szenen-Griff für die Abendzeile (rein, testbar).
 *
 * Ohne Szene oder ausserhalb des Abendfensters gibt es keinen - die
 * Startseite soll «Kino» nicht auch um vier am Nachmittag anbieten,
 * nur weil jemand einmal eine so benannte Szene angelegt hat.
 */
export function abendSzenenGriff(
  szene: { id: string; name: string; icon: string } | null | undefined,
  now: Date
): TagesSzenenGriff | null {
  if (!szene || !istAbendfenster(now)) return null;
  return { key: 'abend_szene', sceneId: szene.id, label: szene.name, icon: szene.icon };
}
