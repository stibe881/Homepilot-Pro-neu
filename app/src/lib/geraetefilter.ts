import { Entity } from '../api/types';
import { istPerson } from './batterien';

/**
 * Filter und Sortierung der Geräteliste.
 *
 * Man kommt mit einer von vier Fragen auf diese Seite: Was ist nicht
 * erreichbar? Wo ist die Batterie leer? Was hat keinen Raum? Was habe
 * ich ausgeblendet? Der Hub beantwortete alle vier längst – es gab nur
 * keinen Knopf dafür, und hundert Geräte blieben eine Bleiwüste zum
 * Durchscrollen.
 */

export type GeraeteFilter = '' | 'offline' | 'batterie' | 'ohne-raum' | 'ausgeblendet';
export type GeraeteSortierung = 'selbst' | 'raum' | 'art' | 'gesehen';

/**
 * Die Sortierungen mit ihren Wörtern - eine Liste, kein Ringschluss.
 *
 * Der Knopf auf der Geräteseite zählte durch: antippen, und die
 * Reihenfolge sprang zur nächsten von vier. Was es zu holen gibt, sah
 * man nie - man tippte, bis das Richtige dastand, und wer eins zu weit
 * kam, musste dreimal weiter. Die Namen standen dabei dreimal im
 * Bildschirm als verschachtelte Fragezeichen-Ketten (Knopf, Beschriftung
 * für die Sprachausgabe, Weiterschalten); hier stehen sie einmal.
 */
export const SORTIERUNGEN: {
  key: GeraeteSortierung;
  label: string;
  hinweis: string;
}[] = [
  {
    key: 'selbst',
    label: 'Eigene Reihenfolge',
    hinweis: 'Wie du die Kacheln gezogen hast.',
  },
  { key: 'raum', label: 'Nach Raum', hinweis: 'Küche, Wohnzimmer, Flur …' },
  { key: 'art', label: 'Nach Art', hinweis: 'Alle Lichter, alle Storen, alle Melder.' },
  {
    key: 'gesehen',
    label: 'Lange nicht gesehen',
    hinweis: 'Das stummste Gerät zuoberst - die Liste zum Nachsehen.',
  },
];

/** Wie die aktuelle Sortierung heisst (rein, testbar). */
export function sortierungsWort(sortierung: GeraeteSortierung): string {
  return SORTIERUNGEN.find((eintrag) => eintrag.key === sortierung)?.label ?? '';
}

/** Ab hier gilt eine Batterie als «demnächst dran» – derselbe Wert wie in
 *  der Geräte-Gesundheit. */
const BATTERY_SOON = 25;

/** Trifft der Filter auf dieses Gerät zu? (rein, testbar) */
export function passtFilter(
  entity: Entity,
  filter: GeraeteFilter,
  hidden: string[]
): boolean {
  switch (filter) {
    case 'offline':
      return !entity.available;
    case 'batterie':
      // Telefone nicht: Der Filter beantwortet «wo muss ich eine
      // Batterie wechseln?», und ein Telefon wird geladen. Sonst steht
      // es mit 14 Prozent zuoberst und verdeckt den Türkontakt, der
      // wirklich dran wäre.
      if (istPerson(entity)) return false;
      return (
        entity.state.low_battery === true ||
        (typeof entity.state.battery === 'number' &&
          entity.state.battery <= BATTERY_SOON)
      );
    case 'ohne-raum':
      return !entity.room;
    case 'ausgeblendet':
      return hidden.includes(entity.id);
    default:
      return true;
  }
}

/**
 * Die Liste sortieren (rein, testbar).
 *
 * `kindLabel` kommt herein statt importiert zu werden, damit die Funktion
 * ohne React prüfbar bleibt. «selbst» heisst: die Reihenfolge der
 * Aufruferin gilt – gezogen oder alphabetisch.
 */
export function sortiereGeraete(
  entities: Entity[],
  sortierung: GeraeteSortierung,
  kindLabel: (entity: Entity) => string
): Entity[] {
  if (sortierung === 'selbst') return entities;
  const list = [...entities];
  if (sortierung === 'raum') {
    return list.sort(
      (a, b) =>
        (a.room ?? '￿').localeCompare(b.room ?? '￿') ||
        a.name.localeCompare(b.name)
    );
  }
  if (sortierung === 'art') {
    return list.sort(
      (a, b) => kindLabel(a).localeCompare(kindLabel(b)) || a.name.localeCompare(b.name)
    );
  }
  // «gesehen»: Das am längsten stumme Gerät zuerst – die Liste, die man
  // vor den Ferien durchgeht. Wer nie gesehen wurde, steht ganz oben.
  return list.sort(
    (a, b) => (a.last_seen ?? 0) - (b.last_seen ?? 0) || a.name.localeCompare(b.name)
  );
}
