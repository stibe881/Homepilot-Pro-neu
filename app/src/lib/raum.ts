import type { Ionicons } from '@expo/vector-icons';

import { Entity } from '../api/types';
import { openContacts } from './offen';

/**
 * Was ein Raum über sich sagt – bevor man seine Kacheln liest.
 *
 * Beim Blick auf ein Zimmer will man drei Dinge wissen: wie warm ist es,
 * steht ein Fenster offen, läuft etwas. Alles davon liegt in denselben
 * Entitäten, die die Ansicht ohnehin bekommt – es stand nur nirgends.
 */

/** Der Temperatursensor des Raums – der erste nach Name, wie in der
 *  Klima-Übersicht: Eine Übersicht will einen Wert, keine Debatte. */
function temperatur(items: Entity[]): Entity | undefined {
  return items
    .filter(
      (entity) =>
        entity.kind === 'sensor' &&
        typeof entity.state?.state === 'number' &&
        (entity.state?.device_class === 'temperature' || entity.state?.unit === '°C')
    )
    .sort((a, b) => a.name.localeCompare(b.name))[0];
}

/** Die Kopfzeile eines Raums (rein, testbar): «21,5° · Fenster offen ·
 *  Musik läuft». Leer, wenn es nichts zu sagen gibt. */
export function raumZeile(items: Entity[]): string {
  const teile: string[] = [];
  const fuehler = temperatur(items);
  if (fuehler) {
    teile.push(`${Number(fuehler.state.state).toFixed(1).replace('.', ',')}°`);
    if (typeof fuehler.state.humidity === 'number') {
      teile.push(`${Math.round(fuehler.state.humidity)} %`);
    }
  }
  const offen = openContacts(items);
  if (offen.length === 1) teile.push(`${offen[0].name} offen`);
  else if (offen.length > 1) teile.push(`${offen.length} offen`);
  if (
    items.some(
      (entity) => entity.kind === 'media_player' && entity.state.state === 'playing'
    )
  ) {
    teile.push('Musik läuft');
  }
  return teile.join(' · ');
}

/**
 * Welche Zeilen die Raum-Kachel zeigt, wenn nicht alle passen (rein,
 * testbar).
 *
 * Vorher entschied die Meldereihenfolge der Integration – im
 * Schlafzimmer konnte so der Nachttisch wegfallen und der Fensterkontakt
 * bleiben. Jetzt: Favoriten zuerst, dann was gerade an ist, dann
 * Bedienbares, Messwerte zuletzt. Innerhalb jeder Stufe bleibt die
 * bestehende Reihenfolge – sie ist die gezogene.
 */
export function wichtigeZuerst(items: Entity[], favorites: string[]): Entity[] {
  const stufe = (entity: Entity): number => {
    if (favorites.includes(entity.id)) return 0;
    if (entity.state.state === 'on' || entity.state.state === 'playing') return 1;
    if (entity.commands.length > 0) return 2;
    return 3;
  };
  // Stabil sortieren: bei gleicher Stufe gilt die bisherige Reihenfolge.
  return items
    .map((entity, index) => ({ entity, index }))
    .sort((a, b) => stufe(a.entity) - stufe(b.entity) || a.index - b.index)
    .map((entry) => entry.entity);
}

/**
 * Ein Symbol je Raum, aus dem Namen geraten (rein, testbar).
 *
 * Kein Pflegefeld: Wer den Raum «Küche» nennt, hat das Symbol damit
 * gewählt. Was das Raten nicht kennt, bekommt die neutrale Tür.
 */
export function raumSymbol(name: string): keyof typeof Ionicons.glyphMap {
  const n = name.toLowerCase();
  if (/küche|kueche|kitchen/.test(n)) return 'restaurant-outline';
  if (/bad|dusche|wc|toilette/.test(n)) return 'water-outline';
  if (/schlaf|bett/.test(n)) return 'bed-outline';
  if (/kinder|nino|baby/.test(n)) return 'happy-outline';
  if (/wohn|stube|living/.test(n)) return 'tv-outline';
  if (/büro|buero|arbeit|office/.test(n)) return 'desktop-outline';
  if (/flur|gang|korridor|diele|eingang/.test(n)) return 'walk-outline';
  if (/keller|estrich|dachboden|abstell|reduit/.test(n)) return 'file-tray-stacked-outline';
  if (/garage|carport/.test(n)) return 'car-outline';
  if (/garten|terrasse|balkon|aussen|außen|sitzplatz/.test(n)) return 'leaf-outline';
  if (/wasch|waesche|wäsche/.test(n)) return 'shirt-outline';
  if (/ess|esszimmer/.test(n)) return 'wine-outline';
  return 'cube-outline';
}

/** Namen in gespeicherter Reihenfolge, Unbekanntes hinten (rein, testbar). */
/**
 * Räume alphabetisch (rein, testbar).
 *
 * Die selbst gezogene Reihenfolge ist die bessere - sie folgt dem Weg
 * durch die Wohnung. Aber wer siebzehn Räume von Hand sortiert hat und
 * einen sucht, will einmal Ordnung nach dem Alphabet, ohne siebzehnmal
 * zu ziehen.
 *
 * «de-CH» ist hier keine Zierde: Ohne Locale stünde «Gäste Bad» hinter
 * «Küche», weil Ä und Ü nach Z einsortiert würden.
 */
export function alphabetisch(rooms: string[]): string[] {
  return [...rooms].sort((a, b) => a.localeCompare(b, 'de-CH'));
}

export function raeumeSortiert(rooms: string[], order?: string[]): string[] {
  if (!order || order.length === 0) return rooms;
  const rang = new Map(order.map((name, index) => [name, index]));
  return [...rooms].sort((a, b) => {
    const ai = rang.has(a) ? (rang.get(a) as number) : Infinity;
    const bi = rang.has(b) ? (rang.get(b) as number) : Infinity;
    return ai !== bi ? ai - bi : 0;
  });
}

/**
 * Die Kategorien eines Raums (rein, testbar).
 *
 * Vorher waren drei fest verdrahtet – Beleuchtung, Store, Medien – und
 * Thermostat, Schloss, Sauger und Waschmaschine fielen alle in einen
 * Topf «Weitere». In einem Bad war «Weitere» oft die einzige
 * Überschrift. Jetzt baut sich die Liste aus den Gerätearten selbst;
 * die drei Häufigsten behalten ihren festen Platz vorn.
 *
 * Messwerte tauchen gar nicht auf: Sie stehen als Zeile im Raumkopf
 * statt als volle Kacheln zwischen dem Bedienbaren.
 */
export function raumKategorien(
  items: Entity[],
  kindLabel: (entity: Entity) => string
): { key: string; label: string; items: Entity[] }[] {
  const fest: { kind: string; label: string }[] = [
    { kind: 'light', label: 'Beleuchtung' },
    { kind: 'cover', label: 'Store' },
    { kind: 'media_player', label: 'Medien' },
  ];
  const result: { key: string; label: string; items: Entity[] }[] = [];
  const used = new Set<string>();
  for (const cat of fest) {
    const passend = items.filter((entity) => entity.kind === cat.kind);
    if (passend.length > 0) {
      result.push({ key: cat.kind, label: cat.label, items: passend });
      passend.forEach((entity) => used.add(entity.id));
    }
  }
  // Der Rest nach Geräteart, alphabetisch – Messwerte ausgenommen.
  const rest = items.filter(
    (entity) => !used.has(entity.id) && entity.kind !== 'sensor'
  );
  const labels = Array.from(new Set(rest.map(kindLabel))).sort((a, b) =>
    a.localeCompare(b)
  );
  for (const label of labels) {
    result.push({
      key: `art:${label}`,
      label,
      items: rest.filter((entity) => kindLabel(entity) === label),
    });
  }
  return result;
}

/** Die Messwerte des Raums für die Kopf-Chips (rein, testbar). */
export function raumMesswerte(items: Entity[]): Entity[] {
  return items
    .filter((entity) => entity.kind === 'sensor')
    .sort((a, b) => a.name.localeCompare(b.name));
}
