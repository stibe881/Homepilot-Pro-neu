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

/** Eine Zustandsänderung für die Liste „Zuletzt passiert“. */
export interface Activity {
  id: string;
  name: string;
  summary: string;
  at: number;
}

export type ServerMessage =
  | { type: 'snapshot'; entities: Entity[] }
  | {
      type: 'state_changed';
      entity: Entity;
      entity_id: string;
      old_state: Record<string, any>;
      new_state: Record<string, any>;
    }
  | { type: 'entity_added'; entity: Entity }
  | { type: 'entity_removed'; entity_id: string }
  | { type: 'pong' }
  | { type: 'result'; ok: boolean; error?: string };

export interface HubSettings {
  url: string;
  token: string;
  /** Optionaler Name für die Begrüssung. */
  name?: string;
}
