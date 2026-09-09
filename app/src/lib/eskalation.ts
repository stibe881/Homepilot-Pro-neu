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
  all_lights: boolean;
  /** Durchsage auf die Boxen; leer heisst keine. */
  announce: string;
  /** Lautstärke der Durchsage in Prozent; null = Vorgabe des Hubs. */
  volume: number | null;
}

/** Dieselben Vorgaben wie im Hub (ESCALATION_DEFAULT): aus, bis jemand
 *  sie ausdrücklich einschaltet. */
export const ESKALATION_VORGABE: Eskalation = {
  enabled: false,
  after: 30,
  sirens: [],
  all_lights: false,
  announce: '',
  volume: null,
};

/**
 * Die Eskalation aus der Hub-Antwort einlesen (rein, testbar).
 *
 * Ein älterer Hub schickt das Feld gar nicht – dann gelten die Vorgaben,
 * und die App zeigt eine ausgeschaltete Eskalation statt zu stolpern.
 */
export function eskalationLesen(raw: unknown): Eskalation {
  const ergebnis = { ...ESKALATION_VORGABE, sirens: [] as string[] };
  if (typeof raw !== 'object' || raw === null) return ergebnis;
  const roh = raw as Record<string, unknown>;
  ergebnis.enabled = !!roh.enabled;
  const after = Number(roh.after);
  if (Number.isFinite(after) && after >= 0) ergebnis.after = after;
  if (Array.isArray(roh.sirens)) {
    ergebnis.sirens = roh.sirens.map((s) => String(s)).filter((s) => s.trim() !== '');
  }
  ergebnis.all_lights = !!roh.all_lights;
  ergebnis.announce = String(roh.announce ?? '');
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

/** Das Nötigste einer Entität für die Sirenen-Auswahl. */
export interface Schaltbar {
  id: string;
  name: string;
  kind: string;
  commands: string[];
  state?: { device_class?: string | null };
}

/**
 * Welche Geräte als Sirene in Frage kommen (rein, testbar).
 *
 * Einschaltbar muss es sein – und dann zuerst, was nach Sirene aussieht
 * (kind «alert»/«siren», device_class oder Name), danach die übrigen
 * Schalter. Lichter und Storen fehlen mit Absicht: Für «alle Lichter»
 * gibt es den eigenen Schalter, und eine Store heult nicht.
 */
export function sirenenKandidaten<T extends Schaltbar>(entities: T[]): T[] {
  const einschaltbar = entities.filter((entity) => entity.commands.includes('turn_on'));
  const istSirene = (entity: T) =>
    entity.kind === 'alert' ||
    entity.kind === 'siren' ||
    entity.state?.device_class === 'siren' ||
    /sirene|siren/i.test(entity.name);
  const sirenen = einschaltbar.filter(istSirene);
  const schalter = einschaltbar.filter(
    (entity) => !istSirene(entity) && entity.kind === 'switch'
  );
  return [...sirenen, ...schalter];
}

/**
 * Was im zugeklappten Kopf der Klappe steht (rein, testbar).
 *
 * «aus» oder «nach 30 s: Sirene, alle Lichter» – die häufigste Frage
 * («tut die Anlage nach der Frist etwas?») beantwortet der Kopf, ohne
 * dass jemand aufklappen muss.
 */
export function eskalationStand(eskalation: Eskalation): string {
  if (!eskalation.enabled) return 'aus';
  const teile: string[] = [];
  if (eskalation.sirens.length === 1) teile.push('Sirene');
  if (eskalation.sirens.length > 1) teile.push(`${eskalation.sirens.length} Sirenen`);
  if (eskalation.all_lights) teile.push('alle Lichter');
  if (eskalation.announce.trim() !== '') teile.push('Durchsage');
  // Eingeschaltet, aber ohne Wirkung: Der Hub stellt dann gar keinen
  // Timer – das soll der Kopf sagen, statt Sicherheit vorzutäuschen.
  if (teile.length === 0) return 'an, aber ohne Wirkung';
  return `nach ${fristLabel(eskalation.after)}: ${teile.join(', ')}`;
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
