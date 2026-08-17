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
  /** Frei benannte Kategorie zum Gruppieren (vom Hub, kann fehlen). */
  category?: string | null;
  /** Verknüpfung der Bedingungen: 'all' oder 'any'. */
  match?: string;
}

/** Welche Zustände bei diesem Gerät als Auslöser oder Bedingung taugen
 *  (rein, testbar).
 *
 * Ein Wandtaster kennt kein «an»/«aus» – er meldet einen Druck. Nach an/aus
 * gefragt käme ein Auslöser heraus, der nie eintritt. Dasselbe gilt für
 * Storen, Schlösser und die Alarmanlage: Jede Art hat ihre eigenen Worte. */
export function stateOptions(entity?: Entity): { key: string; label: string }[] {
  switch (entity?.kind) {
    case 'button':
      return [
        { key: 'short', label: 'kurz gedrückt' },
        { key: 'long', label: 'lang gedrückt' },
      ];
    case 'cover':
      return [
        { key: 'open', label: 'offen' },
        { key: 'closed', label: 'geschlossen' },
      ];
    case 'lock':
      return [
        { key: 'unlocked', label: 'aufgeschlossen' },
        { key: 'locked', label: 'abgeschlossen' },
      ];
    case 'media_player':
      return [
        { key: 'playing', label: 'spielt' },
        { key: 'paused', label: 'pausiert' },
        { key: 'idle', label: 'still' },
      ];
    case 'appliance':
      return [
        { key: 'running', label: 'läuft' },
        { key: 'idle', label: 'fertig' },
      ];
    case 'alarm':
      return [
        { key: 'scharf', label: 'scharf' },
        { key: 'ausgeloest', label: 'ausgelöst' },
        { key: 'unscharf', label: 'unscharf' },
      ];
    default:
      return [
        { key: 'on', label: 'an' },
        { key: 'off', label: 'aus' },
      ];
  }
}

/** Ein Zustand, der zu diesem Gerät passt – nach einem Gerätewechsel steht
 *  sonst «an» bei einem Taster (rein, testbar). */
export function fittingState(entity: Entity | undefined, current: string): string {
  const options = stateOptions(entity);
  return options.some((option) => option.key === current) ? current : options[0].key;
}

/** Sammelname für alles ohne eigene Kategorie. */
const NO_CATEGORY = 'Ohne Kategorie';

/** Nach Kategorie gruppieren (rein, testbar).
 *
 * Alphabetisch, «Ohne Kategorie» zuletzt: Wer Kategorien vergibt, will die
 * benannten oben sehen, nicht den Rest. */
export function groupByCategory<T extends { category?: string | null }>(
  items: T[]
): { category: string; items: T[] }[] {
  const nameOf = (item: T) => item.category?.trim() || NO_CATEGORY;
  const names = Array.from(new Set(items.map(nameOf))).sort((a, b) =>
    a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b)
  );
  return names.map((category) => ({
    category,
    items: items.filter((item) => nameOf(item) === category),
  }));
}

/** Freitextsuche über Name und Kategorie (rein, testbar). */
export function search<T>(
  items: T[],
  query: string,
  textOf: (item: T) => string
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => textOf(item).toLowerCase().includes(needle));
}

/** Alle vergebenen Kategorien – daraus entstehen die Vorschläge im Editor.
 *  Eine eigene Verwaltung gibt es bewusst nicht: Wer einen neuen Namen
 *  tippt, hat die Kategorie damit angelegt (rein, testbar). */
export function usedCategories(items: { category?: string | null }[]): string[] {
  return Array.from(
    new Set(
      items
        .map((item) => item.category?.trim())
        .filter((name): name is string => !!name)
    )
  ).sort((a, b) => a.localeCompare(b));
}

/** Was der Editor anbietet – bewusst wenig, aber vollständig bedienbar. */
type TriggerKind = 'state' | 'time' | 'sun';
type ActionKind = 'command' | 'scene' | 'notify';
type ConditionKind = 'none' | 'sun' | 'time';

/** Ein einzelner Auslöser – ein Ablauf kann mehrere haben («oder»). */
interface TriggerDraft {
  kind: TriggerKind;
  entityId: string;
  toState: string;
  /** Optional: nur wechseln von diesem Wert (z.B. running → idle). */
  fromState: string;
  /** Optional: anderes Zustandsfeld als 'state' (z.B. 'ring' beim Klingeln). */
  attribute: string;
  at: string;
  /** Sonnenstand-Trigger: Aufgang oder Untergang, plus Versatz in Minuten. */
  sunEvent: 'sunrise' | 'sunset';
  sunOffset: string;
}

/** Ein neuer Auslöser für dieses Gerät – mit einem Zustand, den es auch
 *  wirklich kennt. */
function newTrigger(entity?: Entity): TriggerDraft {
  return {
    ...EMPTY_TRIGGER,
    entityId: entity?.id ?? '',
    toState: fittingState(entity, EMPTY_TRIGGER.toState),
  };
}

const EMPTY_TRIGGER: TriggerDraft = {
  kind: 'state',
  entityId: '',
  toState: 'on',
  fromState: '',
  attribute: '',
  at: '18:30',
  sunEvent: 'sunset',
  sunOffset: '0',
};

interface Draft {
  id?: string;
  alias: string;
  /** Ein oder mehrere Auslöser – jeder löst den Ablauf aus. */
  triggers: TriggerDraft[];
  /** Bedingung, die zusätzlich stimmen muss («nur wenn»). */
  conditionKind: ConditionKind;
  conditionSun: 'up' | 'down';
  conditionAfter: string;
  conditionBefore: string;
  /** Zusätzliche Bedingungen «nur wenn Gerät … ist». */
  stateConditions: { entity_id: string; equals: string }[];
  /** Wie die Bedingungen verknüpft sind: alle oder eine genügt. */
  match: 'all' | 'any';
  /** Wartezeit vor den Aktionen in Sekunden (0 = sofort). */
  delaySeconds: string;
  actionKind: ActionKind;
  actionEntityId: string;
  command: string;
  /** Raumauswahl, wenn das Kommando 'Räume saugen' ist. */
  rooms: number[];
  /** Mehrere Geräte für die Aktion «Gerät schalten» (Checkliste). */
  commandActions: { entity_id: string; command: string; rooms?: number[] }[];
  sceneId: string;
  title: string;
  body: string;
  /** Frei benannte Kategorie zum Gruppieren in der Liste. */
  category: string;
}

const EMPTY: Draft = {
  alias: '',
  triggers: [{ ...EMPTY_TRIGGER }],
  conditionKind: 'none',
  conditionSun: 'down',
  conditionAfter: '',
  conditionBefore: '',
  stateConditions: [],
  match: 'all',
  delaySeconds: '0',
  actionKind: 'command',
  actionEntityId: '',
  command: 'turn_on',
  rooms: [],
  commandActions: [],
  sceneId: '',
  title: '',
  body: '',
  category: '',
};

/** Einen Trigger-Entwurf in die gespeicherte Form bringen (rein, testbar). */
function triggerToConfig(t: TriggerDraft): Record<string, any> {
  if (t.kind === 'sun') {
    return { type: 'sun', event: t.sunEvent, offset: Number(t.sunOffset) || 0 };
  }
  if (t.kind === 'time') {
    return { type: 'time', at: t.at };
  }
  const state: Record<string, any> = { type: 'state', entity_id: t.entityId, to: t.toState };
  if (t.fromState) state.from = t.fromState;
  if (t.attribute) state.attribute = t.attribute;
  return state;
}

/** Umgekehrt: gespeicherter Trigger → Entwurf (rein, testbar). */
function triggerFromConfig(t: any): TriggerDraft {
  return {
    kind: t?.type === 'time' ? 'time' : t?.type === 'sun' ? 'sun' : 'state',
    entityId: t?.entity_id ?? '',
    toState: t?.to ?? 'on',
    fromState: t?.from ?? '',
    attribute: t?.attribute ?? '',
    at: t?.at ?? EMPTY_TRIGGER.at,
    sunEvent: t?.event === 'sunrise' ? 'sunrise' : 'sunset',
    sunOffset: String(t?.offset ?? 0),
  };
}

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
  const cover = entities.find((entity) => entity.kind === 'cover');
  const offScene = scenes.find((scene) => scene.id === 'alles_aus');
  const firstOff = entities.find((entity) => entity.commands.includes('turn_off'));

  if (presence && (offScene || firstOff)) {
    templates.push({
      label: 'Alles aus, wenn niemand da',
      icon: 'exit-outline',
      draft: {
        ...EMPTY,
        alias: 'Alles aus, wenn niemand zuhause',
        triggers: [{ ...EMPTY_TRIGGER, entityId: presence.id, toState: 'off' }],
        ...(offScene
          ? { actionKind: 'scene' as ActionKind, sceneId: offScene.id }
          : { commandActions: [{ entity_id: firstOff!.id, command: 'turn_off' }] }),
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
        triggers: [
          { ...EMPTY_TRIGGER, entityId: doorbell.id, attribute: 'ring', toState: 'on' },
        ],
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
        triggers: [
          { ...EMPTY_TRIGGER, entityId: appliance.id, fromState: 'running', toState: 'idle' },
        ],
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
        triggers: [{ ...EMPTY_TRIGGER, entityId: alert.id, toState: 'alert' }],
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
        triggers: [{ ...EMPTY_TRIGGER, kind: 'time', at: '09:00' }],
        commandActions: [{ entity_id: vacuum.id, command: 'clean_rooms', rooms: [] }],
      },
    });
  }
  if (cover) {
    templates.push({
      label: 'Storen zu bei Sonnenuntergang',
      icon: 'moon-outline',
      draft: {
        ...EMPTY,
        alias: 'Storen zu bei Sonnenuntergang',
        triggers: [{ ...EMPTY_TRIGGER, kind: 'sun', sunEvent: 'sunset', sunOffset: '0' }],
        commandActions: [{ entity_id: cover.id, command: 'close' }],
      },
    });
    templates.push({
      label: 'Storen auf bei Sonnenaufgang',
      icon: 'sunny-outline',
      draft: {
        ...EMPTY,
        alias: 'Storen auf bei Sonnenaufgang',
        triggers: [{ ...EMPTY_TRIGGER, kind: 'sun', sunEvent: 'sunrise', sunOffset: '0' }],
        commandActions: [{ entity_id: cover.id, command: 'open' }],
      },
    });
    if (alert) {
      templates.push({
        label: 'Sturmschutz: Storen zu bei Warnung',
        icon: 'shield-outline',
        draft: {
          ...EMPTY,
          alias: 'Sturmschutz',
          triggers: [{ ...EMPTY_TRIGGER, entityId: alert.id, toState: 'alert' }],
          commandActions: [{ entity_id: cover.id, command: 'close' }],
        },
      });
    }
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
  // Je Abschnitt ein eigenes Suchfeld – die Listen sind unabhängig.
  const [autoQuery, setAutoQuery] = useState('');
  const [sceneQuery, setSceneQuery] = useState('');
  // Aufgeklappte Kategorien, getrennt je Abschnitt. Standard ist
  // zugeklappt: Wer Kategorien vergibt, will zuerst die Übersicht sehen
  // und nicht wieder die ganze Liste.
  const [openAuto, setOpenAuto] = useState<string[]>([]);
  const [openScenes, setOpenScenes] = useState<string[]>([]);
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
    const body = {
      alias: draft.alias || 'Ohne Namen',
      trigger: draft.triggers.map(triggerToConfig),
      condition: buildConditions(draft),
      action: buildActions(draft),
      match: draft.match,
      category: draft.category.trim() || null,
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

  /** Den gespeicherten Ablauf einmal sofort ausführen – der «Testen»-Knopf. */
  const test = async (id: string) => {
    try {
      const response = await fetch(`${settings.url}/api/automations/${id}/trigger`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
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
      on_start: !!sceneDraft.onStart,
      category: sceneDraft.category?.trim() || null,
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
          onPress={() =>
            setDraft({
              ...EMPTY,
              triggers: [newTrigger(entities[0])],
            })
          }
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
      ) : (
        <>
          {automations.length > 5 ? (
            <SearchBox
              value={autoQuery}
              onChange={setAutoQuery}
              placeholder="Ablauf oder Kategorie suchen …"
            />
          ) : null}
          <Groups
            groups={groupByCategory(
              search(automations, autoQuery, (entry) =>
                `${entry.alias} ${entry.category ?? ''}`
              )
            )}
            open={openAuto}
            openAll={!!autoQuery}
            onToggle={(category) =>
              setOpenAuto((prev) =>
                prev.includes(category)
                  ? prev.filter((entry) => entry !== category)
                  : [...prev, category]
              )
            }
            empty="Nichts gefunden."
            renderItem={(automation) => (
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
            )}
          />
        </>
      )}

      <Text style={styles.sectionTitle}>Szenen</Text>
      {mayEdit ? (
        <Pressable
          onPress={() =>
            setSceneDraft({
              name: '',
              icon: SCENE_ICONS[0],
              onStart: false,
              actions: [],
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
      ) : (
        <>
          {scenes.length > 5 ? (
            <SearchBox
              value={sceneQuery}
              onChange={setSceneQuery}
              placeholder="Szene oder Kategorie suchen …"
            />
          ) : null}
          <Groups
            groups={groupByCategory(
              search(scenes, sceneQuery, (entry) =>
                `${entry.name} ${entry.category ?? ''} ${entry.room ?? ''}`
              )
            )}
            open={openScenes}
            openAll={!!sceneQuery}
            onToggle={(category) =>
              setOpenScenes((prev) =>
                prev.includes(category)
                  ? prev.filter((entry) => entry !== category)
                  : [...prev, category]
              )
            }
            empty="Nichts gefunden."
            renderItem={(scene) => (
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
                          onStart: !!scene.on_start,
                          category: scene.category ?? undefined,
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
            )}
          />
        </>
      )}

      <Editor
        draft={draft}
        entities={entities}
        scenes={scenes}
        categories={usedCategories(automations)}
        onChange={setDraft}
        onSave={save}
        onDelete={draft?.id ? () => remove(draft.id!) : undefined}
        onTest={draft?.id ? () => test(draft.id!) : undefined}
        onCancel={() => setDraft(null)}
      />
      <SceneEditor
        draft={sceneDraft}
        entities={entities}
        categories={usedCategories(scenes)}
        onChange={setSceneDraft}
        onSave={saveScene}
        onDelete={sceneDraft?.id ? () => removeScene(sceneDraft.id!) : undefined}
        onCancel={() => setSceneDraft(null)}
      />
    </View>
  );
}

/** Kategorie eintippen oder eine vorhandene antippen.
 *
 * Kein eigener Verwaltungsdialog: Eine neue Kategorie entsteht dadurch,
 * dass jemand ihren Namen tippt, und verschwindet, wenn nichts mehr darin
 * liegt. Eine Liste leerer Kategorien müsste man sonst pflegen. */
function CategoryField({
  value,
  known,
  onChange,
}: {
  value: string;
  known: string[];
  onChange: (value: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const current = value.trim();
  return (
    <Field label="Kategorie (optional)">
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder="z.B. Beleuchtung"
        placeholderTextColor={colors.inkFaint}
      />
      {known.length > 0 ? (
        <View style={styles.choices}>
          {known.map((name) => {
            const on = name === current;
            return (
              <Pressable
                key={name}
                onPress={() => onChange(on ? '' : name)}
                accessibilityRole="button"
                style={[styles.template, on && styles.templateOn]}
              >
                <Text style={[styles.templateText, on && { color: '#FFFFFF' }]}>
                  {name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </Field>
  );
}

/** Suchfeld – je Abschnitt eines, damit die Listen unabhängig bleiben. */
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.deviceSearch}>
      <Ionicons name="search" size={15} color={colors.inkFaint} />
      <TextInput
        style={styles.deviceSearchInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
      />
      {value ? (
        <Pressable onPress={() => onChange('')} hitSlop={8}>
          <Ionicons name="close-circle" size={17} color={colors.inkFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Die Einträge nach Kategorie, jede Kategorie zuklappbar.
 *
 * Bei genau einer Gruppe ohne Namen entfällt die Überschrift: Wer keine
 * Kategorien vergibt, soll auch keine sehen. */
function Groups<T extends { id: string }>({
  groups,
  open,
  openAll = false,
  onToggle,
  renderItem,
  empty,
}: {
  groups: { category: string; items: T[] }[];
  /** Aufgeklappte Kategorien – alles andere ist zu. */
  open: string[];
  /** Während einer Suche alles offen: Ein Treffer in einer zugeklappten
   *  Kategorie wäre sonst unsichtbar. */
  openAll?: boolean;
  onToggle: (category: string) => void;
  renderItem: (item: T) => React.ReactNode;
  empty: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (groups.length === 0) {
    return <Text style={styles.note}>{empty}</Text>;
  }
  const plain = groups.length === 1 && groups[0].category === NO_CATEGORY;
  if (plain) {
    return <>{groups[0].items.map(renderItem)}</>;
  }

  return (
    <>
      {groups.map((group) => {
        const shut = !openAll && !open.includes(group.category);
        return (
          <View key={group.category} style={{ gap: 10 }}>
            <Pressable
              onPress={() => onToggle(group.category)}
              accessibilityRole="button"
              accessibilityState={{ expanded: !shut }}
              style={styles.groupHead}
            >
              <Ionicons
                name={shut ? 'chevron-forward' : 'chevron-down'}
                size={16}
                color={colors.inkSoft}
              />
              <Text style={styles.groupTitle}>{group.category}</Text>
              <Text style={styles.groupCount}>{group.items.length}</Text>
            </Pressable>
            {!shut ? group.items.map(renderItem) : null}
          </View>
        );
      })}
    </>
  );
}

interface SceneDraft {
  id?: string;
  name: string;
  icon: string;
  /** Optionaler Raum – dann erscheint die Szene in dessen Kategorie „Szenen“. */
  room?: string;
  /** Auf der Startseite als Schnellaktion anzeigen. */
  onStart?: boolean;
  actions: { entity_id: string; command: string; rooms?: number[] }[];
  /** Frei benannte Kategorie zum Gruppieren in der Liste. */
  category?: string;
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

/** Ein Gerät, das eine Szene schalten kann: Licht/Schalter, Storen, Schloss
 *  oder Sauger. Nur diese lassen sich sinnvoll in einen Zustand versetzen. */
function isSceneDevice(entity: Entity): boolean {
  return (
    entity.commands.includes('turn_on') ||
    entity.kind === 'cover' ||
    entity.kind === 'lock' ||
    entity.kind === 'media_player' ||
    entity.commands.includes('clean_rooms') ||
    entity.commands.includes('start')
  );
}

/** Die Schalt-Optionen eines Geräts als Chips (rein, testbar).
 *
 * ``allowToggle`` gilt nur für Abläufe: Ein Wandtaster soll das Licht
 * anmachen, wenn es aus ist, und ausmachen, wenn es an ist – dafür braucht
 * es «umschalten». In einer Szene wäre dasselbe sinnlos, denn eine Szene
 * beschreibt einen Zielzustand; was dabei herauskäme, hinge davon ab, wie
 * das Licht gerade steht.
 */
function commandOptions(
  entity: Entity,
  allowToggle = false
): { key: string; label: string }[] {
  const options = baseCommandOptions(entity);
  // Nur anbieten, wo das Gerät es wirklich kann – Storen etwa können es nicht.
  if (allowToggle && entity.commands.includes('toggle')) {
    options.push({ key: 'toggle', label: 'umschalten' });
  }
  return options;
}

function baseCommandOptions(entity: Entity): { key: string; label: string }[] {
  if (entity.kind === 'cover') {
    return [
      { key: 'open', label: 'hoch' },
      { key: 'close', label: 'runter' },
    ];
  }
  if (entity.kind === 'lock') {
    return [
      { key: 'lock', label: 'abschliessen' },
      { key: 'unlock', label: 'aufschliessen' },
    ];
  }
  if (entity.kind === 'vacuum') {
    const options = [
      { key: 'start', label: 'saugen' },
      { key: 'dock', label: 'zur Station' },
    ];
    if (vacuumRooms(entity).length > 0) {
      options.push({ key: 'clean_rooms', label: 'Räume saugen' });
    }
    return options;
  }
  if (entity.kind === 'media_player') {
    return [
      { key: 'play', label: 'Musik an' },
      { key: 'pause', label: 'Musik aus' },
    ];
  }
  return [
    { key: 'turn_on', label: 'ein' },
    { key: 'turn_off', label: 'aus' },
  ];
}

/** Das Kommando, das den aktuellen Zustand eines Geräts festhält (rein,
 *  testbar) – Grundlage für «Aktuellen Zustand übernehmen». */
function snapshotCommand(entity: Entity): string {
  const state = entity.state.state;
  if (entity.kind === 'cover') {
    const position = entity.state.position;
    if (typeof position === 'number') return position <= 5 ? 'close' : 'open';
    return state === 'closed' ? 'close' : 'open';
  }
  if (entity.kind === 'lock') return state === 'locked' ? 'lock' : 'unlock';
  if (entity.kind === 'vacuum') return state === 'cleaning' ? 'start' : 'dock';
  // «Aus laufender Musik»: spielt gerade etwas, nimmt die Szene das Abspielen
  // auf – aktiviert man sie später, läuft die Musik weiter.
  if (entity.kind === 'media_player') return state === 'playing' ? 'play' : 'pause';
  return state === 'on' ? 'turn_on' : 'turn_off';
}

/** Geräte-Checkliste statt Zeilen mit Dropdown: antippen nimmt ein Gerät in
 *  die Szene auf, ein zweiter Chip legt den Zielzustand fest. «Aktuellen
 *  Zustand übernehmen» füllt alles in einem Tipp aus der Wirklichkeit. */
function SceneDevices({
  entities,
  actions,
  onActions,
  showSnapshot = true,
  allowToggle = false,
}: {
  entities: Entity[];
  actions: SceneDraft['actions'];
  onActions: (actions: SceneDraft['actions']) => void;
  /** Der «Aktuellen Zustand übernehmen»-Knopf – für Szenen sinnvoll, für
   *  Ablauf-Aktionen nicht (dort zählt der Zielzustand, nicht der jetzige). */
  showSnapshot?: boolean;
  /** «umschalten» als dritte Möglichkeit – nur in Abläufen sinnvoll. */
  allowToggle?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const all = entities.filter(isSceneDevice);
  const devices = needle
    ? all.filter(
        (entity) =>
          entity.name.toLowerCase().includes(needle) ||
          (entity.room ?? '').toLowerCase().includes(needle)
      )
    : all;
  const byId = new Map(actions.map((action) => [action.entity_id, action]));

  // Nach Raum gruppieren; Geräte ohne Raum kommen unter «Weitere».
  const groups: { room: string; items: Entity[] }[] = [];
  const order = Array.from(
    new Set(devices.map((entity) => entity.room || 'Weitere'))
  ).sort((a, b) => (a === 'Weitere' ? 1 : b === 'Weitere' ? -1 : a.localeCompare(b)));
  for (const room of order) {
    groups.push({
      room,
      items: devices.filter((entity) => (entity.room || 'Weitere') === room),
    });
  }

  const toggle = (entity: Entity) => {
    if (byId.has(entity.id)) {
      onActions(actions.filter((action) => action.entity_id !== entity.id));
    } else {
      onActions([
        ...actions,
        { entity_id: entity.id, command: snapshotCommand(entity), rooms: [] },
      ]);
    }
  };

  const setCommand = (entityId: string, command: string) =>
    onActions(
      actions.map((action) =>
        action.entity_id === entityId ? { ...action, command } : action
      )
    );

  const setRooms = (entityId: string, id: number) =>
    onActions(
      actions.map((action) => {
        if (action.entity_id !== entityId) return action;
        const current = action.rooms ?? [];
        return {
          ...action,
          rooms: current.includes(id)
            ? current.filter((entry) => entry !== id)
            : [...current, id],
        };
      })
    );

  const snapshot = () =>
    onActions(devices.map((entity) => ({
      entity_id: entity.id,
      command: snapshotCommand(entity),
      rooms: [],
    })));

  return (
    <View style={{ gap: 10 }}>
      {showSnapshot ? (
        <>
          <Pressable
            onPress={snapshot}
            accessibilityRole="button"
            style={({ pressed }) => [styles.snapshot, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name="camera-outline" size={18} color={colors.accent} />
            <Text style={styles.snapshotText}>Aktuellen Zustand übernehmen</Text>
          </Pressable>
          <Text style={styles.snapshotHint}>
            Stell die Zimmer so ein, wie du sie in der Szene willst, und tippe
            oben – oder wähle die Geräte einzeln.
          </Text>
        </>
      ) : null}

      <View style={styles.deviceSearch}>
        <Ionicons name="search" size={15} color={colors.inkFaint} />
        <TextInput
          style={styles.deviceSearchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Gerät oder Raum suchen …"
          placeholderTextColor={colors.inkFaint}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={17} color={colors.inkFaint} />
          </Pressable>
        ) : null}
      </View>
      {actions.length > 0 ? (
        <Text style={styles.snapshotHint}>{actions.length} Gerät(e) ausgewählt</Text>
      ) : null}

      {groups.length === 0 ? (
        <Text style={styles.snapshotHint}>Nichts gefunden.</Text>
      ) : null}
      {groups.map((group) => (
        <View key={group.room} style={{ gap: 6 }}>
          <Text style={styles.groupLabel}>{group.room}</Text>
          {group.items.map((entity) => {
            const action = byId.get(entity.id);
            const included = !!action;
            const rooms = vacuumRooms(entity);
            return (
              <View key={entity.id} style={styles.deviceRow}>
                <Pressable
                  onPress={() => toggle(entity)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: included }}
                  style={styles.deviceHead}
                >
                  <Ionicons
                    name={included ? 'checkmark-circle' : 'ellipse-outline'}
                    size={24}
                    color={included ? colors.on : colors.inkFaint}
                  />
                  <Text style={styles.deviceName}>{entity.name}</Text>
                </Pressable>
                {included ? (
                  <View style={{ gap: 6 }}>
                    <Choice
                      options={commandOptions(entity, allowToggle)}
                      value={action!.command}
                      onSelect={(command) => setCommand(entity.id, command)}
                    />
                    {action!.command === 'clean_rooms' && rooms.length > 0 ? (
                      <Choice
                        multi
                        options={rooms.map((room) => ({
                          key: String(room.id),
                          label: room.name,
                        }))}
                        values={(action!.rooms ?? []).map(String)}
                        onSelect={(key) => setRooms(entity.id, Number(key))}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function SceneEditor({
  draft,
  entities,
  categories,
  onChange,
  onSave,
  onDelete,
  onCancel,
}: {
  draft: SceneDraft | null;
  entities: Entity[];
  /** Schon vergebene Kategorien – als Vorschläge im Feld. */
  categories: string[];
  onChange: (draft: SceneDraft) => void;
  onSave: () => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!draft) return null;

  const set = (patch: Partial<SceneDraft>) => onChange({ ...draft, ...patch });
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

        <CategoryField
          value={draft.category ?? ''}
          known={categories}
          onChange={(category) => set({ category })}
        />

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

        <Field label="Startseite">
          <Choice
            options={[
              { key: 'yes', label: 'Als Schnellaktion anzeigen' },
              { key: 'no', label: 'Nicht anzeigen' },
            ]}
            value={draft.onStart ? 'yes' : 'no'}
            onSelect={(value) => set({ onStart: value === 'yes' })}
          />
        </Field>

        <Field label="Diese Geräte schalten">
          <SceneDevices
            entities={entities}
            actions={draft.actions}
            onActions={(actions) => set({ actions })}
          />
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
  categories,
  onChange,
  onSave,
  onDelete,
  onTest,
  onCancel,
}: {
  draft: Draft | null;
  entities: Entity[];
  scenes: Scene[];
  /** Schon vergebene Kategorien – als Vorschläge im Feld. */
  categories: string[];
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onDelete?: () => void;
  /** Nur bei gespeicherten Abläufen: einmal sofort ausführen. */
  onTest?: () => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tested, setTested] = useState(false);
  if (!draft) return null;

  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  const setTrigger = (index: number, patch: Partial<TriggerDraft>) =>
    set({
      triggers: draft.triggers.map((trigger, i) =>
        i === index ? { ...trigger, ...patch } : trigger
      ),
    });
  const addTrigger = () =>
    set({
      triggers: [
        ...draft.triggers,
        newTrigger(entities[0]),
      ],
    });
  const removeTrigger = (index: number) =>
    set({ triggers: draft.triggers.filter((_, i) => i !== index) });

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

        <Text style={styles.snapshotHint}>
          Ein Ablauf ist ein Satz: „Wenn … passiert, dann … tun." Unten das
          Wenn und das Dann ausfüllen, oben einen Namen geben.
        </Text>

        <Field label="Name">
          <TextInput
            style={styles.input}
            value={draft.alias}
            onChangeText={(alias) => set({ alias })}
            placeholder="z.B. Licht bei Bewegung"
            placeholderTextColor={colors.inkFaint}
          />
        </Field>

        <CategoryField
          value={draft.category}
          known={categories}
          onChange={(category) => set({ category })}
        />

        <Field label={draft.triggers.length > 1 ? 'Wenn eines passiert' : 'Wenn … passiert'}>
          {draft.triggers.map((trigger, index) => (
            <TriggerRow
              key={index}
              trigger={trigger}
              entities={entities}
              index={index}
              removable={draft.triggers.length > 1}
              onChange={(patch) => setTrigger(index, patch)}
              onRemove={() => removeTrigger(index)}
            />
          ))}
          <Pressable
            onPress={addTrigger}
            accessibilityRole="button"
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
          >
            <Ionicons name="add" size={16} color={colors.accent} />
            <Text style={styles.addRowText}>Weiterer Auslöser</Text>
          </Pressable>
        </Field>

        <Field label="Nur wenn (Bedingung)">
          <Choice
            options={[
              { key: 'none', label: 'immer' },
              { key: 'sun', label: 'Tag / Nacht' },
              { key: 'time', label: 'Zeitfenster' },
            ]}
            value={draft.conditionKind}
            onSelect={(conditionKind) =>
              set({ conditionKind: conditionKind as ConditionKind })
            }
          />
          {draft.conditionKind === 'sun' ? (
            <Choice
              options={[
                { key: 'down', label: 'nur wenn dunkel' },
                { key: 'up', label: 'nur wenn hell' },
              ]}
              value={draft.conditionSun}
              onSelect={(value) => set({ conditionSun: value as 'up' | 'down' })}
            />
          ) : draft.conditionKind === 'time' ? (
            <View style={styles.rowGap}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={draft.conditionAfter}
                onChangeText={(conditionAfter) => set({ conditionAfter })}
                placeholder="ab 22:00"
                placeholderTextColor={colors.inkFaint}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={draft.conditionBefore}
                onChangeText={(conditionBefore) => set({ conditionBefore })}
                placeholder="bis 06:00"
                placeholderTextColor={colors.inkFaint}
              />
            </View>
          ) : null}

          {draft.stateConditions.map((entry, index) => {
            const chosen = entities.find((entity) => entity.id === entry.entity_id);
            const setEntry = (patch: Partial<typeof entry>) =>
              set({
                stateConditions: draft.stateConditions.map((other, position) =>
                  position === index ? { ...other, ...patch } : other
                ),
              });
            return (
              <View key={index} style={styles.triggerBox}>
                <View style={styles.triggerHead}>
                  <Text style={styles.triggerBadge}>nur wenn Gerät</Text>
                  <Pressable
                    onPress={() =>
                      set({
                        stateConditions: draft.stateConditions.filter(
                          (_other, position) => position !== index
                        ),
                      })
                    }
                    accessibilityLabel="Bedingung entfernen"
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </Pressable>
                </View>
                <Picker
                  items={entities.map((entity) => ({ key: entity.id, label: entity.name }))}
                  value={entry.entity_id}
                  onSelect={(entity_id) =>
                    setEntry({
                      entity_id,
                      equals: fittingState(
                        entities.find((entity) => entity.id === entity_id),
                        entry.equals
                      ),
                    })
                  }
                />
                <Choice
                  options={stateOptions(chosen)}
                  value={entry.equals}
                  onSelect={(equals) => setEntry({ equals })}
                />
              </View>
            );
          })}

          <Pressable
            onPress={() =>
              set({
                stateConditions: [
                  ...draft.stateConditions,
                  {
                    entity_id: entities[0]?.id ?? '',
                    equals: fittingState(entities[0], 'on'),
                  },
                ],
              })
            }
            accessibilityRole="button"
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
          >
            <Ionicons name="add" size={16} color={colors.accent} />
            <Text style={styles.addRowText}>Gerätebedingung hinzufügen</Text>
          </Pressable>

          {buildConditions(draft).length > 1 ? (
            <>
              <Choice
                options={[
                  { key: 'all', label: 'alle müssen stimmen (und)' },
                  { key: 'any', label: 'eine genügt (oder)' },
                ]}
                value={draft.match}
                onSelect={(match) => set({ match: match as 'all' | 'any' })}
              />
              <Text style={styles.triggerNote}>
                {draft.match === 'any'
                  ? 'Der Ablauf läuft, sobald eine der Bedingungen stimmt.'
                  : 'Der Ablauf läuft nur, wenn alle Bedingungen zugleich stimmen.'}
              </Text>
            </>
          ) : null}

          <Text style={styles.triggerNote}>
            Mehrere Auslöser sind immer ein «oder» – sie sind Ereignisse und
            können gar nicht gleichzeitig eintreten. Ein «und» gehört hierher:
            «wenn der Taster gedrückt wird – aber nur, wenn es dunkel ist».
          </Text>
        </Field>

        <Field label="Verzögerung">
          <Choice
            options={[
              { key: '0', label: 'sofort' },
              { key: '30', label: '30 Sek.' },
              { key: '60', label: '1 Min.' },
              { key: '300', label: '5 Min.' },
              { key: '600', label: '10 Min.' },
            ]}
            value={draft.delaySeconds}
            onSelect={(delaySeconds) => set({ delaySeconds })}
          />
          {Number(draft.delaySeconds) > 0 ? (
            <Text style={styles.triggerNote}>
              Wartet {delayLabel(draft.delaySeconds)}, bevor die Aktion ausgeführt wird.
            </Text>
          ) : null}
        </Field>

        <Field label="… dann das tun">
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
            <SceneDevices
              entities={entities}
              actions={draft.commandActions}
              onActions={(commandActions) => set({ commandActions })}
              showSnapshot={false}
              allowToggle
            />
          ) : draft.actionKind === 'scene' ? (
            <Picker
              items={scenes.map((scene) => ({ key: scene.id, label: scene.name }))}
              placeholder="Szene suchen …"
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
        {onTest ? (
          <Pressable
            style={({ pressed }) => [styles.snapshot, pressed && { opacity: 0.8 }]}
            onPress={() => {
              onTest();
              setTested(true);
            }}
            accessibilityRole="button"
          >
            <Ionicons name="flash-outline" size={18} color={colors.accent} />
            <Text style={styles.snapshotText}>
              {tested ? 'Ausgeführt ✓' : 'Jetzt testen'}
            </Text>
          </Pressable>
        ) : null}
        {onTest ? (
          <Text style={styles.snapshotHint}>
            Führt die Aktionen einmal sofort aus – ohne auf den Auslöser oder die
            Bedingung zu warten. Gespeicherte Änderungen zuerst sichern.
          </Text>
        ) : null}
        {onDelete ? (
          <Pressable style={styles.delete} onPress={onDelete} accessibilityRole="button">
            <Text style={styles.deleteText}>Ablauf löschen</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Modal>
  );
}

/** Ein Auslöser im Editor – eigenständige Komponente auf Modulebene, damit
 *  die Texteingaben beim Tippen nicht neu montiert werden. */
function TriggerRow({
  trigger,
  entities,
  index,
  removable,
  onChange,
  onRemove,
}: {
  trigger: TriggerDraft;
  entities: Entity[];
  index: number;
  removable: boolean;
  onChange: (patch: Partial<TriggerDraft>) => void;
  onRemove: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const chosen = entities.find((entity) => entity.id === trigger.entityId);
  return (
    <View style={styles.triggerBox}>
      {removable ? (
        <View style={styles.triggerHead}>
          <Text style={styles.triggerBadge}>Auslöser {index + 1}</Text>
          <Pressable onPress={onRemove} accessibilityLabel="Auslöser entfernen" hitSlop={8}>
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
          </Pressable>
        </View>
      ) : null}
      <Choice
        options={[
          // «Gerät wechselt» stimmt bei einem Taster nicht: Der wechselt
          // nichts, er wird gedrückt.
          {
            key: 'state',
            label: chosen?.kind === 'button' ? 'Taster gedrückt' : 'Gerät wechselt',
          },
          { key: 'time', label: 'Uhrzeit' },
          { key: 'sun', label: 'Sonnenstand' },
        ]}
        value={trigger.kind}
        onSelect={(kind) => onChange({ kind: kind as TriggerKind })}
      />
      {trigger.kind === 'sun' ? (
        <>
          <Choice
            options={[
              { key: 'sunrise', label: 'Sonnenaufgang' },
              { key: 'sunset', label: 'Sonnenuntergang' },
            ]}
            value={trigger.sunEvent}
            onSelect={(sunEvent) => onChange({ sunEvent: sunEvent as TriggerDraft['sunEvent'] })}
          />
          <TextInput
            style={styles.input}
            value={trigger.sunOffset}
            onChangeText={(sunOffset) => onChange({ sunOffset })}
            placeholder="Versatz in Minuten, z.B. -30"
            placeholderTextColor={colors.inkFaint}
            keyboardType="numbers-and-punctuation"
          />
          <Text style={styles.triggerNote}>
            Löst {Number(trigger.sunOffset) ? `${Math.abs(Number(trigger.sunOffset))} Min ` : ''}
            {Number(trigger.sunOffset) < 0 ? 'vor ' : Number(trigger.sunOffset) > 0 ? 'nach ' : ''}
            {trigger.sunEvent === 'sunrise' ? 'Sonnenaufgang' : 'Sonnenuntergang'} aus.
          </Text>
        </>
      ) : trigger.kind === 'state' ? (
        <>
          <Picker
            items={entities.map((entity) => ({ key: entity.id, label: entity.name }))}
            value={trigger.entityId}
            onSelect={(entityId) =>
              onChange({
                entityId,
                // Ein Taster kennt kein «an» – nach dem Wechsel muss der
                // Zustand zum neuen Gerät passen, sonst stünde da ein
                // Auslöser, der nie eintritt.
                toState: fittingState(
                  entities.find((entity) => entity.id === entityId),
                  trigger.toState
                ),
              })
            }
          />
          <Choice
            options={stateOptions(chosen)}
            value={trigger.toState}
            onSelect={(toState) => onChange({ toState, attribute: '', fromState: '' })}
          />
          {chosen?.kind === 'button' ? (
            <Text style={styles.triggerNote}>
              Löst bei jedem Druck aus – auch wenn dieselbe Taste mehrmals
              hintereinander gedrückt wird.
            </Text>
          ) : null}
          {trigger.attribute || trigger.fromState ? (
            <Text style={styles.triggerNote}>
              Löst aus, wenn {trigger.attribute || 'der Zustand'}
              {trigger.fromState ? ` von «${trigger.fromState}»` : ''} auf «{trigger.toState}»
              wechselt.
            </Text>
          ) : null}
        </>
      ) : (
        <TextInput
          style={styles.input}
          value={trigger.at}
          onChangeText={(at) => onChange({ at })}
          placeholder="18:30"
          placeholderTextColor={colors.inkFaint}
        />
      )}
    </View>
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
  placeholder = 'Gerät suchen …',
}: {
  items: { key: string; label: string }[];
  value: string;
  onSelect: (key: string) => void;
  placeholder?: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  // Ab hier wird die Liste zum Wischen zu lang; darunter wäre ein
  // Suchfeld nur im Weg.
  const searchable = items.length > 8;
  const shown = searchable ? pickerMatches(items, query, value) : items;

  return (
    <View style={{ gap: 8 }}>
      {searchable ? (
        <SearchBox value={query} onChange={setQuery} placeholder={placeholder} />
      ) : null}
      {shown.length === 0 ? (
        <Text style={styles.triggerNote}>Nichts gefunden.</Text>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker}>
      <View style={styles.choices}>
        {shown.map((item) => (
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
    </View>
  );
}

/** Treffer der Suche im Auswahlfeld (rein, testbar).
 *
 * Das Gewählte bleibt immer sichtbar, auch wenn es nicht zur Suche passt –
 * sonst stünde beim Tippen plötzlich nirgends mehr, was gerade eingestellt
 * ist. */
export function pickerMatches(
  items: { key: string; label: string }[],
  query: string,
  value: string
): { key: string; label: string }[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  const hits = items.filter((item) => item.label.toLowerCase().includes(needle));
  if (hits.some((item) => item.key === value)) return hits;
  const chosen = items.find((item) => item.key === value);
  return chosen ? [chosen, ...hits] : hits;
}

/** Lesbarer Text für eine Wartezeit (rein, testbar). */
function delayLabel(seconds: string): string {
  const value = Number(seconds) || 0;
  if (value < 60) return `${value} Sekunden`;
  const minutes = Math.round(value / 60);
  return `${minutes} Minute${minutes === 1 ? '' : 'n'}`;
}

/** Die Bedingung eines Ablaufs in die gespeicherte Form (rein, testbar). */
function buildConditions(draft: Draft): Record<string, any>[] {
  const conditions: Record<string, any>[] = [];
  if (draft.conditionKind === 'sun') {
    conditions.push({ type: 'sun', state: draft.conditionSun });
  } else if (draft.conditionKind === 'time') {
    const condition: Record<string, any> = { type: 'time' };
    if (draft.conditionAfter) condition.after = draft.conditionAfter;
    if (draft.conditionBefore) condition.before = draft.conditionBefore;
    // Ohne beide Zeiten wäre die Bedingung sinnlos – dann keine.
    if (condition.after || condition.before) conditions.push(condition);
  }
  for (const entry of draft.stateConditions) {
    if (entry.entity_id) {
      conditions.push({ type: 'state', entity_id: entry.entity_id, equals: entry.equals });
    }
  }
  return conditions;
}

/** Die Aktionen eines Ablaufs – bei «Gerät schalten» eine je gewähltem Gerät.
 *  Eine Wartezeit wird als erste Aktion vorangestellt. */
function buildActions(draft: Draft): Record<string, any>[] {
  const delay = Number(draft.delaySeconds) || 0;
  const prefix: Record<string, any>[] =
    delay > 0 ? [{ type: 'delay', seconds: delay }] : [];
  if (draft.actionKind === 'scene') {
    return [...prefix, { type: 'scene', scene: draft.sceneId }];
  }
  if (draft.actionKind === 'notify') {
    return [...prefix, { type: 'notify', to: 'all', title: draft.title, body: draft.body }];
  }
  const commands = draft.commandActions
    .filter((action) => action.entity_id)
    .map((action) => {
      const built: Record<string, any> = {
        type: 'command',
        entity_id: action.entity_id,
        command: action.command,
      };
      if (action.command === 'clean_rooms') {
        built.data = { rooms: action.rooms ?? [] };
      }
      return built;
    });
  return [...prefix, ...commands];
}

function toDraft(automation: Automation): Draft {
  const triggers = (automation.triggers ?? []).map(triggerFromConfig);
  // Die erste Nicht-Verzögerungs-Aktion bestimmt Art und Felder.
  const action = automation.actions.find((entry) => entry.type !== 'delay') ?? {};
  const delay = automation.actions.find((entry) => entry.type === 'delay');
  const all = automation.conditions ?? [];
  // Sonnenstand und Uhrzeit haben je ein eigenes Feld; Gerätebedingungen
  // sind eine Liste.
  const condition = all.find((entry) => entry.type === 'sun' || entry.type === 'time') ?? {};
  return {
    ...EMPTY,
    id: automation.id,
    alias: automation.alias,
    triggers: triggers.length > 0 ? triggers : [{ ...EMPTY_TRIGGER }],
    conditionKind:
      condition.type === 'sun' ? 'sun' : condition.type === 'time' ? 'time' : 'none',
    conditionSun: condition.state === 'up' ? 'up' : 'down',
    conditionAfter: condition.after ?? '',
    conditionBefore: condition.before ?? '',
    stateConditions: all
      .filter((entry) => (entry.type ?? 'state') === 'state' && entry.entity_id)
      .map((entry) => ({ entity_id: entry.entity_id, equals: String(entry.equals ?? 'on') })),
    match: automation.match === 'any' ? 'any' : 'all',
    delaySeconds: String(delay?.seconds ?? 0),
    actionKind: (action.type as ActionKind) ?? 'command',
    actionEntityId: action.entity_id ?? '',
    command: action.command ?? 'turn_on',
    rooms: action.data?.rooms ?? [],
    // Alle command-Aktionen in die Checkliste übernehmen.
    commandActions: automation.actions
      .filter((entry) => entry.type === 'command' && entry.entity_id)
      .map((entry) => ({
        entity_id: entry.entity_id,
        command: entry.command ?? 'turn_on',
        rooms: entry.data?.rooms ?? [],
      })),
    sceneId: action.scene ?? '',
    category: automation.category ?? '',
    title: action.title ?? '',
    body: action.body ?? '',
  };
}

function describe(automation: Automation): string {
  const trigger = automation.triggers[0];
  const action = automation.actions.find((entry) => entry.type !== 'delay');
  const wenn = !trigger
    ? 'ohne Auslöser'
    : trigger.type === 'time'
      ? `täglich um ${trigger.at}`
      : trigger.type === 'sun'
        ? `bei ${trigger.event === 'sunrise' ? 'Sonnenaufgang' : 'Sonnenuntergang'}${
            trigger.offset ? ` ${trigger.offset > 0 ? '+' : ''}${trigger.offset} min` : ''
          }`
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
  const mehr = automation.triggers.length > 1 ? ` (+${automation.triggers.length - 1})` : '';
  const wartet = automation.actions.some((entry) => entry.type === 'delay') ? ' ⏱' : '';
  return `${wenn}${mehr} → ${dann}${wartet}`;
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
    snapshot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 13,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    snapshotText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
    snapshotHint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
    groupLabel: {
      color: colors.inkSoft,
      fontSize: 13,
      fontWeight: '700',
      marginTop: 6,
    },
    deviceRow: {
      gap: 8,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
    },
    deviceHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    deviceName: { color: colors.ink, fontSize: 15, fontWeight: '600', flex: 1 },
    deviceSearch: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    deviceSearchInput: { flex: 1, paddingVertical: 10, color: colors.ink, fontSize: 15 },
    groupHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingTop: 6,
      paddingBottom: 2,
    },
    groupTitle: {
      flex: 1,
      color: colors.onGradientSoft,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    groupCount: { color: colors.onGradientSoft, fontSize: 12, fontWeight: '700' },
    templates: { gap: 8 },
    templateOn: { backgroundColor: colors.accent, borderColor: colors.accent },
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
    triggerBox: {
      gap: 8,
      padding: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    triggerHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    triggerBadge: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
    addRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
    },
    addRowText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
    rowGap: { flexDirection: 'row', gap: 8 },
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
