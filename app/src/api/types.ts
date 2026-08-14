export interface Entity {
  id: string;
  kind: string;
  name: string;
  integration: string;
  state: Record<string, any>;
  commands: string[];
  available: boolean;
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
}
