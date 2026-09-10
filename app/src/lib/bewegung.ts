import type { Entity } from '../api/types';

/**
 * Bewegt sich gerade jemand im Zimmer?
 *
 * Der Bewegungsmelder hatte im Raum eine eigene Kategorie mit einer
 * Kachel je Stück - eine Überschrift und eine halbe Bildschirmhöhe für
 * die Auskunft «Ruhig». Bedienen kann man ihn ohnehin nicht, und die
 * Kachel sagte im Ruhezustand gar nichts. Dieselbe Lehre wie bei den
 * Fenster- und Türkontakten (lib/offen.ts, kontaktZeile): Was man nicht
 * bedienen kann, ist ein Zeichen wert, keine Kachel.
 *
 * Statt der Kachel steht jetzt ein Männchen dort, wo man auf den Raum
 * sieht: im Raumkopf hinter der Faktenzeile und auf der Raumkachel
 * hinter «alles ruhig». Es steht nur, wenn sich wirklich etwas bewegt -
 * ein Zeichen, das immer da ist, liest niemand mehr.
 *
 * Reines Rechnen: hinein die Geräte, heraus ja oder nein.
 */

/** Geräteklassen, die Bewegung melden - dieselben drei, an denen auch
 *  die Alarmanlage entscheidet (hub: alarm_rules.ist_bewegung). */
const BEWEGUNG_KLASSEN = new Set(['motion', 'occupancy', 'presence']);

/** Ein Melder, der Bewegung meldet? (rein, testbar)
 *
 *  Ohne Geräteklasse entscheidet der Name: Nicht jede Integration
 *  schickt eine, und ein Melder ohne Klasse stünde sonst wieder als
 *  Kachel im Zimmer. */
export function istBewegungsmelder(entity: Entity): boolean {
  if (entity.kind !== 'binary_sensor') return false;
  const klasse = String(entity.state?.device_class ?? '');
  if (klasse) return BEWEGUNG_KLASSEN.has(klasse);
  return /bewegung|präsenz|prasenz|motion|presence/i.test(entity.name);
}

/**
 * Meldet dieses Gerät gerade Bewegung? (rein, testbar)
 *
 * Auch Kameras: Die Kamera an der Terrasse sieht dieselbe Person wie
 * der Melder daneben, nur ohne dass jemand einen Melder aufgehängt hat.
 * Sie meldet es als `motion` oder als erkanntes Etwas (`detected_person`
 * und Verwandte).
 *
 * Das Klingeln zählt bewusst **nicht** mit: Es ist keine Bewegung,
 * sondern ein Ereignis mit eigenem Vollbild - und es hörte nach dem
 * Läuten nicht auf, solange die Kamera den Zustand hält.
 */
export function meldetBewegung(entity: Entity): boolean {
  if (entity.available === false) return false;
  if (istBewegungsmelder(entity)) return String(entity.state?.state ?? '') === 'on';
  if (entity.kind !== 'camera') return false;
  const state = entity.state ?? {};
  if (String(state.motion ?? '') === 'on') return true;
  return Object.entries(state).some(
    ([feld, wert]) => feld.startsWith('detected_') && String(wert) === 'on'
  );
}

/**
 * Bewegt sich im Raum gerade etwas? (rein, testbar)
 *
 * Ausgeblendete Geräte zählen nicht mit - dieselbe Liste, mit der auch
 * die Faktenzeile rechnet (raumFakten). Wer einen Melder ausblendet,
 * will von ihm nichts mehr hören, auch nicht als Zeichen.
 */
export function bewegungImRaum(items: Entity[], hidden: string[] = []): boolean {
  return items.some((entity) => !hidden.includes(entity.id) && meldetBewegung(entity));
}
