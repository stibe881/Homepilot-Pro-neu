/**
 * Was noch eingerichtet werden will.
 *
 * Der Hub findet Geräte von selbst – Cast-Boxen im Netz, alles, was über
 * Zigbee2MQTT oder Matter dazukommt. Danach stehen sie als Kacheln da:
 * mit dem Namen, den der Hersteller vergeben hat, und ohne Raum. Wer
 * sie einrichten wollte, musste jede Kachel einzeln suchen, in den
 * Anpassen-Modus wechseln und dort zweimal tippen.
 *
 * Reines Rechnen: hinein die Geräte, heraus die Liste dessen, was noch
 * fehlt – und in welcher Reihenfolge man es abarbeitet.
 */
import type { Entity } from '../api/types';

export interface Offen {
  entity: Entity;
  /** Warum es hier steht – das steht auch in der Zeile. */
  grund: 'raum' | 'name';
}

/** Sieht der Name nach Verpackung aus? (rein, testbar)
 *
 *  «Aqara Door and Window Sensor P2» sagt nicht, welches Fenster. Zwei
 *  Anhaltspunkte: Er ist lang, und er enthält keinen der Räume des
 *  Hauses. Beides zusammen ist ein guter Verdacht – und mehr soll es
 *  nicht sein: Vorgeschlagen wird, nicht umbenannt. */
export function nachVerpackung(name: string, raeume: string[]): boolean {
  const text = String(name ?? '').trim();
  if (text.length < 22) return false;
  const klein = text.toLowerCase();
  return !raeume.some((raum) => raum && klein.includes(raum.toLowerCase()));
}

/** Gerätearten, die keinen Raum brauchen. */
const OHNE_RAUM = new Set(['weather', 'alarm', 'calendar', 'scene', 'hue_scene']);

/**
 * Was noch einzurichten ist (rein, testbar).
 *
 * Zuerst die ohne Raum: Eine Kachel ohne Zimmer taucht in keiner
 * Raumansicht auf, und genau dort sucht man sie. Der Name ist die
 * kleinere Not – man findet das Gerät auch mit dem Namen aus der
 * Verpackung, es liest sich nur schlecht.
 */
export function offeneGeraete(entities: Entity[], raeume: string[]): Offen[] {
  const ohneRaum: Offen[] = [];
  const mitVerpackung: Offen[] = [];
  for (const entity of entities) {
    if (OHNE_RAUM.has(entity.kind)) continue;
    if (!entity.room) {
      ohneRaum.push({ entity, grund: 'raum' });
      continue;
    }
    if (nachVerpackung(entity.name, raeume)) {
      mitVerpackung.push({ entity, grund: 'name' });
    }
  }
  const nachName = (a: Offen, b: Offen) =>
    a.entity.name.localeCompare(b.entity.name, 'de-CH');
  return [...ohneRaum.sort(nachName), ...mitVerpackung.sort(nachName)];
}

/** Der Satz, der sagt, was noch aussteht (rein, testbar). */
export function offenSatz(offen: Offen[]): string {
  const ohneRaum = offen.filter((eintrag) => eintrag.grund === 'raum').length;
  const namen = offen.length - ohneRaum;
  const teile: string[] = [];
  if (ohneRaum > 0) {
    teile.push(`${ohneRaum} ohne Raum`);
  }
  if (namen > 0) {
    teile.push(`${namen} mit dem Namen aus der Verpackung`);
  }
  return teile.join(', ');
}

/**
 * Ein Vorschlag für den Namen (rein, testbar).
 *
 * Aus Raum und Geräteart – «Küche Licht» statt «TRADFRI bulb E27 CWS
 * 806lm». Vorgeschlagen, nicht gesetzt: Wer sein Licht «Esstisch»
 * nennen will, tippt das, und der Vorschlag steht ihm nicht im Weg.
 */
const ART_WORT: Record<string, string> = {
  light: 'Licht',
  switch: 'Steckdose',
  cover: 'Store',
  lock: 'Schloss',
  media_player: 'Box',
  camera: 'Kamera',
  binary_sensor: 'Melder',
  sensor: 'Fühler',
  climate: 'Heizung',
  vacuum: 'Sauger',
  button: 'Taster',
};

export function namensVorschlag(raum: string | null | undefined, kind: string): string {
  const wort = ART_WORT[kind] ?? '';
  const zimmer = String(raum ?? '').trim();
  if (!zimmer) return wort;
  return wort ? `${zimmer} ${wort}` : zimmer;
}
