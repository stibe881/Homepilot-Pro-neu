/**
 * Das Rechnen hinter der Saugerkarte – ohne Bildschirm, ohne Netz.
 *
 * Herausgelöst aus VacuumHome.tsx, damit es prüfbar ist: Ob ein Tipp im
 * Gang wirklich den Gang trifft, entscheidet sich hier und nicht in
 * einer Komponente, die Jest gar nicht laden kann.
 */

import { Entity } from '../api/types';

export interface VacuumRoom {
  id: number;
  name: string;
  /** [x0, y0, x1, y1] als Anteile (0..1) des Kartenbilds – die Hülle. */
  box?: number[];
  /**
   * Die tatsächliche Form: Rechtecke [x, y, breite, höhe] als Anteile.
   *
   * Der Hub liest sie aus dem gerenderten Kartenbild (kartenform.py).
   * Ohne sie bleibt es bei der Hülle – bei einer rechtwinkligen Wohnung
   * ist das dasselbe.
   */
  shape?: number[][];
}

export type Box = [number, number, number, number];

/**
 * Wie ein Zustand auf Deutsch heisst.
 *
 * Der Hub übersetzt die Namen der Roborock-Bibliothek schon auf dieses
 * Vokabular (integrations/roborock.py: zustand_name). Die Liste hier ist
 * trotzdem etwas grosszügiger: Ein Hub, der noch nicht aktualisiert ist,
 * schickt weiter «segment_cleaning» - und dann soll auf der Kachel kein
 * Bezeichner stehen.
 */
const ZUSTAND_WOERTER: Record<string, string> = {
  cleaning: 'Reinigt',
  segment_cleaning: 'Reinigt',
  zoned_cleaning: 'Reinigt',
  spot_cleaning: 'Reinigt',
  returning: 'Fährt zur Station',
  returning_home: 'Fährt zur Station',
  docking: 'Fährt zur Station',
  charging: 'Lädt',
  charging_complete: 'Geladen',
  docked: 'An der Station',
  washing_the_mop: 'Wäscht den Mopp',
  emptying_the_bin: 'Leert den Behälter',
  idle: 'Bereit',
  paused: 'Pausiert',
  error: 'Fehler',
  unknown: 'Unbekannt',
};

/**
 * Ein unbekannter Zustand als lesbarer Text (rein, testbar).
 *
 * Ein Bezeichner wie «segment_cleaning» auf der Kachel sieht nach
 * Werkstatt aus. Was der Hub nicht kennt, wird deshalb wenigstens zu
 * Wörtern - lieber ein englisches Wort mit grossem Anfangsbuchstaben
 * als ein Unterstrich in der Wohnung.
 */
export function zustandLesbar(roh: string): string {
  const worte = roh.replace(/[_-]+/g, ' ').trim();
  if (!worte) return '–';
  return worte.charAt(0).toUpperCase() + worte.slice(1);
}

/**
 * Fährt der Sauger gerade? (rein, testbar)
 *
 * Nicht `state === 'cleaning'`: Der Hub übersetzt zwar, aber ein Hub,
 * der noch nicht aktualisiert ist, schickt weiter «segment_cleaning» -
 * und dann bot der Knopf «Reinigen» an, während sie reinigte.
 */
export function saugerFaehrt(state: unknown): boolean {
  const text = String(state ?? '').toLowerCase();
  return text.includes('clean') || text === 'returning' || text.includes('return');
}

/** Der Zustand in einem Wort – «Reinigt», «Lädt» (rein, testbar). */
export function zustandWort(state: unknown): string {
  const roh = String(state ?? '');
  return ZUSTAND_WOERTER[roh] ?? zustandLesbar(roh);
}

/**
 * Was Sauger oder Station gerade melden - als Sätze (rein, testbar).
 *
 * Punkt 637: Gewünscht im Haus, dass der Fehler auf dem Reinigungsblatt
 * steht, nicht nur in der Push-Nachricht. Übersetzt hat der Hub
 * (`problems`, watchrules.sauger_saetze) - die App hält keine zweite
 * Tabelle. Ein Hub, der das Feld noch nicht kennt, bekommt die rohen
 * Namen aus `error` und `dock` lesbar gemacht: lieber «robot trapped»
 * als gar nichts.
 */
export function saugerprobleme(sauger: { state: Record<string, unknown> }): string[] {
  const fertig = sauger.state.problems;
  if (Array.isArray(fertig)) return fertig.map(String).filter((satz) => satz.trim() !== '');
  const ok = ['', 'none', 'ok', 'okay', '0'];
  const roh: string[] = [];
  const fehler = String(sauger.state.error ?? '').trim();
  if (!ok.includes(fehler.toLowerCase())) roh.push(fehler);
  const dock = sauger.state.dock;
  if (dock && typeof dock === 'object') {
    for (const feld of ['error', 'dirty_water', 'clear_water', 'dust_bag', 'water_shortage']) {
      const wert = String((dock as Record<string, unknown>)[feld] ?? '').trim();
      if (!ok.includes(wert.toLowerCase())) roh.push(wert);
    }
  }
  return roh.map((wert) => `Der Sauger meldet: ${wert.replace(/_/g, ' ')}.`);
}

/** Eine Zeile im Stations-Fenster (Punkt 639). */
export interface Stationszeile {
  label: string;
  wert: string;
  /** Rot: eine Störung, kein Betriebswert. */
  stoerung: boolean;
}

/** Die Felder der Station, die Störungen tragen - sie stehen nicht als
 *  rohe Werte im Fenster, sondern als die Sätze des Hubs (`problems`). */
const STATION_STOERFELDER = ['error', 'dirty_water', 'clear_water', 'dust_bag', 'water_shortage'];

/** Was die Betriebsfelder der Station heissen. */
const STATION_LABELS: Record<string, string> = {
  type: 'Stationstyp',
  wash_phase: 'Waschgang',
  drying: 'Trocknung',
  dust_collection: 'Staubentleerung',
  auto_empty: 'Automatische Entleerung',
};

/** Die Bauarten, die einen sprechenden Namen haben; der Rest wird aus
 *  dem Bezeichner der Bibliothek gelesen gemacht (stationstyp). */
const STATION_TYPEN: Record<string, string> = {
  empty_wash_fill_dry_dock: 'Absaugen, Waschen, Trocknen',
  auto_empty_dock: 'Absaug-Station',
  wash_fill_dock: 'Waschstation',
  no_dock: 'Einfache Ladestation',
  unknown: 'Unbekannt',
};

/**
 * Der Stationstyp als Name statt Bezeichner (rein, testbar).
 *
 * «shell_3s_dock» ist der interne Name der Bibliothek für die Station
 * des Saros - einen deutschen Namen gibt es dafür nicht, aber «Shell
 * 3S» liest sich wie ein Modellname und nicht wie ein Schlüssel.
 */
export function stationstyp(roh: unknown): string {
  const wert = String(roh ?? '').trim();
  const bekannt = STATION_TYPEN[wert.toLowerCase()];
  if (bekannt) return bekannt;
  const teile = wert
    .toLowerCase()
    .split('_')
    .filter((teil) => teil && teil !== 'dock');
  if (teile.length === 0) return wert || '–';
  return teile
    .map((teil) => (/\d/.test(teil) ? teil.toUpperCase() : teil.charAt(0).toUpperCase() + teil.slice(1)))
    .join(' ');
}

/** Ein Betriebswert der Station auf Deutsch (rein, testbar). */
export function stationswert(feld: string, roh: unknown): string {
  if (feld === 'type') return stationstyp(roh);
  const zahl = typeof roh === 'number' ? roh : Number(roh);
  if (Number.isNaN(zahl)) return String(roh ?? '–');
  // Die Bibliothek liefert hier Zahlen ohne Namen: Waschgang 0 heisst
  // «gerade keiner», Trocknung und Entleerung 0/1 heisst aus/läuft,
  // und die automatische Entleerung ist eine Einstellung: aus/ein.
  if (feld === 'wash_phase') return zahl === 0 ? 'Keiner' : `Phase ${zahl}`;
  if (feld === 'auto_empty') return zahl === 0 ? 'Aus' : 'Ein';
  if (feld === 'drying' || feld === 'dust_collection') return zahl === 0 ? 'Aus' : 'Läuft';
  return String(roh);
}

/**
 * Die Zeilen des Stations-Fensters (rein, testbar) - Punkt 639.
 *
 * Aus dem Haus: «Hier stehen Texte noch auf Englisch und mit
 * Underline.» Störungen stehen jetzt als die Sätze des Hubs (dieselben
 * wie in der Push-Nachricht, saugerprobleme), rot; die Betriebswerte
 * übersetzt; und die Störfelder erscheinen nicht nochmals roh darunter.
 * Unbekannte Felder bleiben lesbar gemacht stehen - lieber ein
 * englisches Wort als ein verschlucktes.
 */
export function stationszeilen(sauger: { state: Record<string, unknown> }): Stationszeile[] {
  const zeilen: Stationszeile[] = [];
  const akku = sauger.state.battery;
  if (akku != null) zeilen.push({ label: 'Akku', wert: `${akku} %`, stoerung: false });
  for (const satz of saugerprobleme(sauger)) {
    zeilen.push({ label: 'Störung', wert: satz, stoerung: true });
  }
  const dock = sauger.state.dock;
  if (dock && typeof dock === 'object') {
    for (const [feld, roh] of Object.entries(dock as Record<string, unknown>)) {
      if (STATION_STOERFELDER.includes(feld)) continue;
      zeilen.push({
        label: STATION_LABELS[feld] ?? zustandLesbar(feld),
        wert: stationswert(feld, roh),
        stoerung: false,
      });
    }
  }
  return zeilen;
}

/** Ein Knopf auf dem Reinigungsblatt (Punkt 636). */
export interface Saugerknopf {
  command: 'pause' | 'start' | 'locate' | 'dock';
  label: string;
  icon: 'pause-outline' | 'play-outline' | 'search-outline' | 'home-outline';
}

/**
 * Welche Knöpfe neben «Reinigung starten» stehen (rein, testbar).
 *
 * Gewünscht im Haus (Punkt 636): Auf dem Blatt, das der Chip «saugt»
 * öffnet, soll man pausieren, den Sauger finden und ihn zur Station
 * schicken können - nicht erst über das Stations-Fenster. Was gerade
 * keinen Sinn hat, fehlt: «Pausieren» nur, während er fährt, «Weiter»
 * nur, wenn er pausiert (Roborock nimmt dafür dasselbe «start»), «Zur
 * Station» nicht, wenn er schon dort steht oder gerade hinfährt.
 */
export function saugerknoepfe(
  sauger: Pick<Entity, 'commands'> & { state: { state?: unknown } }
): Saugerknopf[] {
  const zustand = String(sauger.state.state ?? '').toLowerCase();
  const kann = (command: string) => sauger.commands.includes(command);
  const knoepfe: Saugerknopf[] = [];
  const faehrt = saugerFaehrt(zustand);
  const unterwegs = zustand.includes('return') || zustand === 'docking';
  if (faehrt && !unterwegs && kann('pause')) {
    knoepfe.push({ command: 'pause', label: 'Pausieren', icon: 'pause-outline' });
  } else if (zustand === 'paused' && kann('start')) {
    knoepfe.push({ command: 'start', label: 'Weiter', icon: 'play-outline' });
  }
  if (kann('locate')) {
    knoepfe.push({ command: 'locate', label: 'Finden', icon: 'search-outline' });
  }
  const zuhause = ['docked', 'charging', 'charging_complete'].includes(zustand);
  if (kann('dock') && !zuhause && !unterwegs) {
    knoepfe.push({ command: 'dock', label: 'Zur Station', icon: 'home-outline' });
  }
  return knoepfe;
}

/** «Reinigt · 82 %» – Zustand und Akku in einer Zeile (rein, testbar). */
export function vacuumText(vacuum: Entity): string {
  const wort = zustandWort(vacuum.state.state);
  const battery = vacuum.state.battery;
  return battery != null ? `${wort} · ${battery} %` : wort;
}

/** Umriss aller Räume mit etwas Rand – der Bereich des Bilds, der wirklich
 *  Wohnung zeigt (rein, testbar). */
export function contentBox(rooms: VacuumRoom[], pad = 0.03): Box | null {
  const boxes = rooms.map((room) => room.box).filter(Array.isArray) as number[][];
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((box) => box[0]));
  const y0 = Math.min(...boxes.map((box) => box[1]));
  const x1 = Math.max(...boxes.map((box) => box[2]));
  const y1 = Math.max(...boxes.map((box) => box[3]));
  return padBox([x0, y0, x1, y1], pad);
}

export function padBox(box: Box, pad: number): Box {
  return [
    Math.max(0, box[0] - pad),
    Math.max(0, box[1] - pad),
    Math.min(1, box[2] + pad),
    Math.min(1, box[3] + pad),
  ];
}

/** Liegt der Punkt in der tatsächlichen Zimmerform? (rein, testbar) */
export function inShape(shape: number[][] | undefined, x: number, y: number): boolean {
  if (!Array.isArray(shape)) return false;
  return shape.some(
    (r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]
  );
}

/**
 * Welches Zimmer liegt an diesem Punkt? (rein, testbar)
 *
 * Mit der tatsächlichen Form ist das eine klare Frage: Der Punkt liegt
 * in genau einem Zimmer, und das gewinnt.
 *
 * Ohne Form – ältere Hub-Fassung, oder die Farbsuche im Kartenbild hat
 * nichts hergegeben – bleibt die alte Näherung: Die Hüllen sind
 * achsenparallele Rechtecke um schief liegende Räume und überlappen sich
 * deshalb kräftig (der Gang einer diagonalen Wohnung umschliesst als
 * Rechteck halbe Nachbarzimmer). Von allen Treffern gewinnt dann das
 * kleinste – es beschreibt den Punkt am genauesten.
 */
export function roomAt(rooms: VacuumRoom[], x: number, y: number): VacuumRoom | null {
  for (const room of rooms) {
    if (inShape(room.shape, x, y)) return room;
  }
  let best: VacuumRoom | null = null;
  let bestArea = Infinity;
  for (const room of rooms) {
    // Zimmer mit Form haben oben schon entschieden – ihre Hülle darf
    // jetzt nicht doch noch den Nachbarn überstimmen.
    if (Array.isArray(room.shape)) continue;
    const box = room.box;
    if (!Array.isArray(box)) continue;
    if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
    const area = (box[2] - box[0]) * (box[3] - box[1]);
    if (area < bestArea) {
      best = room;
      bestArea = area;
    }
  }
  return best;
}

/** In welchem Zimmer steht der Sauger? (rein, testbar) */
export function robotRoom(rooms: VacuumRoom[], robot: number[] | undefined): VacuumRoom | null {
  if (!Array.isArray(robot) || robot.length !== 2) return null;
  return roomAt(rooms, robot[0], robot[1]);
}

/** Eine Fläche vom Bild- in den Ausschnitt-Raum umrechnen (rein, testbar). */
export function inCrop(box: number[], crop: Box): Box | null {
  const width = crop[2] - crop[0];
  const height = crop[3] - crop[1];
  if (width <= 0 || height <= 0) return null;
  const x0 = (box[0] - crop[0]) / width;
  const y0 = (box[1] - crop[1]) / height;
  const x1 = (box[2] - crop[0]) / width;
  const y1 = (box[3] - crop[1]) / height;
  if (x1 <= 0 || y1 <= 0 || x0 >= 1 || y0 >= 1) return null;
  return [Math.max(0, x0), Math.max(0, y0), Math.min(1, x1), Math.min(1, y1)];
}

/**
 * Die Rechtecke einer Zimmerform im Ausschnitt (rein, testbar).
 *
 * Was ausserhalb liegt, fällt weg; der Rest kommt als [x, y, breite,
 * höhe] in Ausschnitt-Anteilen zurück – fertig zum Zeichnen.
 */
export function shapeInCrop(shape: number[][] | undefined, crop: Box): number[][] {
  if (!Array.isArray(shape)) return [];
  const teile: number[][] = [];
  for (const r of shape) {
    const area = inCrop([r[0], r[1], r[0] + r[2], r[1] + r[3]], crop);
    if (!area) continue;
    teile.push([area[0], area[1], area[2] - area[0], area[3] - area[1]]);
  }
  return teile;
}
