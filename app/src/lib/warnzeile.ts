/**
 * Die Wetterwarnung in der Kopfzeile - und nur dort.
 *
 * Sie stand zweimal auf derselben Seite: oben in der Begrüssungskarte
 * und noch einmal als Gerätekachel «Wetterlage» mit «1 Warnungen» und
 * demselben Text darunter. Zweimal dasselbe liest niemand zweimal; es
 * sieht bloss so aus, als wären es zwei Sachen.
 *
 * Also gehört die Warnung nach oben - und dort auch in die Farbe, die
 * sie meint. Orange heisst im ganzen Haus «schau mal», Rot heisst
 * «jetzt»: die aufgeschlossene Wohnungstüre, der ausgelöste Alarm. Ein
 * Unwetter gehört dazu, und wie die offene Türe blinkt es, statt bloss
 * dazustehen (TopStrip.Blinkend).
 */

import { Entity, EntityState } from '../api/types';

/** Wie viele Warnungen laufen? (rein, testbar) */
export function warnZahl(state: EntityState | null | undefined): number {
  const zahl = Number(state?.count ?? 0);
  return Number.isFinite(zahl) && zahl > 0 ? Math.round(zahl) : 0;
}

/**
 * Steht die Warnung dieses Geräts schon in der Kopfzeile? (rein, testbar)
 *
 * Dann hat seine Kachel nichts mehr zu sagen. Ohne laufende Warnung
 * bleibt sie stehen: «Keine Warnungen» ist eine Auskunft, die man
 * gerade vor einem Gewitterabend sucht, und sie steht sonst nirgends.
 */
export function warnungSchonOben(entity: Entity): boolean {
  return entity.kind === 'alert' && warnZahl(entity.state) > 0;
}

/**
 * «1 Warnung», «3 Warnungen» (rein, testbar).
 *
 * Die Kachel schrieb «1 Warnungen» - dieselbe Nachlässigkeit, die die
 * Schnellzeile mit griffLabel vermeidet (lib/tageszeile.ts).
 */
export function warnZahlSatz(anzahl: number): string {
  return anzahl === 1 ? '1 Warnung' : `${anzahl} Warnungen`;
}

/**
 * Was in der Kopfzeile steht (rein, testbar).
 *
 * Die Schlagzeile des Hubs zuerst - sie nennt Ereignis, Stärke und bis
 * wann (integrations/meteoalarm.py, schlagzeile). Fehlt sie, tut es das
 * Ereignis; und ganz ohne Text bleibt die Zahl, denn dass etwas los
 * ist, gehört auch dann gesagt.
 */
export function warnText(state: EntityState | null | undefined): string {
  const schlagzeile = String(state?.headline ?? '').trim();
  if (schlagzeile) return schlagzeile;
  const ereignis = String(state?.event ?? '').trim();
  if (ereignis) return ereignis;
  return warnZahlSatz(Math.max(1, warnZahl(state)));
}
