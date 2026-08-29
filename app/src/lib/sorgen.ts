/**
 * Ein Blatt: was gerade nicht in Ordnung ist.
 *
 * Die Auskünfte gab es schon, nur an vier Orten: Batterien in der
 * Geräte-Gesundheit, «nicht erreichbar» auf der jeweiligen Kachel,
 * Wartungen unter System – und die Funkstille nirgends, obwohl sie die
 * unangenehmste ist: Ein Türkontakt mit leerer Batterie meldet keinen
 * Fehler, er meldet gar nichts mehr. Wer wissen will, ob im Haus etwas
 * klemmt, musste an vier Stellen nachsehen und die vierte kennen.
 *
 * Hier steht das Zusammentragen und Sortieren, ohne Anzeige und ohne
 * Abruf. Wer eine Sorge behebt (quittieren, Wartung abhaken), tut das
 * weiterhin dort, wo sie herkommt.
 */
import { Entity } from '../api/types';
import { BATTERY_SOON, BatterieVermerk, batteryRows, stummBis } from './batterien';
import { epochAgo } from './zeit';

/** Ab hier gilt ein Melder als verstummt. */
export const STILL_STUNDEN = 48;

/** Gerätearten, bei denen Schweigen etwas heisst.
 *
 * Ein Melder berichtet von sich aus – Bewegung, Kontakt, Temperatur –,
 * und die meisten schicken zusätzlich regelmässig ein Lebenszeichen.
 * Eine Lampe dagegen darf tagelang still sein: Sie sagt erst wieder
 * etwas, wenn jemand sie schaltet. Sie hier mitzuzählen hiesse, das
 * Blatt mit Geräten zu füllen, denen nichts fehlt. */
export const MELDENDE_ARTEN = ['sensor', 'binary_sensor'];

export type SorgenArt = 'offline' | 'still' | 'batterie' | 'wartung';

export interface Sorge {
  id: string;
  art: SorgenArt;
  name: string;
  /** Die eine Zeile darunter: seit wann, wie wenig, wie lange überfällig. */
  detail: string;
  raum?: string | null;
  /** Rot statt gelb: Das gehört heute erledigt. */
  dringend: boolean;
  entityId?: string;
  wartungId?: string;
}

export interface Wartung {
  id: string;
  text: string;
  due?: string | null;
}

const RANG: Record<SorgenArt, number> = {
  offline: 0,
  still: 1,
  batterie: 2,
  wartung: 3,
};

/** Wie viele Tage über der Frist – negativ heisst «noch nicht fällig». */
export function tageUeberfaellig(due: string | null | undefined, jetzt: number): number {
  if (!due) return 0;
  const frist = new Date(`${String(due).slice(0, 10)}T00:00:00`).getTime();
  if (Number.isNaN(frist)) return 0;
  return Math.floor((jetzt - frist) / 86_400_000);
}

/**
 * Alles, was gerade klemmt – dringendstes zuerst (rein, testbar).
 *
 * Quittierte Batteriewarnungen fehlen bewusst: Wer «bis morgen stumm»
 * gewählt hat, hat die Antwort schon gegeben, und ein Blatt, auf dem
 * die abgelehnte Meldung wieder steht, ist keine Übersicht, sondern
 * eine Wiederholung.
 */
export function sorgen(lage: {
  entities: Entity[];
  vermerke?: BatterieVermerk[];
  wartungen?: Wartung[];
  jetzt: number;
}): Sorge[] {
  const { entities, vermerke = [], wartungen = [], jetzt } = lage;
  const liste: Sorge[] = [];

  for (const entity of entities) {
    // Zusammengefasste Lampen zählen einmal, nicht fünfmal - der
    // Einzelspot steht nur noch unter Geräte.
    if (entity.combined_into) continue;
    if (!entity.available) {
      liste.push({
        id: `offline:${entity.id}`,
        art: 'offline',
        name: entity.name,
        detail: entity.last_seen
          ? `nicht erreichbar · zuletzt ${epochAgo(entity.last_seen, jetzt)}`
          : 'nicht erreichbar',
        raum: entity.room,
        dringend: true,
        entityId: entity.id,
      });
      continue;
    }
    if (
      MELDENDE_ARTEN.includes(entity.kind) &&
      entity.last_seen &&
      jetzt - entity.last_seen * 1000 > STILL_STUNDEN * 3_600_000
    ) {
      liste.push({
        id: `still:${entity.id}`,
        art: 'still',
        name: entity.name,
        detail: `meldet sich nicht mehr · zuletzt ${epochAgo(entity.last_seen, jetzt)}`,
        raum: entity.room,
        // Ein verstummter Melder ist der Fall, den sonst niemand
        // bemerkt: Er wirft keinen Fehler, er schweigt nur.
        dringend: true,
        entityId: entity.id,
      });
    }
  }

  for (const row of batteryRows(entities)) {
    if (row.entity.combined_into) continue;
    const schwach = row.low || (row.percent !== null && row.percent <= BATTERY_SOON);
    if (!schwach) continue;
    if (stummBis(vermerke, row.entity.id, jetzt) !== null) continue;
    liste.push({
      id: `batterie:${row.entity.id}`,
      art: 'batterie',
      name: row.entity.name,
      detail: row.percent === null ? 'Batterie schwach' : `Batterie bei ${row.percent}%`,
      raum: row.entity.room,
      // «Schwach» ohne Prozentwert ist die letzte Meldung vor der Stille.
      dringend: row.low || (row.percent !== null && row.percent <= 10),
      entityId: row.entity.id,
    });
  }

  for (const wartung of wartungen) {
    const tage = tageUeberfaellig(wartung.due, jetzt);
    if (tage < 0) continue;
    liste.push({
      id: `wartung:${wartung.id}`,
      art: 'wartung',
      name: wartung.text,
      detail:
        tage === 0 ? 'heute fällig' : `seit ${tage} Tag${tage === 1 ? '' : 'en'} fällig`,
      dringend: tage > 14,
      wartungId: wartung.id,
    });
  }

  return liste.sort(
    (a, b) =>
      Number(b.dringend) - Number(a.dringend) ||
      RANG[a.art] - RANG[b.art] ||
      a.name.localeCompare(b.name)
  );
}

/** Der Satz für die Zeile im Menü (rein, testbar). */
export function sorgenSatz(liste: Sorge[]): string {
  if (liste.length === 0) return 'Alles in Ordnung';
  const arten = new Set(liste.map((sorge) => sorge.art));
  const woerter: Record<SorgenArt, string> = {
    offline: 'nicht erreichbar',
    still: 'verstummt',
    batterie: 'Batterie',
    wartung: 'Wartung',
  };
  const teile = (['offline', 'still', 'batterie', 'wartung'] as SorgenArt[])
    .filter((art) => arten.has(art))
    .map((art) => woerter[art]);
  return `${liste.length} Sache${liste.length === 1 ? '' : 'n'}: ${teile.join(', ')}`;
}
