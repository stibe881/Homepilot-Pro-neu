import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Entity, HubSettings, Scene, User } from '../api/types';
import { Card } from '../components/Card';
import { Colors, radius, space, type, useColors } from '../theme';

interface Automation {
  id: string;
  alias: string;
  triggers: any[];
  conditions: any[];
  actions: any[];
  editable: boolean;
}

/** Was der Editor anbietet – bewusst wenig, aber vollständig bedienbar. */
type TriggerKind = 'state' | 'time';
type ActionKind = 'command' | 'scene' | 'notify';

interface Draft {
  id?: string;
  alias: string;
  triggerKind: TriggerKind;
  entityId: string;
  toState: string;
  /** Optional: nur wechseln von diesem Wert (z.B. running → idle). */
  fromState: string;
  /** Optional: anderes Zustandsfeld als 'state' (z.B. 'ring' beim Klingeln). */
  attribute: string;
  at: string;
  actionKind: ActionKind;
  actionEntityId: string;
  command: string;
  /** Raumauswahl, wenn das Kommando 'Räume saugen' ist. */
  rooms: number[];
  sceneId: string;
  title: string;
  body: string;
}

const EMPTY: Draft = {
  alias: '',
  triggerKind: 'state',
  entityId: '',
  toState: 'on',
  fromState: '',
  attribute: '',
  at: '18:30',
  actionKind: 'command',
  actionEntityId: '',
  command: 'turn_on',
  rooms: [],
  sceneId: '',
  title: '',
  body: '',
};

/** Sauger mit Raumsteuerung? Dann bietet der Editor 'Räume saugen' an. */
function vacuumRooms(entity: Entity | undefined): { id: number; name: string }[] {
  if (!entity || !entity.commands.includes('clean_rooms')) return [];
  return Array.isArray(entity.state.rooms) ? entity.state.rooms : [];
}

interface Template {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  draft: Draft;
}

/** Fertige Anfänge für die häufigsten Automationen – nur die, deren Geräte
 *  es in diesem Haushalt wirklich gibt. Der Editor öffnet sich vorbefüllt,
 *  anpassen und speichern bleibt beim Benutzer. */
function buildTemplates(entities: Entity[], scenes: Scene[]): Template[] {
  const templates: Template[] = [];
  const presence = entities.find((entity) => entity.id.endsWith('anyone_home'));
  const doorbell = entities.find(
    (entity) => entity.kind === 'camera' && 'last_ring' in entity.state
  );
  const appliance = entities.find((entity) => entity.kind === 'appliance');
  const alert = entities.find((entity) => entity.kind === 'alert');
  const vacuum = entities.find((entity) => entity.commands.includes('clean_rooms'));
  const offScene = scenes.find((scene) => scene.id === 'alles_aus');
  const firstOff = entities.find((entity) => entity.commands.includes('turn_off'));

  if (presence && (offScene || firstOff)) {
    templates.push({
      label: 'Alles aus, wenn niemand da',
      icon: 'exit-outline',
      draft: {
        ...EMPTY,
        alias: 'Alles aus, wenn niemand zuhause',
        entityId: presence.id,
        toState: 'off',
        ...(offScene
          ? { actionKind: 'scene' as ActionKind, sceneId: offScene.id }
          : { actionEntityId: firstOff!.id, command: 'turn_off' }),
      },
    });
  }
  if (doorbell) {
    templates.push({
      label: 'Push, wenn es klingelt',
      icon: 'notifications-outline',
      draft: {
        ...EMPTY,
        alias: 'Es klingelt',
        entityId: doorbell.id,
        attribute: 'ring',
        toState: 'on',
        actionKind: 'notify',
        title: 'Es klingelt',
        body: 'Jemand steht vor der Tür.',
      },
    });
  }
  if (appliance) {
    templates.push({
      label: 'Push, wenn das Gerät fertig ist',
      icon: 'checkmark-done-outline',
      draft: {
        ...EMPTY,
        alias: `${appliance.name} fertig`,
        entityId: appliance.id,
        fromState: 'running',
        toState: 'idle',
        actionKind: 'notify',
        title: `${appliance.name} ist fertig`,
        body: 'Das Programm ist durchgelaufen.',
      },
    });
  }
  if (alert) {
    templates.push({
      label: 'Unwetterwarnung als Push',
      icon: 'thunderstorm-outline',
      draft: {
        ...EMPTY,
        alias: 'Unwetterwarnung',
        entityId: alert.id,
        toState: 'alert',
        actionKind: 'notify',
        title: 'Unwetterwarnung',
        body: 'MeteoAlarm meldet eine Warnung für deine Region.',
      },
    });
  }
  if (vacuum) {
    templates.push({
      label: 'Morgens saugen',
      icon: 'sparkles-outline',
      draft: {
        ...EMPTY,
        alias: 'Morgens saugen',
        triggerKind: 'time',
        at: '09:00',
        actionEntityId: vacuum.id,
        command: 'clean_rooms',
      },
    });
  }
  return templates;
}

export function AutomationsScreen({
  settings,
  user,
  entities,
  scenes,
  onScenesChanged,
}: {
  settings: HubSettings;
  user: User | null;
  entities: Entity[];
  scenes: Scene[];
  onScenesChanged?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sceneDraft, setSceneDraft] = useState<SceneDraft | null>(null);
  const templates = useMemo(() => buildTemplates(entities, scenes), [entities, scenes]);

  const mayEdit = !!user?.capabilities?.includes('edit_automations');
  const headers: Record<string, string> = settings.token
    ? { Authorization: `Bearer ${settings.token}` }
    : {};

  const load = useCallback(() => {
    fetch(`${settings.url}/api/automations`, { headers })
      .then((response) => {
        if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
        return response.json();
      })
      .then((data) => setAutomations(data.automations ?? []))
      .catch((err) => setError(String(err.message ?? err)));
  }, [settings.url, settings.token]);

  useEffect(load, [load]);

  const save = async () => {
    if (!draft) return;
    const stateTrigger: Record<string, any> = {
      type: 'state',
      entity_id: draft.entityId,
      to: draft.toState,
    };
    if (draft.fromState) stateTrigger.from = draft.fromState;
    if (draft.attribute) stateTrigger.attribute = draft.attribute;
    const body = {
      alias: draft.alias || 'Ohne Namen',
      trigger: [
        draft.triggerKind === 'state' ? stateTrigger : { type: 'time', at: draft.at },
      ],
      condition: [],
      action: [buildAction(draft)],
    };
    const url = draft.id
      ? `${settings.url}/api/automations/${draft.id}`
      : `${settings.url}/api/automations`;
    try {
      const response = await fetch(url, {
        method: draft.id ? 'PUT' : 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
      setDraft(null);
      load();
    } catch (err: any) {
      setError(String(err.message ?? err));
    }
  };

  const remove = async (id: string) => {
    await fetch(`${settings.url}/api/automations/${id}`, {
      method: 'DELETE',
      headers,
    }).catch(() => {});
    setDraft(null);
    load();
  };

  const saveScene = async () => {
    if (!sceneDraft) return;
    const body = {
      name: sceneDraft.name || 'Ohne Namen',
      icon: sceneDraft.icon,
      room: sceneDraft.room || null,
      actions: sceneDraft.actions
        .filter((action) => action.entity_id)
        .map(({ entity_id, command, rooms }) =>
          command === 'clean_rooms'
            ? { entity_id, command, data: { rooms: rooms ?? [] } }
            : { entity_id, command }
        ),
    };
    const url = sceneDraft.id
      ? `${settings.url}/api/scenes/${sceneDraft.id}`
      : `${settings.url}/api/scenes`;
    try {
      const response = await fetch(url, {
        method: sceneDraft.id ? 'PUT' : 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
      setSceneDraft(null);
      onScenesChanged?.();
    } catch (err: any) {
      setError(String(err.message ?? err));
    }
  };

  const removeScene = async (id: string) => {
    await fetch(`${settings.url}/api/scenes/${id}`, {
      method: 'DELETE',
      headers,
    }).catch(() => {});
    setSceneDraft(null);
    onScenesChanged?.();
  };

  if (error) {
    return <Text style={styles.note}>Abläufe nicht abrufbar: {error}</Text>;
  }
  if (!automations) {
    return <Text style={styles.note}>Wird geladen …</Text>;
  }

  return (
    <View style={styles.list}>
      <Text style={[styles.sectionTitle, { marginTop: 0 }]}>Abläufe</Text>
      {mayEdit ? (
        <Pressable
          onPress={() => setDraft({ ...EMPTY, entityId: entities[0]?.id ?? '' })}
          accessibilityRole="button"
          style={({ pressed }) => [styles.newButton, pressed && { opacity: 0.75 }]}
        >
          <Ionicons name="add" size={20} color={colors.ink} />
          <Text style={styles.newText}>Neuer Ablauf</Text>
        </Pressable>
      ) : null}

      {mayEdit && templates.length > 0 ? (
        <View style={styles.templates}>
          <Text style={styles.templatesLabel}>Vorlagen</Text>
          <View style={styles.choices}>
            {templates.map((template) => (
              <Pressable
                key={template.label}
                onPress={() => setDraft({ ...template.draft })}
                accessibilityRole="button"
                style={({ pressed }) => [styles.template, pressed && { opacity: 0.75 }]}
              >
                <Ionicons name={template.icon} size={14} color={colors.inkSoft} />
                <Text style={styles.templateText}>{template.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {automations.length === 0 ? (
        <Text style={styles.note}>
          Noch keine Abläufe. Sie entstehen hier oder im Abschnitt „automations“
          der config.yaml des Hubs.
        </Text>
      ) : null}

      {automations.map((automation) => (
        <Card key={automation.id} style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{automation.alias}</Text>
              <Text style={styles.detail}>{describe(automation)}</Text>
            </View>
            {automation.editable && mayEdit ? (
              <Pressable
                onPress={() => setDraft(toDraft(automation))}
                accessibilityLabel={`${automation.alias} bearbeiten`}
                style={styles.iconButton}
              >
                <Ionicons name="create-outline" size={20} color={colors.inkSoft} />
              </Pressable>
            ) : (
              <Text style={styles.badge}>aus config.yaml</Text>
            )}
          </View>
        </Card>
      ))}

      <Text style={styles.sectionTitle}>Szenen</Text>
      {mayEdit ? (
        <Pressable
          onPress={() =>
            setSceneDraft({
              name: '',
              icon: SCENE_ICONS[0],
              actions: [{ entity_id: switchableFirst(entities), command: 'turn_on' }],
            })
          }
          accessibilityRole="button"
          style={({ pressed }) => [styles.newButton, pressed && { opacity: 0.75 }]}
        >
          <Ionicons name="add" size={20} color={colors.ink} />
          <Text style={styles.newText}>Neue Szene</Text>
        </Pressable>
      ) : null}

      {scenes.length === 0 ? (
        <Text style={styles.note}>
          Noch keine Szenen. Eine Szene schaltet mehrere Geräte mit einem Tippen.
        </Text>
      ) : null}

      {scenes.map((scene) => (
        <Card key={scene.id} style={styles.card}>
          <View style={styles.cardHead}>
            <Ionicons name={scene.icon as any} size={20} color={colors.inkSoft} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{scene.name}</Text>
              <Text style={styles.detail}>
                {(scene.actions?.length ?? scene.entity_ids.length)} Aktion(en)
              </Text>
            </View>
            {scene.editable && mayEdit ? (
              <Pressable
                onPress={() =>
                  setSceneDraft({
                    id: scene.id,
                    name: scene.name,
                    icon: scene.icon,
                    room: scene.room ?? undefined,
                    actions: (scene.actions ?? []).map((action) => ({
                      entity_id: action.entity_id,
                      command: action.command,
                      rooms: action.data?.rooms,
                    })),
                  })
                }
                accessibilityLabel={`${scene.name} bearbeiten`}
                style={styles.iconButton}
              >
                <Ionicons name="create-outline" size={20} color={colors.inkSoft} />
              </Pressable>
            ) : (
              <Text style={styles.badge}>aus config.yaml</Text>
            )}
          </View>
        </Card>
      ))}

      <Editor
        draft={draft}
        entities={entities}
        scenes={scenes}
        onChange={setDraft}
        onSave={save}
        onDelete={draft?.id ? () => remove(draft.id!) : undefined}
        onCancel={() => setDraft(null)}
      />
      <SceneEditor
        draft={sceneDraft}
        entities={entities}
        onChange={setSceneDraft}
        onSave={saveScene}
        onDelete={sceneDraft?.id ? () => removeScene(sceneDraft.id!) : undefined}
        onCancel={() => setSceneDraft(null)}
      />
    </View>
  );
}

/** Für die erste Aktion einer neuen Szene: das erste schaltbare Gerät. */
function switchableFirst(entities: Entity[]): string {
  return entities.find((entity) => entity.commands.includes('turn_on'))?.id ?? '';
}

interface SceneDraft {
  id?: string;
  name: string;
  icon: string;
  /** Optionaler Raum – dann erscheint die Szene in dessen Kategorie „Szenen“. */
  room?: string;
  actions: { entity_id: string; command: string; rooms?: number[] }[];
}

/** Eine Handvoll passender Symbole reicht – die App bleibt aufgeräumt. */
const SCENE_ICONS = [
  'sparkles-outline',
  'sunny-outline',
  'moon-outline',
  'film-outline',
  'wine-outline',
  'home-outline',
];

function SceneEditor({
  draft,
  entities,
  onChange,
  onSave,
  onDelete,
  onCancel,
}: {
  draft: SceneDraft | null;
  entities: Entity[];
  onChange: (draft: SceneDraft) => void;
  onSave: () => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!draft) return null;

  const set = (patch: Partial<SceneDraft>) => onChange({ ...draft, ...patch });
  const setAction = (index: number, patch: Partial<SceneDraft['actions'][number]>) =>
    set({
      actions: draft.actions.map((action, i) =>
        i === index ? { ...action, ...patch } : action
      ),
    });
  const switchable = entities.filter(
    (entity) =>
      entity.commands.includes('turn_on') || entity.commands.includes('clean_rooms')
  );
  // Räume aus den Geräten – für die Zuordnung der Szene zu einer Kategorie.
  const sceneRooms = Array.from(
    new Set(entities.map((entity) => entity.room).filter(Boolean) as string[])
  ).sort((a, b) => a.localeCompare(b));

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <ScrollView style={styles.editor} contentContainerStyle={styles.editorContent}>
        <View style={styles.cardHead}>
          <Text style={styles.editorTitle}>
            {draft.id ? 'Szene bearbeiten' : 'Neue Szene'}
          </Text>
          <Pressable onPress={onCancel} accessibilityLabel="Abbrechen">
            <Ionicons name="close" size={26} color={colors.ink} />
          </Pressable>
        </View>

        <Field label="Name">
          <TextInput
            style={styles.input}
            value={draft.name}
            onChangeText={(name) => set({ name })}
            placeholder="z.B. Feierabend"
            placeholderTextColor={colors.inkFaint}
          />
        </Field>

        <Field label="Symbol">
          <View style={styles.choices}>
            {SCENE_ICONS.map((icon) => (
              <Pressable
                key={icon}
                onPress={() => set({ icon })}
                accessibilityRole="radio"
                accessibilityState={{ selected: draft.icon === icon }}
                style={[styles.choice, draft.icon === icon && styles.choiceActive]}
              >
                <Ionicons
                  name={icon as any}
                  size={18}
                  color={draft.icon === icon ? colors.surfaceStrong : colors.inkSoft}
                />
              </Pressable>
            ))}
          </View>
        </Field>

        {sceneRooms.length > 0 ? (
          <Field label="Raum (für die Kategorie „Szenen“)">
            <Choice
              options={[
                { key: '', label: 'Kein Raum' },
                ...sceneRooms.map((name) => ({ key: name, label: name })),
              ]}
              value={draft.room ?? ''}
              onSelect={(room) => set({ room: room || undefined })}
            />
          </Field>
        ) : null}

        <Field label="Schaltet">
          {draft.actions.map((action, index) => {
            const actionEntity = entities.find((entity) => entity.id === action.entity_id);
            const rooms = vacuumRooms(actionEntity);
            const isVacuum = actionEntity?.kind === 'vacuum';
            return (
            <View key={index} style={styles.sceneAction}>
              <View style={{ flex: 1, gap: 8 }}>
                <Picker
                  items={switchable.map((entity) => ({
                    key: entity.id,
                    label: entity.name,
                  }))}
                  value={action.entity_id}
                  onSelect={(entity_id) => {
                    const next = entities.find((entity) => entity.id === entity_id);
                    setAction(index, {
                      entity_id,
                      command: next?.kind === 'vacuum' ? 'start' : 'turn_on',
                      rooms: [],
                    });
                  }}
                />
                <Choice
                  options={
                    isVacuum
                      ? [
                          { key: 'start', label: 'Reinigung starten' },
                          { key: 'dock', label: 'zur Station' },
                          ...(rooms.length > 0
                            ? [{ key: 'clean_rooms', label: 'Räume saugen' }]
                            : []),
                        ]
                      : [
                          { key: 'turn_on', label: 'einschalten' },
                          { key: 'turn_off', label: 'ausschalten' },
                        ]
                  }
                  value={action.command}
                  onSelect={(command) => setAction(index, { command })}
                />
                {action.command === 'clean_rooms' && rooms.length > 0 ? (
                  <Choice
                    multi
                    options={rooms.map((room) => ({
                      key: String(room.id),
                      label: room.name,
                    }))}
                    values={(action.rooms ?? []).map(String)}
                    onSelect={(key) => {
                      const id = Number(key);
                      const current = action.rooms ?? [];
                      setAction(index, {
                        rooms: current.includes(id)
                          ? current.filter((entry) => entry !== id)
                          : [...current, id],
                      });
                    }}
                  />
                ) : null}
              </View>
              {draft.actions.length > 1 ? (
                <Pressable
                  onPress={() =>
                    set({ actions: draft.actions.filter((_, i) => i !== index) })
                  }
                  accessibilityLabel="Aktion entfernen"
                  style={styles.iconButton}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              ) : null}
            </View>
            );
          })}
          <Pressable
            onPress={() =>
              set({
                actions: [
                  ...draft.actions,
                  { entity_id: switchableFirst(entities), command: 'turn_on' },
                ],
              })
            }
            accessibilityRole="button"
            style={({ pressed }) => [styles.newButton, pressed && { opacity: 0.75 }]}
          >
            <Ionicons name="add" size={18} color={colors.ink} />
            <Text style={styles.newText}>Weiteres Gerät</Text>
          </Pressable>
        </Field>

        <Pressable style={styles.save} onPress={onSave} accessibilityRole="button">
          <Text style={styles.saveText}>Speichern</Text>
        </Pressable>
        {onDelete ? (
          <Pressable style={styles.delete} onPress={onDelete} accessibilityRole="button">
            <Text style={styles.deleteText}>Szene löschen</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Modal>
  );
}

function Editor({
  draft,
  entities,
  scenes,
  onChange,
  onSave,
  onDelete,
  onCancel,
}: {
  draft: Draft | null;
  entities: Entity[];
  scenes: Scene[];
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!draft) return null;

  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const switchable = entities.filter((entity) => entity.commands.length > 0);
  const actionEntity = entities.find((entity) => entity.id === draft.actionEntityId);
  const actionRooms = vacuumRooms(actionEntity);
  const isVacuum = actionEntity?.kind === 'vacuum';

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <ScrollView style={styles.editor} contentContainerStyle={styles.editorContent}>
        <View style={styles.cardHead}>
          <Text style={styles.editorTitle}>
            {draft.id ? 'Ablauf bearbeiten' : 'Neuer Ablauf'}
          </Text>
          <Pressable onPress={onCancel} accessibilityLabel="Abbrechen">
            <Ionicons name="close" size={26} color={colors.ink} />
          </Pressable>
        </View>

        <Field label="Name">
          <TextInput
            style={styles.input}
            value={draft.alias}
            onChangeText={(alias) => set({ alias })}
            placeholder="z.B. Licht bei Bewegung"
            placeholderTextColor={colors.inkFaint}
          />
        </Field>

        <Field label="Wenn">
          <Choice
            options={[
              { key: 'state', label: 'Gerät wechselt' },
              { key: 'time', label: 'Uhrzeit' },
            ]}
            value={draft.triggerKind}
            onSelect={(triggerKind) => set({ triggerKind: triggerKind as TriggerKind })}
          />
          {draft.triggerKind === 'state' ? (
            <>
              <Picker
                items={entities.map((entity) => ({ key: entity.id, label: entity.name }))}
                value={draft.entityId}
                onSelect={(entityId) => set({ entityId })}
              />
              <Choice
                options={[
                  { key: 'on', label: 'auf An' },
                  { key: 'off', label: 'auf Aus' },
                ]}
                value={draft.toState}
                onSelect={(toState) => set({ toState, attribute: '', fromState: '' })}
              />
              {draft.attribute || draft.fromState || !['on', 'off'].includes(draft.toState) ? (
                <Text style={styles.triggerNote}>
                  Löst aus, wenn {draft.attribute || 'der Zustand'}
                  {draft.fromState ? ` von «${draft.fromState}»` : ''} auf «{draft.toState}»
                  wechselt.
                </Text>
              ) : null}
            </>
          ) : (
            <TextInput
              style={styles.input}
              value={draft.at}
              onChangeText={(at) => set({ at })}
              placeholder="18:30"
              placeholderTextColor={colors.inkFaint}
            />
          )}
        </Field>

        <Field label="Dann">
          <Choice
            options={[
              { key: 'command', label: 'Gerät schalten' },
              { key: 'scene', label: 'Szene' },
              { key: 'notify', label: 'Nachricht' },
            ]}
            value={draft.actionKind}
            onSelect={(actionKind) => set({ actionKind: actionKind as ActionKind })}
          />
          {draft.actionKind === 'command' ? (
            <>
              <Picker
                items={switchable.map((entity) => ({
                  key: entity.id,
                  label: entity.name,
                }))}
                value={draft.actionEntityId}
                onSelect={(actionEntityId) => {
                  const next = entities.find((entity) => entity.id === actionEntityId);
                  set({
                    actionEntityId,
                    command: next?.kind === 'vacuum' ? 'start' : 'turn_on',
                    rooms: [],
                  });
                }}
              />
              <Choice
                options={
                  isVacuum
                    ? [
                        { key: 'start', label: 'Reinigung starten' },
                        { key: 'dock', label: 'zur Station' },
                        ...(actionRooms.length > 0
                          ? [{ key: 'clean_rooms', label: 'Räume saugen' }]
                          : []),
                      ]
                    : [
                        { key: 'turn_on', label: 'einschalten' },
                        { key: 'turn_off', label: 'ausschalten' },
                        { key: 'toggle', label: 'umschalten' },
                      ]
                }
                value={draft.command}
                onSelect={(command) => set({ command })}
              />
              {draft.command === 'clean_rooms' && actionRooms.length > 0 ? (
                <Choice
                  multi
                  options={actionRooms.map((room) => ({
                    key: String(room.id),
                    label: room.name,
                  }))}
                  values={draft.rooms.map(String)}
                  onSelect={(key) => {
                    const id = Number(key);
                    set({
                      rooms: draft.rooms.includes(id)
                        ? draft.rooms.filter((entry) => entry !== id)
                        : [...draft.rooms, id],
                    });
                  }}
                />
              ) : null}
            </>
          ) : draft.actionKind === 'scene' ? (
            <Picker
              items={scenes.map((scene) => ({ key: scene.id, label: scene.name }))}
              value={draft.sceneId}
              onSelect={(sceneId) => set({ sceneId })}
            />
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={draft.title}
                onChangeText={(title) => set({ title })}
                placeholder="Titel"
                placeholderTextColor={colors.inkFaint}
              />
              <TextInput
                style={styles.input}
                value={draft.body}
                onChangeText={(body) => set({ body })}
                placeholder="Text"
                placeholderTextColor={colors.inkFaint}
              />
            </>
          )}
        </Field>

        <Pressable style={styles.save} onPress={onSave} accessibilityRole="button">
          <Text style={styles.saveText}>Speichern</Text>
        </Pressable>
        {onDelete ? (
          <Pressable style={styles.delete} onPress={onDelete} accessibilityRole="button">
            <Text style={styles.deleteText}>Ablauf löschen</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Choice({
  options,
  value,
  values,
  multi,
  onSelect,
}: {
  options: { key: string; label: string }[];
  value?: string;
  /** Bei multi: alle ausgewählten Schlüssel. */
  values?: string[];
  multi?: boolean;
  onSelect: (key: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isActive = (key: string) => (multi ? !!values?.includes(key) : value === key);
  return (
    <View style={styles.choices}>
      {options.map((option) => (
        <Pressable
          key={option.key}
          onPress={() => onSelect(option.key)}
          accessibilityRole={multi ? 'checkbox' : 'radio'}
          accessibilityState={
            multi ? { checked: isActive(option.key) } : { selected: isActive(option.key) }
          }
          style={[styles.choice, isActive(option.key) && styles.choiceActive]}
        >
          <Text
            style={[styles.choiceText, isActive(option.key) && styles.choiceTextActive]}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Auswahlliste als Knopfreihe – ein echtes Auswahlmenü gibt es in React
    Native nicht plattformübergreifend, und bei einer Handvoll Geräten ist
    das ohnehin schneller. */
function Picker({
  items,
  value,
  onSelect,
}: {
  items: { key: string; label: string }[];
  value: string;
  onSelect: (key: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker}>
      <View style={styles.choices}>
        {items.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === item.key }}
            style={[styles.choice, value === item.key && styles.choiceActive]}
          >
            <Text
              style={[styles.choiceText, value === item.key && styles.choiceTextActive]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

function buildAction(draft: Draft): Record<string, any> {
  if (draft.actionKind === 'scene') {
    return { type: 'scene', scene: draft.sceneId };
  }
  if (draft.actionKind === 'notify') {
    return { type: 'notify', to: 'all', title: draft.title, body: draft.body };
  }
  const action: Record<string, any> = {
    type: 'command',
    entity_id: draft.actionEntityId,
    command: draft.command,
  };
  if (draft.command === 'clean_rooms') {
    action.data = { rooms: draft.rooms };
  }
  return action;
}

function toDraft(automation: Automation): Draft {
  const trigger = automation.triggers[0] ?? {};
  const action = automation.actions[0] ?? {};
  return {
    ...EMPTY,
    id: automation.id,
    alias: automation.alias,
    triggerKind: trigger.type === 'time' ? 'time' : 'state',
    entityId: trigger.entity_id ?? '',
    toState: trigger.to ?? 'on',
    fromState: trigger.from ?? '',
    attribute: trigger.attribute ?? '',
    at: trigger.at ?? EMPTY.at,
    actionKind: (action.type as ActionKind) ?? 'command',
    actionEntityId: action.entity_id ?? '',
    command: action.command ?? 'turn_on',
    rooms: action.data?.rooms ?? [],
    sceneId: action.scene ?? '',
    title: action.title ?? '',
    body: action.body ?? '',
  };
}

function describe(automation: Automation): string {
  const trigger = automation.triggers[0];
  const action = automation.actions[0];
  const wenn = !trigger
    ? 'ohne Auslöser'
    : trigger.type === 'time'
      ? `täglich um ${trigger.at}`
      : trigger.type === 'interval'
        ? `alle ${trigger.seconds} s`
        : `wenn ${trigger.entity_id}${
            trigger.attribute ? `.${trigger.attribute}` : ''
          } → ${trigger.to ?? 'sich ändert'}`;
  const dann = !action
    ? 'ohne Aktion'
    : action.type === 'scene'
      ? `Szene ${action.scene}`
      : action.type === 'notify'
        ? 'Nachricht senden'
        : action.command === 'clean_rooms'
          ? `${action.entity_id}: ${action.data?.rooms?.length ?? 0} Räume saugen`
          : `${action.entity_id} ${action.command}`;
  return `${wenn} → ${dann}`;
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    list: { gap: space.gap, marginTop: 4 },
    sectionTitle: {
      color: colors.onGradient,
      fontSize: 18,
      fontWeight: '700',
      marginTop: 14,
    },
    sceneAction: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
    },
    templates: { gap: 8 },
    templatesLabel: {
      color: colors.onGradientSoft,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    template: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    templateText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    triggerNote: { color: colors.inkSoft, fontSize: 13, lineHeight: 18 },
    card: { minHeight: 0, gap: 6 },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    title: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    detail: { color: colors.inkSoft, fontSize: type.cardSub, marginTop: 2 },
    badge: { color: colors.inkFaint, fontSize: 11 },
    iconButton: { padding: 6 },
    newButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 13,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    newText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    note: {
      color: colors.onGradientSoft,
      fontSize: 14,
      lineHeight: 21,
      marginTop: 20,
      maxWidth: 460,
    },
    editor: { flex: 1, backgroundColor: colors.panel },
    editorContent: { padding: 22, paddingTop: 60, gap: 18, maxWidth: 620, width: '100%' },
    editorTitle: { color: colors.ink, fontSize: 22, fontWeight: '700', flex: 1 },
    field: { gap: 8 },
    label: { color: colors.inkSoft, fontSize: type.cardSub, fontWeight: '700' },
    input: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
    },
    picker: { flexGrow: 0 },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    choice: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    choiceActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    choiceText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    choiceTextActive: { color: '#FFFFFF' },
    save: {
      backgroundColor: colors.accent,
      borderRadius: radius.control,
      paddingVertical: 15,
      alignItems: 'center',
    },
    saveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
    delete: { alignItems: 'center', paddingVertical: 12 },
    deleteText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  });
