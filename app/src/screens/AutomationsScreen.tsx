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
  /** Was stattdessen läuft, wenn die Bedingungen nicht passen. */
  otherwise?: any[];
  editable: boolean;
  /** Frei benannte Kategorie zum Gruppieren (vom Hub, kann fehlen). */
  category?: string | null;
  /** Verknüpfung der Bedingungen: 'all' oder 'any'. */
  match?: string;
  /** Ausgeschaltete Abläufe bleiben stehen, laufen aber nicht. */
  enabled?: boolean;
}

/** Was der Ablauf jetzt täte – ohne dass etwas passiert. */
interface DryRun {
  conditions_hold: boolean;
  skipped: string[];
  branch: string;
  would_run: string[];
}

/** Ein protokollierter Lauf – auch ein nicht ausgeführter. */
interface Run {
  automation_id: string;
  alias: string;
  at: number;
  executed: boolean;
  error?: string | null;
  skipped: string[];
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

/** Was dieser Ablauf zuletzt getan hat – und warum nicht (rein, testbar).
 *
 * Beantwortet den häufigsten Support-Fall direkt in der Liste: «geht
 * nicht» heisst fast immer, dass eine Bedingung im Weg war. */
export function lastRunText(runs: Run[], automationId: string): string {
  const run = runs.find((entry) => entry.automation_id === automationId);
  if (!run) return 'Noch nicht gelaufen';
  const time = new Date(run.at * 1000).toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (run.error) return `${time} · Fehler: ${run.error}`;
  if (run.executed) return `${time} · ausgeführt`;
  if (run.skipped.length > 0) return `${time} · übersprungen: ${run.skipped.join('; ')}`;
  return `${time} · übersprungen`;
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
type TriggerKind = 'state' | 'threshold' | 'interval' | 'time' | 'sun';
type StepKind = 'command' | 'scene' | 'hue_scene' | 'notify' | 'delay' | 'wait_until';
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
  /** Schwellen-Trigger: löst beim Übertritt aus, nicht bei jeder Schwankung. */
  thresholdOp: 'above' | 'below';
  thresholdValue: string;
  /** Intervall-Trigger: alle n Sekunden. */
  intervalSeconds: string;
}

/**
 * Ein Schritt in der Aktionsliste.
 *
 * Bewusst eine Liste aus gleichrangigen Schritten statt einer einzigen
 * Aktionsart: «Licht an, warten, Nachricht» war vorher nicht in einem
 * Ablauf möglich – man brauchte drei, die sich gegenseitig auslösen.
 *
 * Jeder Schritt trägt alle Felder mit, auch die der anderen Arten. Das
 * kostet ein paar leere Zeichenketten und erspart dafür, dass beim
 * Umschalten der Art die schon getippten Angaben verschwinden.
 */
interface StepDraft {
  kind: StepKind;
  /** Mehrere Geräte für «Gerät schalten» (Checkliste). */
  commandActions: {
    entity_id: string;
    command: string;
    rooms?: number[];
    position?: number;
  }[];
  sceneId: string;
  /** Name einer auf der Hue-Bridge gespeicherten Szene. */
  hueScene: string;
  title: string;
  body: string;
  /** Kamera, deren Bild der Nachricht beiliegt. Leer = ohne Bild. */
  notifyCamera: string;
  /** Wartezeit in Sekunden. */
  seconds: string;
  /** «Warten bis»: worauf, und wie lange höchstens. */
  waitEntityId: string;
  waitOp: Compare;
  waitValue: string;
  waitTimeout: string;
}

const EMPTY_STEP: StepDraft = {
  kind: 'command',
  commandActions: [],
  sceneId: '',
  hueScene: '',
  title: '',
  body: '',
  notifyCamera: '',
  seconds: '60',
  waitEntityId: '',
  waitOp: 'is',
  waitValue: 'off',
  waitTimeout: '300',
};

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
  thresholdOp: 'below',
  thresholdValue: '5',
  intervalSeconds: '600',
};

/** «ist» vergleicht den Zustand, «über»/«unter» eine Zahl – für Helligkeit,
 *  Temperatur oder eine Anzahl anwesender Personen. */
type Compare = 'is' | 'above' | 'below';

interface StateCondition {
  entity_id: string;
  op: Compare;
  value: string;
}

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
  /** Zusätzliche Bedingungen «nur wenn Gerät … ist / über / unter». */
  stateConditions: StateCondition[];
  /** Wie die Bedingungen verknüpft sind: alle oder eine genügt. */
  match: 'all' | 'any';
  /** Erlaubte Wochentage der Uhrzeit-Bedingung (0 = Montag). Leer = alle. */
  weekdays: number[];
  /** Was der Ablauf tut – der Reihe nach. */
  steps: StepDraft[];
  /** Was stattdessen läuft, wenn die Bedingungen nicht passen. */
  elseSteps: StepDraft[];
  /** Frei benannte Kategorie zum Gruppieren in der Liste. */
  category: string;
  /** Ausgeschaltet: bleibt stehen, läuft aber nicht. */
  enabled: boolean;
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
  weekdays: [],
  steps: [{ ...EMPTY_STEP }],
  elseSteps: [],
  category: '',
  enabled: true,
};

/** Einen Trigger-Entwurf in die gespeicherte Form bringen (rein, testbar). */
function triggerToConfig(t: TriggerDraft): Record<string, any> {
  if (t.kind === 'sun') {
    return { type: 'sun', event: t.sunEvent, offset: Number(t.sunOffset) || 0 };
  }
  if (t.kind === 'time') {
    return { type: 'time', at: t.at };
  }
  if (t.kind === 'interval') {
    return { type: 'interval', seconds: Math.max(10, Number(t.intervalSeconds) || 600) };
  }
  if (t.kind === 'threshold') {
    // Löst beim Übertritt aus, nicht bei jeder Schwankung darunter: Der
    // Tumbler ist fertig, wenn die Leistung von «über 5 W» auf «unter 5 W»
    // fällt – nicht jedes Mal, wenn 2.1 W zu 2.0 W wird.
    const trigger: Record<string, any> = { type: 'state', entity_id: t.entityId };
    if (t.attribute) trigger.attribute = t.attribute;
    trigger[t.thresholdOp] = Number(t.thresholdValue) || 0;
    return trigger;
  }
  const state: Record<string, any> = { type: 'state', entity_id: t.entityId, to: t.toState };
  if (t.fromState) state.from = t.fromState;
  if (t.attribute) state.attribute = t.attribute;
  return state;
}

/** Umgekehrt: gespeicherter Trigger → Entwurf (rein, testbar). */
function triggerFromConfig(t: any): TriggerDraft {
  const threshold = t?.above !== undefined || t?.below !== undefined;
  return {
    ...EMPTY_TRIGGER,
    kind:
      t?.type === 'time'
        ? 'time'
        : t?.type === 'sun'
          ? 'sun'
          : t?.type === 'interval'
            ? 'interval'
            : threshold
              ? 'threshold'
              : 'state',
    entityId: t?.entity_id ?? '',
    toState: t?.to ?? 'on',
    fromState: t?.from ?? '',
    attribute: t?.attribute ?? '',
    at: t?.at ?? EMPTY_TRIGGER.at,
    sunEvent: t?.event === 'sunrise' ? 'sunrise' : 'sunset',
    sunOffset: String(t?.offset ?? 0),
    thresholdOp: t?.above !== undefined ? 'above' : 'below',
    thresholdValue: String(t?.above ?? t?.below ?? EMPTY_TRIGGER.thresholdValue),
    intervalSeconds: String(t?.seconds ?? EMPTY_TRIGGER.intervalSeconds),
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
        steps: [
          offScene
            ? { ...EMPTY_STEP, kind: 'scene' as StepKind, sceneId: offScene.id }
            : {
                ...EMPTY_STEP,
                commandActions: [{ entity_id: firstOff!.id, command: 'turn_off' }],
              },
        ],
      },
    });
  }
  const alarm = entities.find((entity) => entity.kind === 'alarm');
  if (presence && alarm) {
    // Die zwei Abläufe, die eine Alarmanlage im Alltag erst brauchbar
    // machen: Von Hand scharf schalten vergisst man genau einmal.
    templates.push({
      label: 'Scharf, wenn der Letzte geht',
      icon: 'lock-closed-outline',
      draft: {
        ...EMPTY,
        alias: 'Scharf, wenn niemand mehr da ist',
        triggers: [{ ...EMPTY_TRIGGER, entityId: presence.id, toState: 'off' }],
        steps: [{ ...EMPTY_STEP, commandActions: [{ entity_id: alarm.id, command: 'arm_away' }] }],
      },
    });
    templates.push({
      label: 'Unscharf beim Heimkommen',
      icon: 'lock-open-outline',
      draft: {
        ...EMPTY,
        alias: 'Unscharf, wenn jemand heimkommt',
        triggers: [{ ...EMPTY_TRIGGER, entityId: presence.id, toState: 'on' }],
        steps: [{ ...EMPTY_STEP, commandActions: [{ entity_id: alarm.id, command: 'disarm' }] }],
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
        steps: [
          {
            ...EMPTY_STEP,
            kind: 'notify' as StepKind,
            title: 'Es klingelt',
            body: 'Jemand steht vor der Tür.',
          },
        ],
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
        steps: [
          {
            ...EMPTY_STEP,
            kind: 'notify' as StepKind,
            title: `${appliance.name} ist fertig`,
            body: 'Das Programm ist durchgelaufen.',
          },
        ],
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
        steps: [
          {
            ...EMPTY_STEP,
            kind: 'notify' as StepKind,
            title: 'Unwetterwarnung',
            body: 'MeteoAlarm meldet eine Warnung für deine Region.',
          },
        ],
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
        steps: [{ ...EMPTY_STEP, commandActions: [{ entity_id: vacuum.id, command: 'clean_rooms', rooms: [] }] }],
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
        steps: [{ ...EMPTY_STEP, commandActions: [{ entity_id: cover.id, command: 'close' }] }],
      },
    });
    templates.push({
      label: 'Storen auf bei Sonnenaufgang',
      icon: 'sunny-outline',
      draft: {
        ...EMPTY,
        alias: 'Storen auf bei Sonnenaufgang',
        triggers: [{ ...EMPTY_TRIGGER, kind: 'sun', sunEvent: 'sunrise', sunOffset: '0' }],
        steps: [{ ...EMPTY_STEP, commandActions: [{ entity_id: cover.id, command: 'open' }] }],
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
          steps: [{ ...EMPTY_STEP, commandActions: [{ entity_id: cover.id, command: 'close' }] }],
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
  const [runs, setRuns] = useState<Run[]>([]);
  const [hueScenes, setHueScenes] = useState<string[]>([]);
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

    fetch(`${settings.url}/api/automations/runs`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setRuns(data?.runs ?? []))
      .catch(() => setRuns([]));

    fetch(`${settings.url}/api/hue/scenes`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setHueScenes(data?.scenes ?? []))
      .catch(() => setHueScenes([]));
  }, [settings.url, settings.token]);

  useEffect(load, [load]);

  const save = async () => {
    if (!draft) return;
    const body = {
      alias: draft.alias || 'Ohne Namen',
      trigger: draft.triggers.map(triggerToConfig),
      condition: buildConditions(draft),
      action: stepsToActions(draft.steps),
      otherwise: stepsToActions(draft.elseSteps),
      match: draft.match,
      enabled: draft.enabled,
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

  /** Kopie anlegen – sechs fast gleiche Taster-Abläufe tippt niemand. */
  const duplicate = async (id: string) => {
    await fetch(`${settings.url}/api/automations/${id}/duplicate`, {
      method: 'POST',
      headers,
    }).catch(() => {});
    load();
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

  /** Zeigt, was der Ablauf jetzt täte – ohne dass etwas passiert. */
  const dryRun = async (id: string): Promise<DryRun | null> => {
    try {
      const response = await fetch(`${settings.url}/api/automations/${id}/dryrun`, {
        headers,
      });
      if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
      return await response.json();
    } catch (err: any) {
      setError(String(err.message ?? err));
      return null;
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
        .map(({ entity_id, command, rooms, position }) => {
          if (command === 'clean_rooms') {
            return { entity_id, command, data: { rooms: rooms ?? [] } };
          }
          if (command === 'set_position') {
            return { entity_id, command, data: { position: position ?? 50 } };
          }
          return { entity_id, command };
        }),
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
                    <Text
                      style={[
                        styles.title,
                        automation.enabled === false && { color: colors.inkFaint },
                      ]}
                    >
                      {automation.alias}
                      {automation.enabled === false ? ' · aus' : ''}
                    </Text>
                    <Text style={styles.detail}>{describe(automation)}</Text>
                    <Text style={styles.detail}>{lastRunText(runs, automation.id)}</Text>
                  </View>
                  {automation.editable && mayEdit ? (
                    <>
                      <Pressable
                        onPress={() => duplicate(automation.id)}
                        accessibilityLabel={`${automation.alias} kopieren`}
                        style={styles.iconButton}
                      >
                        <Ionicons name="copy-outline" size={20} color={colors.inkSoft} />
                      </Pressable>
                      <Pressable
                        onPress={() => setDraft(toDraft(automation))}
                        accessibilityLabel={`${automation.alias} bearbeiten`}
                        style={styles.iconButton}
                      >
                        <Ionicons name="create-outline" size={20} color={colors.inkSoft} />
                      </Pressable>
                    </>
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
        hueScenes={hueScenes}
        onChange={setDraft}
        onSave={save}
        onDelete={draft?.id ? () => remove(draft.id!) : undefined}
        onTest={draft?.id ? () => test(draft.id!) : undefined}
        onDryRun={draft?.id ? () => dryRun(draft.id!) : undefined}
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

/** Zahlenfeld mit eigenem Zwischenstand – auf Modulebene, damit es beim
 *  Tippen nicht bei jedem Zeichen neu montiert wird. */
function NumberField({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [text, setText] = useState(value);
  return (
    <TextInput
      style={styles.input}
      value={text}
      onChangeText={setText}
      onBlur={() => onCommit(String(Number(text) || 0))}
      placeholder={placeholder}
      placeholderTextColor={colors.inkFaint}
      keyboardType="numbers-and-punctuation"
    />
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
  actions: {
    entity_id: string;
    command: string;
    rooms?: number[];
    /** Zielposition in Prozent, wenn das Kommando 'set_position' ist. */
    position?: number;
  }[];
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
    const options = [
      { key: 'open', label: 'hoch' },
      { key: 'close', label: 'runter' },
    ];
    // Halb runter für den Hitzeschutz – ganz zu wäre dunkel, ganz auf heiss.
    if (entity.commands.includes('set_position')) {
      options.push({ key: 'set_position', label: 'auf Position' });
    }
    return options;
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

  const setPosition = (entityId: string, position: number) =>
    onActions(
      actions.map((action) =>
        action.entity_id === entityId ? { ...action, position } : action
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
                    {action!.command === 'set_position' ? (
                      <Choice
                        options={[
                          { key: '25', label: '25 %' },
                          { key: '50', label: '50 %' },
                          { key: '75', label: '75 %' },
                        ]}
                        value={String(action!.position ?? 50)}
                        onSelect={(key) => setPosition(entity.id, Number(key))}
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
  hueScenes,
  onChange,
  onSave,
  onDelete,
  onTest,
  onDryRun,
  onCancel,
}: {
  draft: Draft | null;
  entities: Entity[];
  scenes: Scene[];
  /** Schon vergebene Kategorien – als Vorschläge im Feld. */
  categories: string[];
  /** Szenen der Hue-Bridge; leer, wenn keine Bridge verbunden ist. */
  hueScenes: string[];
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onDelete?: () => void;
  /** Nur bei gespeicherten Abläufen: einmal sofort ausführen. */
  onTest?: () => void;
  /** Nur bei gespeicherten Abläufen: zeigen, was jetzt passieren würde. */
  onDryRun?: () => Promise<DryRun | null>;
  onCancel: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tested, setTested] = useState(false);
  const [preview, setPreview] = useState<DryRun | null>(null);
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

        <Field label="Aktiv">
          <Choice
            options={[
              { key: 'on', label: 'läuft' },
              { key: 'off', label: 'aus' },
            ]}
            value={draft.enabled ? 'on' : 'off'}
            onSelect={(value) => set({ enabled: value === 'on' })}
          />
          {!draft.enabled ? (
            <Text style={styles.triggerNote}>
              Der Ablauf bleibt gespeichert, löst aber nicht aus – besser als
              löschen, wenn man ihn im Winter wieder braucht.
            </Text>
          ) : null}
        </Field>

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
          {draft.conditionKind === 'time' ? (
            <>
              <View style={styles.weekdayRow}>
                {WEEKDAY_LABELS.map((label, day) => {
                  const on = draft.weekdays.includes(day);
                  return (
                    <Pressable
                      key={day}
                      onPress={() =>
                        set({
                          weekdays: on
                            ? draft.weekdays.filter((entry) => entry !== day)
                            : [...draft.weekdays, day],
                        })
                      }
                      accessibilityRole="switch"
                      accessibilityState={{ checked: on }}
                      style={[styles.weekday, on && styles.weekdayOn]}
                    >
                      <Text style={[styles.weekdayText, on && styles.weekdayTextOn]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.triggerNote}>
                {draft.weekdays.length === 0
                  ? 'Kein Tag gewählt heisst jeden Tag.'
                  : `Nur ${weekdayLabel(draft.weekdays)}.`}
              </Text>
            </>
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
                      value:
                        entry.op === 'is'
                          ? fittingState(
                              entities.find((entity) => entity.id === entity_id),
                              entry.value
                            )
                          : entry.value,
                    })
                  }
                />
                <Choice
                  options={[
                    { key: 'is', label: 'ist' },
                    { key: 'above', label: 'über' },
                    { key: 'below', label: 'unter' },
                  ]}
                  value={entry.op}
                  onSelect={(op) =>
                    setEntry({
                      op: op as Compare,
                      // Beim Wechsel den Wert passend machen: «an» taugt
                      // nicht als Zahl und 30 nicht als Zustand.
                      value:
                        op === 'is'
                          ? fittingState(chosen, entry.value)
                          : String(Number(entry.value) || 0),
                    })
                  }
                />
                {entry.op === 'is' ? (
                  <Choice
                    options={stateOptions(chosen)}
                    value={entry.value}
                    onSelect={(value) => setEntry({ value })}
                  />
                ) : (
                  <NumberField
                    value={entry.value}
                    onCommit={(value) => setEntry({ value })}
                    placeholder="z.B. 30"
                  />
                )}
                {entry.op !== 'is' ? (
                  <Text style={styles.triggerNote}>
                    Vergleicht den Zahlenwert des Geräts – etwa die Helligkeit
                    eines Dämmerungssensors oder die Anzahl anwesender
                    Personen.
                  </Text>
                ) : null}
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
                    op: 'is' as Compare,
                    value: fittingState(entities[0], 'on'),
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

        <Field label="… dann das tun">
          <StepList
            steps={draft.steps}
            entities={entities}
            scenes={scenes}
            hueScenes={hueScenes}
            colors={colors}
            styles={styles}
            onChange={(steps) => set({ steps })}
          />
        </Field>

        <Field label="… sonst">
          {draft.elseSteps.length === 0 ? (
            <>
              <Pressable
                onPress={() => set({ elseSteps: [{ ...EMPTY_STEP }] })}
                accessibilityRole="button"
                style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
              >
                <Ionicons name="git-branch-outline" size={16} color={colors.accent} />
                <Text style={styles.addRowText}>Zweig für «Bedingung passt nicht»</Text>
              </Pressable>
              <Text style={styles.triggerNote}>
                Ohne diesen Zweig passiert schlicht nichts, wenn eine
                Bedingung nicht stimmt. Mit ihm spart man sich den zweiten
                Ablauf mit gegenteiliger Bedingung – den man sonst beim
                Ändern jedes Mal mit anfassen muss.
              </Text>
            </>
          ) : (
            <StepList
              steps={draft.elseSteps}
              entities={entities}
              scenes={scenes}
              hueScenes={hueScenes}
              colors={colors}
              styles={styles}
              onChange={(elseSteps) => set({ elseSteps })}
            />
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
        {onDryRun ? (
          <Pressable
            style={({ pressed }) => [styles.snapshot, pressed && { opacity: 0.8 }]}
            onPress={async () => setPreview(await onDryRun())}
            accessibilityRole="button"
          >
            <Ionicons name="eye-outline" size={18} color={colors.accent} />
            <Text style={styles.snapshotText}>Trockenlauf</Text>
          </Pressable>
        ) : null}
        {preview ? (
          <View style={styles.preview}>
            <Text style={styles.previewHead}>
              {preview.conditions_hold
                ? 'Die Bedingungen passen gerade.'
                : 'Die Bedingungen passen gerade nicht:'}
            </Text>
            {preview.skipped.map((reason, index) => (
              <Text key={index} style={styles.previewLine}>
                • {reason}
              </Text>
            ))}
            <Text style={styles.previewHead}>
              {preview.would_run.length === 0
                ? 'Es würde nichts passieren.'
                : `Es würde passieren (${preview.branch}):`}
            </Text>
            {preview.would_run.map((line, index) => (
              <Text key={index} style={styles.previewLine}>
                {index + 1}. {line}
              </Text>
            ))}
          </View>
        ) : null}
        {onTest ? (
          <Text style={styles.snapshotHint}>
            «Jetzt testen» führt die Aktionen wirklich aus – ohne auf Auslöser
            oder Bedingung zu warten. Der Trockenlauf zeigt nur, was passieren
            würde. Gespeicherte Änderungen zuerst sichern.
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
          { key: 'threshold', label: 'Messwert' },
          { key: 'time', label: 'Uhrzeit' },
          { key: 'sun', label: 'Sonnenstand' },
          { key: 'interval', label: 'Regelmässig' },
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
      ) : trigger.kind === 'threshold' ? (
        <>
          <Picker
            items={entities.map((entity) => ({ key: entity.id, label: entity.name }))}
            value={trigger.entityId}
            onSelect={(entityId) => onChange({ entityId })}
          />
          <TextInput
            style={styles.input}
            value={trigger.attribute}
            onChangeText={(attribute) => onChange({ attribute })}
            placeholder="Feld, z.B. power oder temperature (leer = state)"
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
          />
          <View style={styles.rowGap}>
            <Choice
              options={[
                { key: 'above', label: 'steigt über' },
                { key: 'below', label: 'fällt unter' },
              ]}
              value={trigger.thresholdOp}
              onSelect={(thresholdOp) =>
                onChange({ thresholdOp: thresholdOp as TriggerDraft['thresholdOp'] })
              }
            />
          </View>
          <TextInput
            style={styles.input}
            value={trigger.thresholdValue}
            onChangeText={(thresholdValue) => onChange({ thresholdValue })}
            placeholder="5"
            placeholderTextColor={colors.inkFaint}
            keyboardType="numbers-and-punctuation"
          />
          <Text style={styles.triggerNote}>
            Löst beim Übertritt aus, nicht bei jeder Schwankung darunter: Der
            Tumbler ist fertig, wenn die Leistung von über 5 W auf unter 5 W
            fällt – nicht jedes Mal, wenn 2.1 W zu 2.0 W wird.
          </Text>
        </>
      ) : trigger.kind === 'interval' ? (
        <>
          <Choice
            options={[
              { key: '300', label: '5 Min.' },
              { key: '600', label: '10 Min.' },
              { key: '1800', label: '30 Min.' },
              { key: '3600', label: '1 Std.' },
            ]}
            value={trigger.intervalSeconds}
            onSelect={(intervalSeconds) => onChange({ intervalSeconds })}
          />
          <Text style={styles.triggerNote}>
            Läuft immer wieder, unabhängig von einem Gerät. Sinnvoll mit einer
            Bedingung davor – sonst passiert es rund um die Uhr.
          </Text>
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

/**
 * Die Aktionsliste: nacheinander abgearbeitete Schritte.
 *
 * Vorher gab es genau eine Aktionsart je Ablauf. «Licht an, zwei Minuten
 * warten, Nachricht schicken» brauchte deshalb drei Abläufe, die sich
 * gegenseitig auslösen – und beim Ändern musste man alle drei finden.
 *
 * Auf Modulebene und nicht im Editor verschachtelt: Eine dort definierte
 * Komponente wäre bei jedem Tastendruck eine neue und würde das
 * Eingabefeld beim Tippen jedes Mal neu aufbauen.
 */
function StepList({
  steps,
  entities,
  scenes,
  hueScenes,
  colors,
  styles,
  onChange,
}: {
  steps: StepDraft[];
  entities: Entity[];
  scenes: Scene[];
  hueScenes: string[];
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  onChange: (steps: StepDraft[]) => void;
}) {
  const setStep = (index: number, patch: Partial<StepDraft>) =>
    onChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  const remove = (index: number) => onChange(steps.filter((_, i) => i !== index));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <>
      {steps.map((step, index) => (
        <View key={index} style={styles.stepBox}>
          <View style={styles.stepHead}>
            <Text style={styles.stepNumber}>{index + 1}.</Text>
            <View style={{ flex: 1 }} />
            {steps.length > 1 ? (
              <>
                <Pressable
                  onPress={() => move(index, -1)}
                  accessibilityLabel="Nach oben"
                  hitSlop={8}
                >
                  <Ionicons
                    name="chevron-up"
                    size={18}
                    color={index === 0 ? colors.inkFaint : colors.ink}
                  />
                </Pressable>
                <Pressable
                  onPress={() => move(index, 1)}
                  accessibilityLabel="Nach unten"
                  hitSlop={8}
                >
                  <Ionicons
                    name="chevron-down"
                    size={18}
                    color={index === steps.length - 1 ? colors.inkFaint : colors.ink}
                  />
                </Pressable>
              </>
            ) : null}
            <Pressable
              onPress={() => remove(index)}
              accessibilityLabel="Schritt entfernen"
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </Pressable>
          </View>

          <Choice
            options={[
              { key: 'command', label: 'Gerät schalten' },
              { key: 'scene', label: 'Szene' },
              ...(hueScenes.length > 0 ? [{ key: 'hue_scene', label: 'Hue-Szene' }] : []),
              { key: 'notify', label: 'Nachricht' },
              { key: 'delay', label: 'Warten' },
              { key: 'wait_until', label: 'Warten bis' },
            ]}
            value={step.kind}
            onSelect={(kind) => setStep(index, { kind: kind as StepKind })}
          />

          {step.kind === 'command' ? (
            <SceneDevices
              entities={entities}
              actions={step.commandActions}
              onActions={(commandActions) => setStep(index, { commandActions })}
              showSnapshot={false}
              allowToggle
            />
          ) : step.kind === 'scene' ? (
            <Picker
              items={scenes.map((scene) => ({ key: scene.id, label: scene.name }))}
              placeholder="Szene suchen …"
              value={step.sceneId}
              onSelect={(sceneId) => setStep(index, { sceneId })}
            />
          ) : step.kind === 'hue_scene' ? (
            <>
              <Picker
                items={hueScenes.map((name) => ({ key: name, label: name }))}
                placeholder="Hue-Szene suchen …"
                value={step.hueScene}
                onSelect={(hueScene) => setStep(index, { hueScene })}
              />
              <Text style={styles.triggerNote}>
                Die Szene liegt auf der Hue-Bridge – Farben und Helligkeiten
                stecken dort, und nur sie kann alles in einem Zug setzen.
                Geändert wird sie in der Hue-App.
              </Text>
            </>
          ) : step.kind === 'notify' ? (
            <>
              <TextInput
                style={styles.input}
                value={step.title}
                onChangeText={(title) => setStep(index, { title })}
                placeholder="Titel"
                placeholderTextColor={colors.inkFaint}
              />
              <TextInput
                style={styles.input}
                value={step.body}
                onChangeText={(body) => setStep(index, { body })}
                placeholder="Text"
                placeholderTextColor={colors.inkFaint}
              />
              <Picker
                items={[
                  { key: '', label: 'Kein Bild' },
                  ...entities
                    .filter((entity) => entity.kind === 'camera')
                    .map((entity) => ({ key: entity.id, label: entity.name })),
                ]}
                placeholder="Kamera fürs Bild suchen …"
                value={step.notifyCamera}
                onSelect={(notifyCamera) => setStep(index, { notifyCamera })}
              />
              <Text style={styles.triggerNote}>
                Mit einer Kamera zeigt die Nachricht gleich das Bild von
                diesem Moment – praktisch, wenn es klingelt. Dafür muss in
                der config.yaml des Hubs unter „push“ eine von aussen
                erreichbare Adresse stehen, sonst kommt die Nachricht ohne
                Bild an. Auf dem iPhone braucht es zusätzlich einen eigenen
                App-Build (siehe docs/eigener-app-build.md).
              </Text>
            </>
          ) : step.kind === 'delay' ? (
            <>
              <Choice
                options={[
                  { key: '30', label: '30 Sek.' },
                  { key: '60', label: '1 Min.' },
                  { key: '300', label: '5 Min.' },
                  { key: '600', label: '10 Min.' },
                  { key: '1800', label: '30 Min.' },
                ]}
                value={step.seconds}
                onSelect={(seconds) => setStep(index, { seconds })}
              />
              <Text style={styles.triggerNote}>
                Wartet {delayLabel(step.seconds)}, bevor es weitergeht.
              </Text>
            </>
          ) : (
            <>
              <Picker
                items={entities.map((entity) => ({ key: entity.id, label: entity.name }))}
                placeholder="Gerät suchen …"
                value={step.waitEntityId}
                onSelect={(waitEntityId) => setStep(index, { waitEntityId })}
              />
              <Choice
                options={[
                  { key: 'is', label: 'ist' },
                  { key: 'above', label: 'über' },
                  { key: 'below', label: 'unter' },
                ]}
                value={step.waitOp}
                onSelect={(waitOp) => setStep(index, { waitOp: waitOp as Compare })}
              />
              <TextInput
                style={styles.input}
                value={step.waitValue}
                onChangeText={(waitValue) => setStep(index, { waitValue })}
                placeholder={step.waitOp === 'is' ? 'off' : '5'}
                placeholderTextColor={colors.inkFaint}
              />
              <Choice
                options={[
                  { key: '60', label: 'max. 1 Min.' },
                  { key: '300', label: 'max. 5 Min.' },
                  { key: '900', label: 'max. 15 Min.' },
                  { key: '3600', label: 'max. 1 Std.' },
                ]}
                value={step.waitTimeout}
                onSelect={(waitTimeout) => setStep(index, { waitTimeout })}
              />
              <Text style={styles.triggerNote}>
                Wartet, bis es so weit ist – etwa bis die Tür wieder zu ist.
                Die Frist muss sein: Bleibt die Tür offen, ginge der Ablauf
                sonst nie zu Ende und blockierte auch jeden weiteren Lauf.
              </Text>
            </>
          )}
        </View>
      ))}

      <Pressable
        onPress={() => onChange([...steps, { ...EMPTY_STEP }])}
        accessibilityRole="button"
        style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
      >
        <Ionicons name="add" size={16} color={colors.accent} />
        <Text style={styles.addRowText}>Schritt hinzufügen</Text>
      </Pressable>
    </>
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

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** «Werktage», «Wochenende» oder die Kürzel (rein, testbar). */
function weekdayLabel(days: number[]): string {
  const chosen = new Set(days);
  if (chosen.size === 0 || chosen.size === 7) return 'jeden Tag';
  if (chosen.size === 5 && [0, 1, 2, 3, 4].every((day) => chosen.has(day))) {
    return 'Werktage';
  }
  if (chosen.size === 2 && chosen.has(5) && chosen.has(6)) return 'am Wochenende';
  return [...chosen]
    .sort((a, b) => a - b)
    .map((day) => WEEKDAY_LABELS[day])
    .join(', ');
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
    // Alle sieben Tage anzugeben heisst dasselbe wie keinen – dann lieber
    // das Feld weglassen, damit die gespeicherte Form schlank bleibt.
    if (draft.weekdays.length > 0 && draft.weekdays.length < 7) {
      condition.weekdays = [...draft.weekdays].sort((a, b) => a - b);
    }
    // Eine Bedingung ganz ohne Angabe wäre sinnlos – dann keine.
    if (condition.after || condition.before || condition.weekdays) {
      conditions.push(condition);
    }
  }
  for (const entry of draft.stateConditions) {
    if (!entry.entity_id) continue;
    if (entry.op === 'above') {
      conditions.push({ type: 'state', entity_id: entry.entity_id, above: Number(entry.value) || 0 });
    } else if (entry.op === 'below') {
      conditions.push({ type: 'state', entity_id: entry.entity_id, below: Number(entry.value) || 0 });
    } else {
      conditions.push({ type: 'state', entity_id: entry.entity_id, equals: entry.value });
    }
  }
  return conditions;
}

/** Einen einzelnen Schritt in die gespeicherte Form (rein, testbar).
 *
 * Ein Schritt kann mehrere Aktionen ergeben: «Gerät schalten» mit drei
 * angehakten Lampen sind drei Kommandos.
 */
function stepToActions(step: StepDraft): Record<string, any>[] {
  if (step.kind === 'scene') {
    return step.sceneId ? [{ type: 'scene', scene: step.sceneId }] : [];
  }
  if (step.kind === 'hue_scene') {
    return step.hueScene ? [{ type: 'hue_scene', scene: step.hueScene }] : [];
  }
  if (step.kind === 'notify') {
    return [
      {
        type: 'notify',
        to: 'all',
        title: step.title,
        body: step.body,
        ...(step.notifyCamera ? { camera: step.notifyCamera } : {}),
      },
    ];
  }
  if (step.kind === 'delay') {
    const seconds = Number(step.seconds) || 0;
    return seconds > 0 ? [{ type: 'delay', seconds }] : [];
  }
  if (step.kind === 'wait_until') {
    if (!step.waitEntityId) return [];
    const action: Record<string, any> = {
      type: 'wait_until',
      entity_id: step.waitEntityId,
      timeout: Number(step.waitTimeout) || 300,
    };
    if (step.waitOp === 'above') action.above = Number(step.waitValue) || 0;
    else if (step.waitOp === 'below') action.below = Number(step.waitValue) || 0;
    else action.equals = step.waitValue;
    return [action];
  }
  return step.commandActions
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
      if (action.command === 'set_position') {
        built.data = { position: action.position ?? 50 };
      }
      return built;
    });
}

/** Alle Schritte der Reihe nach (rein, testbar). */
function stepsToActions(steps: StepDraft[]): Record<string, any>[] {
  return steps.flatMap(stepToActions);
}

/**
 * Gespeicherte Aktionen zurück in Schritte (rein, testbar).
 *
 * Aufeinanderfolgende Kommandos werden zu *einem* Schritt zusammengefasst –
 * so, wie sie im Editor auch angelegt wurden. Ohne das würde aus einer
 * Checkliste mit drei Lampen beim nächsten Öffnen eine Liste aus drei
 * Schritten, und die Bedienung wüchse mit jedem Speichern.
 */
function actionsToSteps(actions: Record<string, any>[]): StepDraft[] {
  const steps: StepDraft[] = [];
  for (const action of actions ?? []) {
    const type = action.type ?? 'command';
    if (type === 'command') {
      const entry = {
        entity_id: action.entity_id,
        command: action.command ?? 'turn_on',
        rooms: action.data?.rooms ?? [],
        position: action.data?.position,
      };
      const last = steps[steps.length - 1];
      if (last && last.kind === 'command') {
        last.commandActions = [...last.commandActions, entry];
      } else {
        steps.push({ ...EMPTY_STEP, kind: 'command', commandActions: [entry] });
      }
    } else if (type === 'scene') {
      steps.push({ ...EMPTY_STEP, kind: 'scene', sceneId: action.scene ?? '' });
    } else if (type === 'hue_scene') {
      steps.push({ ...EMPTY_STEP, kind: 'hue_scene', hueScene: action.scene ?? '' });
    } else if (type === 'notify') {
      steps.push({
        ...EMPTY_STEP,
        kind: 'notify',
        title: action.title ?? '',
        body: action.body ?? '',
        notifyCamera: action.camera ?? '',
      });
    } else if (type === 'delay') {
      steps.push({ ...EMPTY_STEP, kind: 'delay', seconds: String(action.seconds ?? 60) });
    } else if (type === 'wait_until') {
      steps.push({
        ...EMPTY_STEP,
        kind: 'wait_until',
        waitEntityId: action.entity_id ?? '',
        waitOp: ('above' in action ? 'above' : 'below' in action ? 'below' : 'is') as Compare,
        waitValue: String(action.above ?? action.below ?? action.equals ?? 'off'),
        waitTimeout: String(action.timeout ?? 300),
      });
    }
  }
  return steps;
}

function toDraft(automation: Automation): Draft {
  const triggers = (automation.triggers ?? []).map(triggerFromConfig);
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
      .map((entry) => ({
        entity_id: entry.entity_id,
        op: ('above' in entry ? 'above' : 'below' in entry ? 'below' : 'is') as Compare,
        value: String(entry.above ?? entry.below ?? entry.equals ?? 'on'),
      })),
    match: automation.match === 'any' ? 'any' : 'all',
    weekdays: Array.isArray(condition.weekdays) ? condition.weekdays.map(Number) : [],
    steps: withAtLeastOne(actionsToSteps(automation.actions ?? [])),
    elseSteps: actionsToSteps(automation.otherwise ?? []),
    category: automation.category ?? '',
    enabled: automation.enabled !== false,
  };
}

/** Ein Ablauf ohne einen einzigen Schritt wäre im Editor eine leere Seite. */
function withAtLeastOne(steps: StepDraft[]): StepDraft[] {
  return steps.length > 0 ? steps : [{ ...EMPTY_STEP }];
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
  // Wie viele Schritte noch folgen – seit ein Ablauf mehrere Arten mischen
  // kann, sagt die erste Aktion allein zu wenig.
  const weitere = Math.max(0, (automation.actions?.length ?? 0) - 1);
  const rest = weitere > 0 ? ` +${weitere}` : '';
  const wartet = (automation.actions ?? []).some(
    (entry) => entry.type === 'delay' || entry.type === 'wait_until'
  )
    ? ' ⏱'
    : '';
  const sonst = (automation.otherwise?.length ?? 0) > 0 ? ' · mit sonst-Zweig' : '';
  return `${wenn}${mehr} → ${dann}${rest}${wartet}${sonst}`;
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
    stepBox: {
      gap: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    stepHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    preview: {
      gap: 4,
      padding: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    previewHead: { color: colors.ink, fontSize: 13, fontWeight: '700', marginTop: 4 },
    previewLine: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
    weekdayRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
    weekday: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surface,
    },
    weekdayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    weekdayText: { color: colors.inkSoft, fontSize: 13, fontWeight: '700' },
    weekdayTextOn: { color: '#FFFFFF' },
    stepNumber: { color: colors.inkSoft, fontSize: 13, fontWeight: '700' },
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
