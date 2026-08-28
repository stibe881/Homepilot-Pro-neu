/**
 * Doppeltipp: die eigene Lieblingseinstellung mit einem Griff.
 *
 * Einmal tippen schaltet an oder aus – das ist der Knopf, den es immer
 * gab. Zweimal tippen macht daraus «und zwar so, wie ich es mag»: das
 * Licht auf 40 %, die Store auf halb. Gemerkt wird nicht in einem
 * Einstellungsdialog, sondern **aus dem, was gerade eingestellt ist**:
 * Man stellt das Zimmer einmal so hin, wie man es abends will, und
 * merkt es sich über das Kachelmenü. Ein Wähler mit Schiebereglern
 * daneben wäre derselbe Weg, nur zweimal.
 *
 * Der zweite Tipp wartet nicht auf den ersten: Der erste schaltet sofort
 * (sonst fühlte sich jede Kachel im ganzen Haus träge an, nur damit ein
 * Doppeltipp möglich bleibt), der zweite legt die gemerkte Einstellung
 * darüber. «Aus, dann Doppeltipp» endet also bei «an auf 40 %» – genau
 * das, was gemeint war.
 */
import { Entity } from '../api/types';

export interface Doppelaktion {
  command: string;
  data?: Record<string, number>;
  /** Kurz, für die Beschriftung im Menü: «40 %». */
  wort: string;
}

/** So lange gilt ein zweiter Tipp als Doppeltipp. */
export const FENSTER_MS = 350;

/**
 * Was sich am Gerät gerade merken lässt (rein, testbar).
 *
 * null heisst: nichts, was ein Doppeltipp sinnvoll wiederholen könnte -
 * ein Schalter kennt nur an und aus, und dafür gibt es den ersten Tipp.
 */
export function merkbar(entity: Entity): Doppelaktion | null {
  const hell = Number(entity.state?.brightness);
  if (entity.commands.includes('set_brightness') && Number.isFinite(hell) && hell > 0) {
    return {
      command: 'set_brightness',
      data: { brightness: Math.round(hell) },
      wort: `${Math.round(hell)} %`,
    };
  }
  const pos = Number(entity.state?.position);
  if (entity.commands.includes('set_position') && Number.isFinite(pos)) {
    return {
      command: 'set_position',
      data: { position: Math.round(pos) },
      wort: `${Math.round(pos)} %`,
    };
  }
  const lautstaerke = Number(entity.state?.volume);
  if (entity.commands.includes('set_volume') && Number.isFinite(lautstaerke)) {
    return {
      command: 'set_volume',
      data: { volume: Math.round(lautstaerke) },
      wort: `${Math.round(lautstaerke)} %`,
    };
  }
  return null;
}

/**
 * Die gemerkte Aktion eines Geräts (rein, testbar).
 *
 * Bewusst ohne Vorgabe: Ein Doppeltipp, den niemand eingestellt hat,
 * soll nichts tun. Eine geratene Lieblingshelligkeit wäre eine
 * Überraschung, und Überraschungen gehören nicht auf einen Lichtschalter.
 */
export function gemerkteAktion(
  gemerkt: Record<string, Doppelaktion> | undefined,
  entityId: string
): Doppelaktion | null {
  const eintrag = gemerkt?.[entityId];
  return eintrag && eintrag.command ? eintrag : null;
}

/** Die Beschriftung im Kachelmenü (rein, testbar). */
export function menuLabel(
  gemerkt: Record<string, Doppelaktion> | undefined,
  entity: Entity
): string | null {
  const jetzt = merkbar(entity);
  const alt = gemerkteAktion(gemerkt, entity.id);
  if (alt && (!jetzt || jetzt.wort === alt.wort)) {
    return `Doppeltipp (${alt.wort}) vergessen`;
  }
  if (!jetzt) return null;
  return `Doppeltipp merken: ${jetzt.wort}`;
}
