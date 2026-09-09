/**
 * Die Alarm-Eskalation: was nach der Frist passiert, wenn niemand entschärft.
 *
 * Punkt 255 der Werkbank, App-Seite. Der Hub (integrations/alarm_rules.py)
 * kennt die zweite Stufe: Erst Push und Kamera-Mitschnitt, und wer dann
 * innerhalb der Frist nicht entschärft, bekommt Sirene, Licht und
 * Durchsage. Hier steht die reine Logik der Bedienung – einlesen mit
 * Vorgaben, Frist-Stufen, welche Geräte als Sirene taugen und was im
 * zugeklappten Kopf steht.
 */

export interface Eskalation {
  enabled: boolean;
  /** Sekunden zwischen Auslösen und Eskalation. */
  after: number;
  /** Entitäten, die dann eingeschaltet werden. */
  sirens: string[];
  /** Durchsage auf die Boxen; leer heisst keine. */
  announce: string;
  /** Wohin die Durchsage geht. */
  announce_target: Durchsageziel;
  /** Die Boxen für «auswahl» - Gruppen sind hier gewöhnliche Einträge. */
  announce_speakers: string[];
  /** Lautstärke der Durchsage in Prozent; null = Vorgabe des Hubs. */
  volume: number | null;
}

/**
 * Wohin die Durchsage geht.
 *
 * «raum» meint den Raum, in dem der Melder ausgelöst hat - dort steht
 * der Einbrecher. Der Hub löst das erst im Alarmfall auf, weil vorher
 * niemand weiss, welcher Melder es sein wird.
 */
export type Durchsageziel = 'alle' | 'auswahl' | 'raum';

export const DURCHSAGEZIELE: { key: Durchsageziel; label: string; hinweis: string }[] = [
  { key: 'alle', label: 'Alle Boxen', hinweis: 'Im ganzen Haus wird es laut.' },
  {
    key: 'auswahl',
    label: 'Ausgewählte',
    hinweis: 'Nur diese Boxen - Gruppen zählen wie eine Box.',
  },
  {
    key: 'raum',
    label: 'Raum des Melders',
    hinweis: 'Die Boxen im Zimmer, in dem der Melder ausgelöst hat.',
  },
];

/** Dieselben Vorgaben wie im Hub (ESCALATION_DEFAULT): aus, bis jemand
 *  sie ausdrücklich einschaltet. */
export const ESKALATION_VORGABE: Eskalation = {
  enabled: false,
  after: 30,
  sirens: [],
  announce: '',
  announce_target: 'alle',
  announce_speakers: [],
  volume: null,
};

/**
 * Die Eskalation aus der Hub-Antwort einlesen (rein, testbar).
 *
 * Ein älterer Hub schickt das Feld gar nicht – dann gelten die Vorgaben,
 * und die App zeigt eine ausgeschaltete Eskalation statt zu stolpern.
 */
export function eskalationLesen(raw: unknown): Eskalation {
  const ergebnis = {
    ...ESKALATION_VORGABE,
    sirens: [] as string[],
    announce_speakers: [] as string[],
  };
  if (typeof raw !== 'object' || raw === null) return ergebnis;
  const roh = raw as Record<string, unknown>;
  ergebnis.enabled = !!roh.enabled;
  const after = Number(roh.after);
  if (Number.isFinite(after) && after >= 0) ergebnis.after = after;
  if (Array.isArray(roh.sirens)) {
    ergebnis.sirens = roh.sirens.map((s) => String(s)).filter((s) => s.trim() !== '');
  }
  ergebnis.announce = String(roh.announce ?? '');
  const ziel = String(roh.announce_target ?? '');
  if (DURCHSAGEZIELE.some((eintrag) => eintrag.key === ziel)) {
    ergebnis.announce_target = ziel as Durchsageziel;
  }
  if (Array.isArray(roh.announce_speakers)) {
    ergebnis.announce_speakers = roh.announce_speakers
      .map((s) => String(s))
      .filter((s) => s.trim() !== '');
  }
  const volume = Number(roh.volume);
  if (roh.volume != null && Number.isFinite(volume)) {
    ergebnis.volume = Math.max(0, Math.min(100, Math.round(volume)));
  }
  return ergebnis;
}

/** Die wählbaren Fristen. 0 ist dabei mit Absicht: Wer sofort eskalieren
 *  will, darf – das ist dann eine Entscheidung, kein Unfall. */
export const FRIST_STUFEN = [0, 15, 30, 60, 120, 300];

/** «sofort», «30 s», «2 min» – die Frist als Chip-Beschriftung
 *  (rein, testbar). */
export function fristLabel(sekunden: number): string {
  if (sekunden <= 0) return 'sofort';
  if (sekunden < 60) return `${sekunden} s`;
  const minuten = Math.round(sekunden / 60);
  return `${minuten} min`;
}

/**
 * Die wählbaren Fristen eines Schaltbefehls (rein, testbar).
 *
 * Dieselben Stufen wie bei der Eskalation, und aus demselben Grund: Wer
 * beim Alarm etwas verzögern will, denkt in «sofort», «eine halbe
 * Minute», «zwei Minuten» - nicht in Sekunden, die er eintippt.
 *
 * Der Schalter «Alle Lichter einschalten» der Eskalation ist damit
 * überflüssig geworden: «Licht an, nach 30 s» ist eine gewöhnliche
 * Zeile, und sie sagt, welches Licht.
 */
export const BEFEHLSFRISTEN = [0, 15, 30, 60, 120, 300];

/** Das Nötigste einer Entität für die Sirenen-Auswahl. */
export interface Schaltbar {
  id: string;
  name: string;
  kind: string;
  commands: string[];
  state?: { device_class?: string | null };
}

/**
 * Was hier «Sirene» heisst - und was nicht (rein, testbar).
 *
 * Ein Gerät, das beim Alarm eingeschaltet wird und Lärm macht: eine
 * echte Sirene, ein Signalgeber, ein Gong. Erkannt an der Art des
 * Geräts (kind «alert»/«siren»), an der Geräteklasse oder am Namen.
 */
export function istSirene(entity: Schaltbar): boolean {
  return (
    entity.kind === 'alert' ||
    entity.kind === 'siren' ||
    entity.state?.device_class === 'siren' ||
    /siren|sirene|gong|hupe|horn/i.test(entity.name)
  );
}

/**
 * Die Geräte für die Sirenen-Auswahl, in zwei Töpfen (rein, testbar).
 *
 * Vorher war es eine einzige Liste: erst die echten Sirenen, danach
 * *jeder* Schalter im Haus. Im Haus stand dadurch unter «Sirenen» ein
 * einzelner Eintrag - «Tumbler». Das ist keine Sirene, das ist die
 * Steckdose, an der ein Tumbler hängt, und als einziger Vorschlag unter
 * dieser Überschrift liest es sich wie ein Fehler des Programms.
 *
 * Der Grund für die zweite Liste bleibt trotzdem gültig: Wer eine
 * Baustellensirene an eine Zwischensteckdose hängt, muss sie wählen
 * können. Also getrennt - echte Sirenen offen, Schalter auf Wunsch, und
 * die Überschrift sagt dazu, wofür sie da sind.
 *
 * Haushaltgeräte fehlen in beiden: Ein Tumbler, der beim Einbruch
 * anläuft, hilft niemandem.
 */
export function sirenenGruppen<T extends Schaltbar>(
  entities: T[]
): { sirenen: T[]; schalter: T[] } {
  const einschaltbar = entities.filter((entity) => entity.commands.includes('turn_on'));
  return {
    sirenen: einschaltbar.filter(istSirene),
    schalter: einschaltbar.filter(
      (entity) => !istSirene(entity) && entity.kind === 'switch'
    ),
  };
}

/** Alle Geräte für die Sirenen-Auswahl - echte zuerst (rein, testbar). */
export function sirenenKandidaten<T extends Schaltbar>(entities: T[]): T[] {
  const gruppen = sirenenGruppen(entities);
  return [...gruppen.sirenen, ...gruppen.schalter];
}

/**
 * Die Boxen, auf die eine Durchsage gehen kann (rein, testbar).
 *
 * Was `play_url` kann, kann eine Durchsage abspielen - dieselbe Prüfung
 * wie im Hub (core/say.py, play_audio). Gruppen stehen dabei nicht
 * gesondert da: Eine Lautsprechergruppe ist für den Hub eine Box wie
 * jede andere, und genau so soll man sie auch wählen können.
 */
export function boxenKandidaten<T extends Schaltbar>(entities: T[]): T[] {
  return entities
    .filter((entity) => entity.commands.includes('play_url'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Was im zugeklappten Kopf der Klappe steht (rein, testbar).
 *
 * «aus» oder «nach 30 s: Sirene, Durchsage» – die häufigste Frage
 * («tut die Anlage nach der Frist etwas?») beantwortet der Kopf, ohne
 * dass jemand aufklappen muss.
 */
export function eskalationStand(eskalation: Eskalation): string {
  if (!eskalation.enabled) return 'aus';
  const teile: string[] = [];
  if (eskalation.sirens.length === 1) teile.push('Sirene');
  if (eskalation.sirens.length > 1) teile.push(`${eskalation.sirens.length} Sirenen`);
  if (eskalation.announce.trim() !== '') teile.push('Durchsage');
  // Eingeschaltet, aber ohne Wirkung: Der Hub stellt dann gar keinen
  // Timer – das soll der Kopf sagen, statt Sicherheit vorzutäuschen.
  if (teile.length === 0) return 'an, aber ohne Wirkung';
  return `nach ${fristLabel(eskalation.after)}: ${teile.join(', ')}`;
}

/**
 * Was im Kopf der zugeklappten Schalt-Karte steht (rein, testbar).
 *
 * Die Karte beginnt zugeklappt, und dann ist die Frage: Schaltet die
 * Anlage überhaupt etwas? «nichts» ist die wichtigere Auskunft von
 * beiden - eine Alarmanlage, die nur eine Nachricht schickt, informiert
 * bloss und vertreibt niemanden.
 */
export function geschaltetStand(
  actions: Record<string, { entity_id: string; command: string }[]>
): string {
  const anzahl = Object.values(actions ?? {}).reduce(
    (summe, liste) => summe + (Array.isArray(liste) ? liste.length : 0),
    0
  );
  if (anzahl === 0) return 'nichts';
  return anzahl === 1 ? '1 Befehl' : `${anzahl} Befehle`;
}

/**
 * Was im zugeklappten Kopf der Sensoren-Karte steht (rein, testbar).
 *
 * Die Karte ist lang und wird einmal eingerichtet, deshalb beginnt sie
 * zugeklappt - und dann muss ihr Kopf die Frage beantworten, die man
 * ohne sie hat: Wie viele Sensoren wachen im gerade gewählten Modus?
 * «Nacht: 0 Sensoren» ist dabei die wichtigste Auskunft der Seite: Eine
 * scharfe Anlage ohne zugeordneten Sensor bewacht nichts, und das sah
 * man vorher erst nach dem Aufklappen.
 */
export function sensorenStand(modus: string, anzahl: number): string {
  const zahl = anzahl === 1 ? '1 Sensor' : `${anzahl} Sensoren`;
  return modus ? `${modus}: ${zahl}` : zahl;
}

/**
 * Ob eine Verlaufszeile zum gewählten Filter gehört (rein, testbar).
 *
 * «escalated» zählt zum Filter «Alarm»: Die Eskalation ist die zweite
 * Stufe desselben Vorfalls – wer nach Alarmen sucht, will sie sehen,
 * und ein eigener Chip für die seltenste Zeile wäre nur Lärm.
 */
export function verlaufPasst(kind: string, filter: string): boolean {
  if (filter === 'alle') return true;
  if (filter === 'triggered') return kind === 'triggered' || kind === 'escalated';
  return kind === filter;
}
