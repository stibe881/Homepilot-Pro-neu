/**
 * Was läuft gerade im Haus?
 *
 * Die Musikkachel zeigt eine Box. Wer wissen will, ob im Kinderzimmer
 * noch etwas läuft, musste bisher jede Kachel einzeln ansehen – und die
 * Antwort «nichts» gab es gar nicht, weil eine stille Box aussieht wie
 * eine, die man noch nicht gefunden hat.
 *
 * Dazu die ehrlichen Zustandsnamen: Der Hub unterscheidet seit Kurzem
 * zwischen «puffert», «pausiert», «wartet» und «nichts an». Vorher hiess
 * alles ausser «spielt» schlicht idle.
 *
 * Reines Rechnen: hinein die Geräte, heraus die Zeilen.
 */
import type { Entity } from '../api/types';

/** Wie ein Medienzustand auf Deutsch heisst (rein, testbar). */
export function zustandName(state: string | undefined): string {
  switch (String(state ?? '')) {
    case 'playing':
      return 'Spielt';
    case 'buffering':
      // Nicht «pausiert»: Es lädt, und der richtige Knopf ist Pause,
      // nicht Play.
      return 'Lädt';
    case 'paused':
      return 'Pausiert';
    case 'idle':
      // Es liegt etwas an, es läuft nur gerade nicht.
      return 'Wartet';
    case 'standby':
      return 'Nichts an';
    default:
      return 'Unbekannt';
  }
}

export interface Laufend {
  id: string;
  name: string;
  track: string;
  artist: string;
  image: string | null;
  /** true, solange gepuffert wird - die Zeile darf das sagen. */
  laedt: boolean;
}

/** Ist das ein Gerät, das Musik spielen kann? */
function istPlayer(entity: Entity): boolean {
  return entity.kind === 'media_player';
}

/**
 * Alle Boxen, auf denen gerade etwas läuft (rein, testbar).
 *
 * Ein Player ohne Titel steht mit dabei - eine Box, die spielt, ohne zu
 * sagen was, ist immer noch eine, die man leiser stellen will.
 */
export function laufendeMusik(entities: Entity[]): Laufend[] {
  return entities
    .filter(
      (entity) =>
        istPlayer(entity) &&
        entity.available &&
        ['playing', 'buffering'].includes(String(entity.state?.state ?? '')),
    )
    .map((entity) => ({
      id: entity.id,
      name: entity.name,
      track: String(entity.state?.track ?? '').trim(),
      artist: String(entity.state?.artist ?? '').trim(),
      image: entity.state?.image ? String(entity.state.image) : null,
      laedt: String(entity.state?.state) === 'buffering',
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * Ein Satz über den Stand im Haus (rein, testbar).
 *
 * «Es läuft nichts» ist eine Antwort - nicht dieselbe wie eine leere
 * Liste, bei der man sich fragt, ob die Karte kaputt ist.
 */
export function hausSatz(zeilen: Laufend[]): string {
  if (zeilen.length === 0) return 'Es läuft nichts.';
  if (zeilen.length === 1) {
    const eine = zeilen[0];
    return eine.track ? `${eine.name}: ${eine.track}` : `Es läuft auf ${eine.name}.`;
  }
  return `Es läuft auf ${zeilen.length} Boxen.`;
}

/**
 * Die Boxen, deren Lautstärke sich einzeln stellen lässt (rein, testbar).
 *
 * Für eine Lautsprechergruppe: Google stellt beim Abspielen alle gleich
 * laut, aber im Kinderzimmer darf es leiser sein als in der Küche. Der
 * Hub kennt die Mitglieder einer Gruppe nicht - sie teilen sich die
 * Adresse mit einer ihrer Boxen -, also stehen hier alle Einzelboxen.
 */
export function einzelBoxen(entities: Entity[], ausser: string): Entity[] {
  return entities
    .filter(
      (entity) =>
        istPlayer(entity) &&
        entity.id !== ausser &&
        entity.available &&
        entity.state?.is_group !== true &&
        entity.state?.has_screen !== true &&
        entity.commands.includes('set_volume'),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
