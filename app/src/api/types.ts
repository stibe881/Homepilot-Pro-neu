/**
 * Der Zustand einer Entität, wie der Hub ihn schickt (Punkt 60 der
 * Werkbank). Die häufigen Felder sind benannt und getippt – wer
 * `state.brightness` liest, bekommt eine Zahl, nicht `any`. Der offene
 * Index darunter bleibt mit Absicht: Jede Integration darf zusätzliche
 * Felder mitschicken, und die App soll sie anzeigen können, ohne dass
 * hier jedes Hub-Schema dupliziert wird.
 */
export interface EntityState {
  /** Der Hauptzustand: 'on'/'off', ein Messwert, 'cleaning', 'locked' … */
  state?: string | number | boolean | null;
  unit?: string;
  brightness?: number;
  position?: number;
  color?: string;
  color_temp?: number;
  battery?: number;
  power?: number;
  energy_today?: number;
  temperature?: number;
  volume?: number;
  muted?: boolean;
  device_class?: string;
  error?: string | null;
  // Alles Weitere je nach Integration (rooms, playlists, events, robot …).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** Die Zusatzdaten eines Befehls (brightness, position, rooms …) - dieselbe
 *  offene Form wie der Zustand, aus demselben Grund. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CommandData = Record<string, any>;

/** Ein Kalender-Termin, wie ihn die Google-Kalender-Integration in den
 *  Zustand legt (summary, start, end, all_day, birthday …). Offen aus
 *  demselben Grund wie EntityState. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type KalenderEintrag = Record<string, any>;

export interface Entity {
  id: string;
  kind: string;
  name: string;
  integration: string;
  state: EntityState;
  commands: string[];
  available: boolean;
  /** Raum aus der Hub-Konfiguration; die App gruppiert danach. */
  room?: string | null;
  /** In der App als Favorit markiert – erscheint auf der Startseite. */
  favorite?: boolean;
  /** Kennung der Leuchte, in der dieses Licht aufgeht.
   *
   *  Eine Deckenlampe mit fünf Spots ist ein Licht, nicht fünf: Wer das
   *  gesetzt hat, verschwindet aus Räumen, Suche und Zählung und ist nur
   *  noch unter Geräte zu finden. */
  combined_into?: string | null;
  /** Frei wählbare Gruppe (z.B. «Storen Süd») zum gemeinsamen Schalten. */
  group?: string | null;
  /** Epoch-Sekunden, wann das Gerät zuletzt erreichbar war. */
  last_seen?: number | null;
}

export interface Scene {
  id: string;
  name: string;
  icon: string;
  entity_ids: string[];
  actions?: { entity_id: string; command: string; data?: CommandData }[];
  /** In der App angelegt – lässt sich dort auch ändern und löschen. */
  editable?: boolean;
  /** Optionaler Raum – dann erscheint die Szene in dessen Kategorie „Szenen“. */
  room?: string | null;
  /** Auf der Startseite als Schnellaktion anzeigen. */
  on_start?: boolean;
  /** Frei benannte Kategorie zum Gruppieren in der Liste. */
  category?: string | null;
  /** Übergangszeit in Sekunden – Helligkeiten werden angefahren. */
  transition?: number;
  /** Steht der Raum gerade so, wie die Szene ihn hinterlässt? Der Hub
   *  misst das am tatsächlichen Zustand, nicht daran, dass jemand
   *  einmal gedrückt hat. */
  active?: boolean;
  /** Ist ein Rückweg gespeichert? Nur dann nimmt der zweite Druck
   *  zurück, statt erneut auszulösen. */
  revertable?: boolean;
  /** Bleibt die Szene aktiv? Aus für Handlungen wie «Alles aus», die
   *  keinen Zustand herstellen. Fehlt das Feld, gilt «ja». */
  toggles?: boolean;
}

export interface User {
  name: string;
  role: 'besitzer' | 'bewohner' | 'gast';
  allow: string[];
  capabilities?: string[];
  /** Deaktivierte Benutzer kommen nicht rein, behalten aber ihr Token. */
  enabled?: boolean;
  /** Freigegebene Bereiche für Gäste (licht, storen, familie, …). */
  features?: string[];
  /** Anmelde-Adresse. Nur wessen Adresse hier
   *  steht, kann eingeladen werden und sich dann mit Passwort anmelden. */
  email?: string | null;
  /** Kinder-Ansicht: nur diese Räume, als grosse Knöpfe. */
  simple_rooms?: string[];
  /** Gemeinschaftsgerät statt Person: das Wandtablet im Flur. Nachrichten
   *  bekommt es wie jeder andere - dort im Flur sind sie am richtigen
   *  Ort -, aber es wird nicht mit Namen begrüsst, meldet sich nie ab,
   *  braucht die Alarm-PIN und dunkelt nachts ab. */
  shared?: boolean;
  /** Vor den persönlichen Bereichen liegt ein Passwort, das die
   *  Verwaltung gesetzt hat. Nur die Tatsache, nie der Wert. */
  area_locked?: boolean;
}

export interface Source {
  kind: 'user' | 'automation' | 'scene' | 'device';
  label: string;
  id?: string;
}

export type ServerMessage =
  | { type: 'snapshot'; entities: Entity[]; user?: User; rooms?: string[] }
  | {
      type: 'state_changed';
      entity: Entity;
      entity_id: string;
      old_state: EntityState;
      new_state: EntityState;
      source?: Source;
    }
  | { type: 'entity_added'; entity: Entity }
  | { type: 'entity_removed'; entity_id: string }
  /** Nur der Fingerzeig «Liste X hat sich geändert» – die Daten holt die
   *  App über REST, derselbe Weg wie bisher. */
  | { type: 'family_changed'; collection: string }
  | { type: 'pong' }
  | { type: 'result'; ok: boolean; error?: string; entity_id?: string };

export interface HubSettings {
  url: string;
  token: string;
  /** Optionaler Name für die Begrüssung. */
  name?: string;
  /** Erscheinungsbild: system, auto (nach Uhrzeit), light oder dark. */
  theme?: 'system' | 'auto' | 'light' | 'dark' | 'pink';
  // Die vier folgenden Felder sind Altlast, kein Speicherort mehr.
  //
  // Sie lagen hier – also im Speicher genau dieses Telefons – und waren
  // nach einer Neuinstallation weg. Der Stern steht jetzt beim Gerät auf
  // dem Hub (`Entity.favorite`), der Rest in den haushaltsweiten
  // Einstellungen (`/api/houseprefs`, siehe hooks/usePrefs.ts). Was hier
  // noch steht, wird einmalig übernommen (lib/favoriten.ts,
  // lib/hausprefs.ts) und danach nicht mehr gelesen.

  /** Veraltet – siehe oben. Nur noch für die Übernahme. */
  favorites?: string[];
  /** Veraltet – siehe oben. Nur noch für die Übernahme. */
  hidden?: string[];
  /** Veraltet – siehe oben. Nur noch für die Übernahme. */
  locked?: string[];
  /** Veraltet – siehe oben. Nur noch für die Übernahme. */
  order?: string[];
  /** Wandpanel: Bildschirm bleibt an, kehrt von selbst zur Startseite zurück. */
  panel?: boolean;
}

/** Eine Zustandsänderung für die Liste „Zuletzt passiert“. */
export interface Activity {
  id: string;
  name: string;
  summary: string;
  /** Wer es ausgelöst hat – beantwortet „warum ist das passiert?“. */
  source?: string | null;
  sourceKind?: string | null;
  at: number;
}

export interface SystemStatus {
  uptime_seconds: number;
  database: string | null;
  entities: number;
  unavailable: number;
  integrations: {
    name: string;
    ok: boolean;
    error: string | null;
    entities: number;
    unavailable: number;
    /** Was die Integration selbst über ihren Zustand weiss (optional). */
    health?: Record<string, unknown>;
  }[];
  automations: { count: number; paused_until: string | null };
  push_devices: number;
  /** Welcher Stand läuft – nach einem Update die einzige Art, das zu sehen. */
  build?: { version: string; commit: string; built_at: string };
  energy: { price_per_kwh?: number; currency?: string };
  /** Ausfall-Protokoll des Wächters (jüngste zuerst). */
  outages?: { integration: string; since: number; ended: number | null }[];
  /** Gerade ausgefallene Integrationen. */
  down?: string[];
  /** Belegung des Datenträgers – läuft er voll, scheitert jedes Speichern. */
  disk?: { percent: number; free_gb: number; total_gb: number } | null;
}

export interface LogEntry {
  at: number;
  level: string;
  logger: string;
  message: string;
}

export interface AuditEntry {
  at: number;
  user: string;
  entity_id: string;
  entity: string;
  command: string;
  address?: string;
}

export interface OneTimePass {
  token: string;
  /** Alle Türen dieses Links, in Auslösereihenfolge. */
  targets?: { entity_id: string; command: string }[];
  /** Die erste Türe – für Anzeigen, wo eine genügt. */
  entity_id: string;
  command: string;
  expires: number;
  /** Ab wann er gilt (Unix-Sekunden) – null heisst sofort. */
  starts?: number | null;
  /** Ausgestellt, aber noch nicht gültig. */
  pending?: boolean;
  seconds_left: number;
  used_at: number | null;
  created_by: string;
  label: string;
  url?: string;
}

export interface ConfigVersion {
  name: string;
  size: number;
  created: number;
}
