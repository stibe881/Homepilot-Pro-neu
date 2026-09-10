import type { Ionicons } from '@expo/vector-icons';

import { Entity } from '../api/types';
import { istBewegungsmelder } from './bewegung';
import { zaehltAlsAn } from './geraeteart';
import { istKlimaFuehler } from './klimachip';
import { istKontakt, kontaktArt, openContacts } from './offen';
import { aktiveVorgabe } from './storenvorgaben';

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

/** Der Feuchtefühler des Raums, wenn er ein eigenes Gerät ist – der
 *  erste nach Name, wie bei der Temperatur. `istKlimaFuehler` hält
 *  Akkustand und Sendespeicher heraus: Die zählen auch in Prozent. */
function feuchtigkeit(items: Entity[]): Entity | undefined {
  return items
    .filter((entity) => istKlimaFuehler(entity, 'humidity'))
    .sort((a, b) => a.name.localeCompare(b.name))[0];
}

/**
 * Das Klima des Raums für den grossen Wert rechts neben dem Titel
 * (rein, testbar). Null, wenn der Raum weder Temperatur noch Feuchte
 * misst - dann trägt der Kopf einfach keinen Wert, statt «–» zu zeigen.
 *
 * Die Feuchte stand bisher nur da, wenn derselbe Fühler sie mitlieferte
 * (`state.humidity`). In der Waschküche sind es zwei Geräte, und die
 * Feuchte lag darum als Chip unter dem Kopf - dieselbe Auskunft in
 * einer anderen Form, zwei Zeilen tiefer. Jetzt steht sie in beiden
 * Fällen an derselben Stelle: klein unter dem Grad.
 */
export function raumKlima(items: Entity[]): {
  fuehler: Entity | null;
  temp: string | null;
  feuchteFuehler: Entity | null;
  feuchte: string | null;
} | null {
  const fuehler = temperatur(items) ?? null;
  // Der eigene Feuchtefühler zählt nur, wenn der Temperaturfühler die
  // Feuchte nicht schon selbst meldet - sonst stünde sie doppelt.
  const eigen =
    fuehler && typeof fuehler.state.humidity === 'number'
      ? undefined
      : feuchtigkeit(items);
  const prozent =
    fuehler && typeof fuehler.state.humidity === 'number'
      ? Number(fuehler.state.humidity)
      : eigen
        ? Number(eigen.state.state)
        : null;
  if (!fuehler && prozent === null) return null;
  return {
    fuehler,
    temp: fuehler
      ? `${Number(fuehler.state.state).toFixed(1).replace('.', ',')}°`
      : null,
    feuchteFuehler: eigen ?? null,
    feuchte: prozent === null ? null : `${Math.round(prozent)} % Feuchte`,
  };
}

/** Mehrzahl, wo sie hingehört: «1 Fenster», «2 Fenster», «2 Türen». */
function stueck(anzahl: number, art: 'window' | 'door'): string {
  if (art === 'window') return `${anzahl} Fenster`;
  return anzahl === 1 ? '1 Türe' : `${anzahl} Türen`;
}

/**
 * Was der Raumkopf über Fenster und Türen sagt (rein, testbar).
 *
 * Die Kontakte hatten im Raum eine eigene Kategorie mit einer Kachel je
 * Stück - eine ganze Überschrift und eine halbe Bildschirmhöhe für die
 * Auskunft «zu». Sie ist eine Zeile wert, keine Kachel: Bedienen kann
 * man einen Kontakt ohnehin nicht, und die Kachel sagte nichts, was
 * hier nicht auch steht.
 *
 * Fenster und Türen getrennt, weil es etwas anderes ist: Ein gekipptes
 * Fenster ist eine Notiz, eine offene Türe etwas, das man jetzt wissen
 * will (dieselbe Trennung wie hasOpenDoor). Woran ein Kontakt hängt,
 * sagt kontaktArt - notfalls geraten, und darum in Geräte → Anpassen
 * überschreibbar.
 *
 * Leer, wenn der Raum gar keinen Kontakt hat: «Fenster zu» wäre dort
 * eine Behauptung über etwas, das niemand misst.
 */
export function kontaktZeile(items: Entity[]): string {
  const kontakte = items.filter(istKontakt);
  if (kontakte.length === 0) return '';
  const offen = openContacts(kontakte);
  // Einer offen: Sein Name sagt mehr als seine Art - «Küchenfenster
  // offen» ist die Auskunft, «1 Fenster offen» nur die halbe.
  if (offen.length === 1) return `${offen[0].name} offen`;
  if (offen.length > 1) {
    const teile = (['window', 'door'] as const)
      .map((art) => [art, offen.filter((e) => kontaktArt(e) === art).length] as const)
      .filter(([, anzahl]) => anzahl > 0)
      .map(([art, anzahl]) => stueck(anzahl, art));
    return `${teile.join(' und ')} offen`;
  }
  const arten = new Set(kontakte.map(kontaktArt));
  if (arten.size > 1) return 'Fenster und Türen zu';
  return arten.has('window') ? 'Fenster zu' : 'Türen zu';
}

/**
 * Die Faktenzeile unter dem Raumnamen (rein, testbar): «1 von 4 an ·
 * Fenster zu · Musik läuft». Ohne Klima - das steht gross daneben.
 *
 * Gezählt wird, was der Raum auch zeigt. Vorher war es alles, was der
 * Raum *enthält* - und über vier Lampenkacheln stand «1 von 14 an». Die
 * zehn übrigen waren die einzelnen Spots der beiden Leuchten: Wer eine
 * Deckenlampe aus fünf Spots zusammenfasst, hat damit gesagt, dass es
 * eine Lampe ist (`combined_into`). Ebenso die ausgeblendeten Kacheln -
 * eine Zahl, die Geräte mitzählt, die man nicht sieht, kann man nicht
 * nachzählen, und eine Zahl, die man nicht nachzählen kann, glaubt man
 * beim nächsten Mal nicht mehr.
 *
 * «Fenster zu» steht nur, wenn der Raum überhaupt Kontakte hat: In
 * einem Raum ohne Fenstersensor wäre die Beruhigung eine Behauptung.
 */
export function raumFakten(items: Entity[], hidden: string[] = []): string {
  const teile: string[] = [];
  const sichtbar = items.filter(
    (entity) => !entity.combined_into && !hidden.includes(entity.id)
  );
  const bedienbar = sichtbar.filter(zaehltAlsAn);
  const an = bedienbar.filter(
    (entity) => entity.state.state === 'on' || entity.state.state === 'playing'
  ).length;
  if (bedienbar.length > 0) {
    teile.push(an === 0 ? 'Alles aus' : `${an} von ${bedienbar.length} an`);
  }
  const kontaktsatz = kontaktZeile(sichtbar);
  if (kontaktsatz) teile.push(kontaktsatz);
  if (
    sichtbar.some(
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
/** Steht diese Store in Beschattung – unten, mit offenen Lamellen?
 *  (rein, testbar) – dieselbe Ableitung wie die Stellungs-Chips der
 *  Gerätekachel (lib/storenvorgaben.ts), damit beide dasselbe sagen. */
export function inBeschattung(entity: Entity): boolean {
  if (entity.kind !== 'cover') return false;
  const position = entity.state.position;
  const tilt = entity.state.tilt;
  return (
    aktiveVorgabe(
      typeof position === 'number' ? position : null,
      typeof tilt === 'number' ? tilt : null,
      entity.commands.includes('set_tilt')
    ) === 'schatten'
  );
}

export function raumZeile(items: Entity[]): string {
  const teile: string[] = [];
  // Auf der Übersicht liest man die Räume nebeneinander wie einen Blick
  // durch die Wohnung. Ein Fühler, der «nur für seinen Raum» zählt
  // (Geräte → Anpassen), gehört da nicht hin: Die 30 Grad neben dem
  // Rack in der Waschküche stünden zwischen lauter Wohntemperaturen.
  // Im Raum selbst steht er weiterhin gross im Kopf (raumKlima).
  const fuehler = temperatur(items.filter((entity) => !entity.room_only));
  if (fuehler) {
    teile.push(`${Number(fuehler.state.state).toFixed(1).replace('.', ',')}°`);
    if (typeof fuehler.state.humidity === 'number') {
      teile.push(`${Math.round(fuehler.state.humidity)} %`);
    }
  }
  const offen = openContacts(items);
  if (offen.length === 1) teile.push(`${offen[0].name} offen`);
  else if (offen.length > 1) teile.push(`${offen.length} offen`);
  // Unten, aber hell: der eine Storen-Zustand, den man an der Höhe
  // nicht ablesen kann - genau er gehört deshalb in die Zeile. «Zu»
  // und «Offen» stehen hier bewusst nicht: mehr Worte, keine Auskunft,
  // die der Storen-Knopf der Kachel nicht schon über seinen Pfeil gibt.
  if (items.some(inBeschattung)) teile.push('Beschattung');
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
  // Dieselbe Falle wie beim Küchentimer (istKueche weiter unten):
  // «Waschküche» enthält «küche», und weil diese Zeile die erste war,
  // trug die Waschküche im Kopf ein Besteck. Deutsche Zusammensetzungen
  // hängen das Grundwort hinten an - also zählt nur ein «Küche», das
  // für sich steht.
  if (istKueche(name) || /kitchen/.test(n)) return 'restaurant-outline';
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
 * statt als volle Kacheln zwischen dem Bedienbaren. Ebenso die Fenster-
 * und Türkontakte - aus demselben Grund. Ebenso die
 * Lichtszenen der Bridge: Sie hatten eine eigene Kategorie
 * «Lichtszene» ganz unten, hinter Beleuchtung, Store und Medien - und
 * standen damit weit weg von den Szenen des Hubs, die dasselbe tun.
 * Beide stehen jetzt zusammen im Raumkopf (lib/szenen.ts, raumSzenen).
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
  // Der Rest nach Geräteart, alphabetisch – Messwerte und Lichtszenen
  // ausgenommen; beide stehen oben im Raumkopf.
  const rest = items.filter(
    (entity) =>
      !used.has(entity.id) &&
      entity.kind !== 'sensor' &&
      entity.kind !== 'scene' &&
      // Fenster- und Türkontakte stehen als Zeile im Raumkopf
      // (kontaktZeile). Als Kategorie kosteten sie eine Überschrift und
      // eine Kachel je Kontakt - für eine Auskunft, die «zu» lautet.
      // Bedienen lässt sich ein Kontakt ohnehin nicht; wer seine
      // Batterie sehen will, findet ihn unter Geräte.
      !istKontakt(entity) &&
      // Und aus demselben Grund die Bewegungsmelder: eine ganze
      // Kategorie «Bewegungsmelder» für die Auskunft «Ruhig». Bewegt
      // sich etwas, sagt es das Männchen im Raumkopf und auf der
      // Raumkachel (lib/bewegung.ts) - und das steht dort, wo man
      // hinsieht, statt eine Kachelreihe weiter unten.
      !istBewegungsmelder(entity)
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
