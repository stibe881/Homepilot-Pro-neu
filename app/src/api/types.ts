export interface Entity {
  id: string;
  kind: string;
  name: string;
  integration: string;
  state: Record<string, any>;
  commands: string[];
  available: boolean;
  /** Raum aus der Hub-Konfiguration; die App gruppiert danach. */
  room?: string | null;
  /** In der App als Favorit markiert – erscheint auf der Startseite. */
  favorite?: boolean;
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
  actions?: { entity_id: string; command: string; data?: Record<string, any> }[];
  /** In der App angelegt – lässt sich dort auch ändern und löschen. */
  editable?: boolean;
  /** Optionaler Raum – dann erscheint die Szene in dessen Kategorie „Szenen“. */
  room?: string | null;
  /** Auf der Startseite als Schnellaktion anzeigen. */
  on_start?: boolean;
  /** Frei benannte Kategorie zum Gruppieren in der Liste. */
  category?: string | null;
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
      old_state: Record<string, any>;
      new_state: Record<string, any>;
      source?: Source;
    }
  | { type: 'entity_added'; entity: Entity }
  | { type: 'entity_removed'; entity_id: string }
  | { type: 'pong' }
  | { type: 'result'; ok: boolean; error?: string; entity_id?: string };

export interface HubSettings {
  url: string;
  token: string;
  /** Optionaler Name für die Begrüssung. */
  name?: string;
  /** Erscheinungsbild: system, auto (nach Uhrzeit), light oder dark. */
  theme?: 'system' | 'auto' | 'light' | 'dark';
  /** Entitäten, die auf der Startseite zuerst kommen. */
  favorites?: string[];
  /** Entitäten, die auf der Startseite nicht erscheinen. */
  hidden?: string[];
  /** Gesperrte Geräte: schalten nur nach ausdrücklicher Rückfrage. */
  locked?: string[];
  /** Selbst gewählte Reihenfolge der Geräte (Entitäts-IDs, per Ziehen). */
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
    health?: Record<string, any>;
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

export interface ConfigVersion {
  name: string;
  size: number;
  created: number;
}
