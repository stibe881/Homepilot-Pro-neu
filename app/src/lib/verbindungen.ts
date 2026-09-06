/**
 * Die Dienst-Verbindungen der Verbindungen-Seite (rein, testbar).
 *
 * Der Hub sagt unter /api/verbindungen, wie es um Kalender, Spotify und
 * Google Home steht; hier entsteht daraus, was auf dem Bildschirm steht:
 * welcher Kalender wie heisst, ob eine Eingabe abgeschickt werden darf,
 * welches Symbol zur Karte gehört. Kein Netz, keine Seiteneffekte - die
 * Aufrufe selbst macht der Bildschirm.
 */

export interface DienstStatus {
  text: string;
  ton: 'gut' | 'warnung' | 'aus' | 'neutral';
}

export interface CastGeraet {
  name: string;
  host: string;
  port: number;
  /** null: Der Hub kennt (noch) keine Entität dazu. */
  erreichbar: boolean | null;
}

export interface Dienst {
  key: string;
  label: string;
  kurz: string;
  eingerichtet: boolean;
  enabled: boolean;
  status: DienstStatus;
  fehler?: string | null;
  werte: {
    calendar_ids?: string[];
    remind_minutes?: number;
    geraete?: CastGeraet[];
  };
  zugang?: boolean | null;
  angemeldet?: boolean | null;
  /** Der Anmelde-Befehl fürs Terminal - nur da, wenn die Anmeldung fehlt. */
  anmeldung?: string | null;
}

/** Das Symbol zur Karte - eines je Dienst, an einem Ort. */
export function dienstSymbol(key: string): string {
  if (key === 'kalender') return 'calendar-outline';
  if (key === 'spotify') return 'musical-notes-outline';
  if (key === 'googlehome') return 'home-outline';
  return 'link-outline';
}

/**
 * Bei wem man sich da anmeldet.
 *
 * Der Dienst heisst auf der Karte «Kalender», aber angemeldet wird man
 * bei Google - der Knopf muss den Namen tragen, der gleich im Browser
 * auftaucht, sonst stutzt man genau im falschen Moment.
 */
export function anbieterName(key: string): string {
  if (key === 'kalender') return 'Google';
  if (key === 'spotify') return 'Spotify';
  return '';
}

/**
 * Eine Kalender-Adresse lesbar machen.
 *
 * «primary» ist Googles Wort für den Hauptkalender des Kontos, und die
 * Geburtstags-Adresse (aus den Kontakten) liest kein Mensch freiwillig -
 * beides bekommt seinen Namen. Eine Mail-Adresse bleibt, was sie ist:
 * Genau sie ist die Antwort auf «welches Konto hängt da dran».
 */
export function kalenderName(id: string): string {
  const kern = id.trim();
  if (kern === 'primary') return 'Hauptkalender';
  if (kern.includes('#contacts') || kern.toLowerCase().includes('birthday')) {
    return 'Geburtstage (Google-Kontakte)';
  }
  return kern;
}

// Dieselben Regeln wie im Hub (core/verbindungen.py) - die App prüft
// vor dem Abschicken, damit der Fehler neben dem Feld steht und nicht
// als 400 aus dem Netz kommt.
const KALENDER_ID = /^[A-Za-z0-9._#@+-]+$/;

export function gueltigeKalenderId(text: string): boolean {
  return KALENDER_ID.test(text.trim());
}

const HOST = /^[A-Za-z0-9.-]+$/;

export function gueltigerHost(text: string): boolean {
  const kern = text.trim();
  return kern.length > 0 && HOST.test(kern);
}

/** Die Auswahl für den Erinnerungs-Vorlauf - 0 heisst: keine Nachricht. */
export const ERINNERUNGS_MINUTEN = [0, 5, 15, 30] as const;

export function erinnerungsWort(minuten: number): string {
  return minuten > 0 ? `${minuten} Min` : 'Aus';
}

/**
 * Was unter einem Cast-Gerät steht.
 *
 * Der Port erscheint nur, wenn er vom üblichen abweicht - das ist das
 * Merkmal einer Lautsprechergruppe, und genau dann trägt er Information.
 */
export function geraetZeile(geraet: CastGeraet): string {
  return geraet.port !== 8009 ? `${geraet.host} · Gruppe` : geraet.host;
}
