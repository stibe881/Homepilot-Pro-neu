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
}

export interface Scene {
  id: string;
  name: string;
  icon: string;
  entity_ids: string[];
}

export interface User {
  name: string;
  role: 'besitzer' | 'bewohner' | 'gast';
  allow: string[];
  capabilities?: string[];
}

export interface Source {
  kind: 'user' | 'automation' | 'scene' | 'device';
  label: string;
  id?: string;
}

export type ServerMessage =
  | { type: 'snapshot'; entities: Entity[]; user?: User }
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
  }[];
  automations: { count: number; paused_until: string | null };
  push_devices: number;
  energy: { price_per_kwh?: number; currency?: string };
}
