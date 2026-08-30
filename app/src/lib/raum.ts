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

/**
 * Das Klima des Raums für den grossen Wert rechts neben dem Titel
 * (rein, testbar). Null, wenn der Raum keinen Temperaturfühler hat -
 * dann trägt der Kopf einfach keinen Wert, statt «–» zu zeigen.
 */
export function raumKlima(
  items: Entity[]
): { fuehler: Entity; temp: string; feuchte: string | null } | null {
  const fuehler = temperatur(items);
  if (!fuehler) return null;
  return {
    fuehler,
    temp: `${Number(fuehler.state.state).toFixed(1).replace('.', ',')}°`,
    feuchte:
      typeof fuehler.state.humidity === 'number'
        ? `${Math.round(fuehler.state.humidity)} % Feuchte`
        : null,
  };
}

/**
 * Die Faktenzeile unter dem Raumnamen (rein, testbar): «1 von 4 an ·
 * Fenster zu · Musik läuft». Ohne Klima - das steht gross daneben.
 *
 * «Fenster zu» steht nur, wenn der Raum überhaupt Kontakte hat: In
 * einem Raum ohne Fenstersensor wäre die Beruhigung eine Behauptung.
 */
export function raumFakten(items: Entity[]): string {
  const teile: string[] = [];
  const bedienbar = items.filter(
    (entity) => entity.kind !== 'sensor' && entity.commands.length > 0
  );
  const an = bedienbar.filter(
    (entity) => entity.state.state === 'on' || entity.state.state === 'playing'
  ).length;
  if (bedienbar.length > 0) {
    teile.push(an === 0 ? 'Alles aus' : `${an} von ${bedienbar.length} an`);
  }
  // Dieselben Klassen wie openContacts (lib/offen.ts) - sonst hiesse es
  // «Fenster zu» aus einem anderen Fensterbegriff, als «offen» ihn hat.
  const kontakte = items.filter(
    (entity) =>
      entity.kind === 'binary_sensor' &&
      ['contact', 'door', 'window', 'garage'].includes(
        String(entity.state?.device_class ?? '')
      )
  );
  const offen = openContacts(items);
  if (offen.length === 1) teile.push(`${offen[0].name} offen`);
  else if (offen.length > 1) teile.push(`${offen.length} offen`);
  else if (kontakte.length > 0) teile.push('Fenster zu');
  if (
    items.some(
      (entity) => entity.kind === 'media_player' && entity.state.state === 'playing'
    )
  ) {
    teile.push('Musik läuft');
  }
  return teile.join(' · ');
}

/** Brennt im Raum Licht? Daran hängt der warme Schein im Raumkopf -
 *  ohne Licht bleibt der Kopf im normalen Blaugrau (rein, testbar). */
export function raumLeuchtet(items: Entity[]): boolean {
  return items.some(
    (entity) => entity.kind === 'light' && entity.state.state === 'on'
  );
}

/**
 * Liegt der Raum im Dunkeln? (rein, testbar)
 *
 * Daran hängt das abgedunkelte Kopfbild der Raumkachel: Ist alles Licht
 * aus, sieht die Kachel aus wie das Zimmer selbst - dunkel. So liest man
 * die Übersicht wie einen Blick durch die Wohnung, ohne eine einzige
 * Zustandszeile zu lesen.
 *
 * Nur Räume, die überhaupt Licht *haben*: Ein Eingang mit bloss einer
 * Kamera kann nie leuchten und stünde sonst für immer im Dunkeln - das
 * sähe aus wie ein Fehler, nicht wie eine Auskunft.
 */
export function raumDunkel(items: Entity[]): boolean {
  return (
    items.some((entity) => entity.kind === 'light') && !raumLeuchtet(items)
  );
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

/**
 * Ist das die Küche? (rein, testbar)
 *
 * Klingt trivial, war es nicht: Die Prüfung lautete `/küche/i` – und
 * «Waschküche» enthält «küche». Der Küchentimer stand darum in beiden
 * Räumen. Deutsche Zusammensetzungen hängen das Grundwort hinten an,
 * also zählt nur ein «Küche» am Wortanfang: «Küche», «Küche oben»,
 * «Grosse Küche» ja – «Waschküche», «Teeküche», «Sommerküche» nein.
 */
export function istKueche(raum: unknown): boolean {
  return /(^|\s)küchen?(\s|$)/i.test(String(raum ?? '').trim());
}
