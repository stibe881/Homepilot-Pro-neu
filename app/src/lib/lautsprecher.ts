/**
 * Die Lautsprecher-Seite, soweit sie entscheidbar ist.
 *
 * Was dort steht, war bisher in vier Karten verteilt, und die Frage, mit
 * der man hinkommt, beantwortete keine davon: «Kennt der Hub die Box im
 * Wohnzimmer schon?» Man musste zwei Listen durchgehen und je Zeile das
 * kleine Wort rechts lesen.
 *
 * Deshalb hier: der Stand einer Box als ein Wort, die Übersicht als ein
 * Satz - und beides rein, damit es einen Test hat. Die Sätze sind der
 * eigentliche Inhalt der Seite; sie gehören nicht in eine Bildschirm-
 * Datei, in der sie nur beim Hinsehen zu prüfen wären.
 */

/** Eine Box, wie der Hub sie meldet (api/routes/medien.py). */
export interface Box {
  /** Eindeutig – die Adresse allein reicht nicht: Eine Gruppe läuft auf
   *  der IP eines ihrer Mitglieder, nur mit eigenem Port. */
  uuid?: string;
  name: string;
  host: string;
  port?: number;
  model?: string;
  group: boolean;
  entity_id?: string | null;
  /** In der App vergebener Name, wenn er vom Netz-Namen abweicht. */
  app_name?: string | null;
}

/** Wie eine Box in der App heisst (rein, testbar). */
export function boxName(entry: Pick<Box, 'name' | 'app_name'>): string {
  return entry.app_name || entry.name;
}

/** Kennung einer Box für Listen und Nachschlagewerke (rein, testbar). */
export function boxSchluessel(entry: Box): string {
  return entry.uuid || `${entry.host}:${entry.port ?? 8009}`;
}

/**
 * Wo eine Box gerade steht (rein, testbar).
 *
 * Drei Zustände, und die Reihenfolge ist die der Wahrheit: Wer eine
 * Entität hat, ist eingebunden - auch wenn er in derselben Sitzung eben
 * erst übernommen wurde. Sonst zählt, ob der Eintrag schon geschrieben
 * ist und nur noch der Neustart fehlt.
 */
export function boxStand(
  entry: Box,
  wartend: string[] = []
): 'eingebunden' | 'wartet' | 'neu' {
  if (entry.entity_id) return 'eingebunden';
  return wartend.includes(entry.name) ? 'wartet' : 'neu';
}

/**
 * Der Satz über der Liste (rein, testbar).
 *
 * Er beantwortet die Frage, mit der man auf diese Seite kommt, ohne dass
 * jemand zwei Listen durchzählt. «Vermisst» steht nur da, wenn es etwas
 * zu vermissen gibt - eine Null in der Zeile wäre eine Sorge, die
 * niemand hat.
 */
export function uebersichtSatz(boxen: Box[] | null, vermisst: string[] = []): string {
  if (boxen === null) return 'Sucht Boxen im Netz …';
  if (boxen.length === 0 && vermisst.length === 0) {
    return 'Keine Box im Netz gefunden.';
  }
  const eingebunden = boxen.filter((box) => !!box.entity_id).length;
  const teile = [
    boxen.length === 1 ? '1 Box gefunden' : `${boxen.length} Boxen gefunden`,
    `${eingebunden} eingebunden`,
  ];
  if (vermisst.length > 0) {
    teile.push(vermisst.length === 1 ? '1 vermisst' : `${vermisst.length} vermisst`);
  }
  return teile.join(' · ');
}

/**
 * Die zweite Zeile einer Box (rein, testbar).
 *
 * Was dort steht, hängt davon ab, was es überhaupt zu sagen gibt: der
 * Netz-Name nur bei umbenannten Boxen, die Mitglieder nur bei Gruppen,
 * die man aufgeklappt hat. Die Adresse steht zuletzt - sie beantwortet
 * keine Frage, die man täglich hat, aber genau die, wenn zwei Boxen
 * gleich heissen.
 */
export function boxZeile(entry: Box, mitglieder?: string[] | null): string {
  const teile: string[] = [];
  if (entry.app_name && entry.app_name !== entry.name) {
    teile.push(`im Netz «${entry.name}»`);
  }
  if (mitglieder) {
    teile.push(mitglieder.length > 0 ? mitglieder.join(', ') : 'Mitglieder nicht lesbar');
  }
  if (entry.host) teile.push(entry.host);
  if (entry.model) teile.push(entry.model);
  return teile.join(' · ');
}

/**
 * Die Boxen in der Reihenfolge, in der man sie sucht (rein, testbar).
 *
 * Gruppen zuerst - sie sind die, die man im Player wirklich auswählt -,
 * dann die einzelnen Boxen, und innerhalb beider alphabetisch nach dem
 * Namen, den die App zeigt. Vorher standen sie in der Reihenfolge, in
 * der das Netz geantwortet hat: bei jeder Suche eine andere.
 */
export function boxenSortiert(boxen: Box[]): Box[] {
  const nachNamen = (a: Box, b: Box) => boxName(a).localeCompare(boxName(b), 'de-CH');
  return [
    ...boxen.filter((box) => box.group).sort(nachNamen),
    ...boxen.filter((box) => !box.group).sort(nachNamen),
  ];
}
