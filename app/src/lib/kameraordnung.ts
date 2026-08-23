/**
 * Reihenfolge der Kamerakacheln: fest oder nach Bewegung.
 *
 * Bei sechs Kameras ist die feste Reihenfolge die richtige, solange
 * nichts los ist – man greift nach der Kamera, von der man weiss, wo sie
 * steht. Sobald etwas los ist, ist sie die falsche: Dann will man die
 * sehen, an der sich gerade etwas bewegt, und nicht sechs Kacheln
 * absuchen.
 *
 * Deshalb umschaltbar, und zwar je Person: Am Wandpanel im Flur will man
 * etwas anderes als auf dem Telefon.
 */
import { Entity } from '../api/types';

/** Wie lange ein Ereignis eine Kamera nach oben holt. Fünf Minuten:
 *  lange genug, um nach dem Griff zum Telefon noch oben zu stehen, kurz
 *  genug, dass die Reihenfolge nicht den ganzen Abend verdreht bleibt. */
export const FRISCH_SEKUNDEN = 300;

/** Alle Zeitstempel, die eine Kamera über Ereignisse führt. */
function stempel(entity: Entity): number[] {
  const werte: number[] = [];
  for (const [feld, roh] of Object.entries(entity.state ?? {})) {
    if (feld !== 'last_motion' && feld !== 'last_ring' && !feld.startsWith('last_')) {
      continue;
    }
    if (typeof roh !== 'string' && typeof roh !== 'number') continue;
    const zeit = new Date(typeof roh === 'number' ? roh * 1000 : roh).getTime();
    if (!Number.isNaN(zeit)) werte.push(zeit);
  }
  return werte;
}

/** Wann diese Kamera zuletzt etwas gemeldet hat (rein, testbar).
 *
 *  0 heisst «nie» – nicht «gerade eben». */
export function letztesEreignis(entity: Entity): number {
  const werte = stempel(entity);
  return werte.length > 0 ? Math.max(...werte) : 0;
}

/** Meldet die Kamera gerade etwas? (rein, testbar)
 *
 *  Nicht nur Bewegung: Eine Kamera, die eine Person erkennt oder an der
 *  es klingelt, gehört genauso nach oben. */
export function meldetGerade(entity: Entity): boolean {
  const state = entity.state ?? {};
  if (String(state.motion ?? '') === 'on') return true;
  if (String(state.ring ?? '') === 'on') return true;
  return Object.entries(state).some(
    ([feld, wert]) => feld.startsWith('detected_') && String(wert) === 'on'
  );
}

/**
 * Die Kameras nach Betrieb sortiert (rein, testbar).
 *
 * Drei Ränge, in dieser Reihenfolge:
 *
 *  1. Was gerade meldet – Bewegung, Klingeln, eine erkannte Person.
 *  2. Was in den letzten Minuten gemeldet hat, das Jüngste zuerst.
 *  3. Der Rest, in der bisherigen Reihenfolge.
 *
 * Nicht erreichbare Kameras fallen ans Ende: Ein schwarzes Rechteck
 * oben ist die unbrauchbarste Kachel.
 *
 * Die Eingabereihenfolge bleibt sonst erhalten – wer seine Kacheln
 * gezogen hat, findet sie wieder, sobald nichts mehr los ist.
 */
export function nachBewegung(kameras: Entity[], jetzt: number): Entity[] {
  const rang = (entity: Entity): number => {
    if (entity.available === false) return 3;
    if (meldetGerade(entity)) return 0;
    const zuletzt = letztesEreignis(entity);
    if (zuletzt > 0 && jetzt - zuletzt <= FRISCH_SEKUNDEN * 1000) return 1;
    return 2;
  };
  return kameras
    .map((entity, index) => ({ entity, index, rang: rang(entity) }))
    .sort((a, b) => {
      if (a.rang !== b.rang) return a.rang - b.rang;
      // Innerhalb «war eben etwas»: das Jüngste zuerst.
      if (a.rang === 1) {
        const zeit = letztesEreignis(b.entity) - letztesEreignis(a.entity);
        if (zeit !== 0) return zeit;
      }
      return a.index - b.index;
    })
    .map((eintrag) => eintrag.entity);
}
