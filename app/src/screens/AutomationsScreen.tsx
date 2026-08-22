import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Entity, HubSettings, Scene, User } from '../api/types';
import { Card } from '../components/Card';
import { PushRules } from '../components/PushRules';
import { Fehlschlag, Laedt } from '../components/Zustand';
import { Colors, radius, space, type, useColors } from '../theme';
import { deviceKindIcon, deviceKindLabel } from '../lib/geraeteart';
import { SceneActionDraft, sceneActionsToDraft, snapshotAction } from '../lib/szenen';

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
  mode?: string;
  /** Ausgeschaltete Abläufe bleiben stehen, laufen aber nicht. */
  enabled?: boolean;
}

/** Je Auslöser: kam er überhaupt an? Antwort von /diagnose. */
interface TriggerHealth {
  type: string;
  entity_id?: string;
  ok: boolean;
  hinweis: string;
  zuletzt_gefeuert_vor?: number | null;
  zuletzt_gemeldet_vor?: number | null;
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
/** Deutsche Namen der Messwerte, die in Bedingungen taugen. */
const MEASURE_LABELS: Record<string, string> = {
  illumination: 'Helligkeit (Lux)',
  temperature: 'Temperatur',
  humidity: 'Feuchte',
  power: 'Leistung (W)',
  brightness: 'Helligkeit (%)',
  battery: 'Batterie (%)',
  position: 'Position (%)',
  tilt: 'Lamellen (%)',
  count: 'Anzahl',
  home: 'Anwesend',
  probe_1: 'Grill-Sonde 1 (°C)',
  probe_2: 'Grill-Sonde 2 (°C)',
  probe_3: 'Grill-Sonde 3 (°C)',
  probe_4: 'Grill-Sonde 4 (°C)',
};

/** Welche Zahlenwerte dieses Gerät liefert (rein, testbar).
 *
 *  Ein Präsenzmelder meldet «an/aus» – aber daneben oft auch die
 *  Helligkeit in Lux. Genau die will man vergleichen: «nur wenn unter 20»
 *  ist die ehrliche Regel für «es ist dunkel», der Sonnenstand weiss
 *  nichts von einem trüben Novembernachmittag.
 *
 *  Nur bekannte Messwerte, nicht jedes Zahlenfeld: Ein Ablauf auf
 *  «members_on» wäre technisch möglich und praktisch Unsinn. */
export function measurableAttributes(
  entity?: Entity
): { key: string; label: string }[] {
  if (!entity) return [];
  return Object.keys(MEASURE_LABELS)
    .filter((key) => {
      const value = (entity.state as Record<string, unknown>)[key];
      return typeof value === 'number';
    })
    .map((key) => ({ key, label: MEASURE_LABELS[key] }));
}

/**
 * Die Zustände, auf die sich ein Ablauf stützen kann.
 *
 * Meist ist das der Zustand selbst («an», «offen»). Manche Geräte melden
 * daneben Ereignisse in eigenen Feldern: Eine Türklingel klingelt, eine
 * Kamera sieht Bewegung – beides steht nicht in `state`, sondern in
 * `ring` bzw. `motion`. Solche Optionen tragen deshalb ihr Feld mit sich
 * und einen zusammengesetzten Schlüssel, damit «an» (Zustand) und «an»
 * (klingelt) auseinanderzuhalten sind.
 */
export interface StateOption {
  /** Eindeutig über alle Felder: 'on', 'ring:on', 'motion:on'. */
  key: string;
  label: string;
  /** Zustandsfeld, falls nicht `state`. */
  attribute?: string;
  /** Der Wert, auf den gewartet wird. */
  to: string;
}

/** Schlüssel aus dem, was im Ablauf steht – fürs Wiederfinden der Auswahl. */
export function optionKey(attribute: string | undefined, to: string): string {
  return attribute ? `${attribute}:${to}` : to;
}

export function stateOptions(entity?: Entity): StateOption[] {
  const ereignisse: StateOption[] = [];
  // Nur, was das Gerät auch meldet: Ein Auslöser für ein Feld, das nie
  // kommt, wäre eine Attrappe.
  if (entity && 'ring' in entity.state) {
    ereignisse.push({ key: 'ring:on', label: 'klingelt', attribute: 'ring', to: 'on' });
  }
  if (entity && 'motion' in entity.state) {
    ereignisse.push({
      key: 'motion:on',
      label: 'sieht Bewegung',
      attribute: 'motion',
      to: 'on',
    });
  }
  return [
    ...ereignisse,
    ...plainStates(entity).map((zustand) => ({ ...zustand, to: zustand.key })),
  ];
}

/** Die Zustände des Felds `state` selbst, je Geräteart. */
function plainStates(entity?: Entity): { key: string; label: string }[] {
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
 *  sonst «an» bei einem Taster (rein, testbar).
 *
 *  Nur Zustände, keine Ereignisse: «klingelt» ist ein Augenblick und
 *  taugt als Bedingung nicht – wenn der Ablauf sie prüft, ist er längst
 *  vorbei. */
export function fittingState(entity: Entity | undefined, current: string): string {
  const options = conditionOptions(entity);
  return options.some((option) => option.key === current) ? current : options[0].key;
}

/** Was sich als Bedingung prüfen lässt: der Zustand selbst. */
export function conditionOptions(entity?: Entity): StateOption[] {
  return stateOptions(entity).filter((option) => !option.attribute);
}

/** Feld und Wert eines Auslösers, passend zum neuen Gerät (rein, testbar).
 *
 *  Beim Gerätewechsel muss beides mitwandern: «klingelt» ergibt bei einer
 *  Lampe keinen Sinn, und ein Feld, das dort nie gefüllt wird, wäre ein
 *  Auslöser, auf den man vergeblich wartet. */
export function fittingTrigger(
  entity: Entity | undefined,
  attribute: string,
  to: string
): { attribute: string; toState: string } {
  const options = stateOptions(entity);
  const key = optionKey(attribute || undefined, to);
  const treffer = options.find((option) => option.key === key) ?? options[0];
  return { attribute: treffer.attribute ?? '', toState: treffer.to };
}

/** Was dieser Ablauf zuletzt getan hat – und warum nicht (rein, testbar).
 *
 * Beantwortet den häufigsten Support-Fall direkt in der Liste: «geht
 * nicht» heisst fast immer, dass eine Bedingung im Weg war. */
export function runLine(run: Run): string {
  const time = new Date(run.at * 1000).toLocaleString('de-CH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (run.error) return `${time} · Fehler: ${run.error}`;
  if (run.executed) return `${time} · ausgeführt`;
  if (run.skipped.length > 0) return `${time} · übersprungen: ${run.skipped.join('; ')}`;
  return `${time} · übersprungen`;
}

export function lastRunText(runs: Run[], automationId: string): string {
  const run = runs.find((entry) => entry.automation_id === automationId);
  if (!run) return 'Noch nicht gelaufen';
  return runLine(run);
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
type TriggerKind = 'state' | 'threshold' | 'interval' | 'time' | 'sun' | 'geofence';
type StepKind = 'command' | 'scene' | 'hue_scene' | 'notify' | 'broadcast' | 'delay' | 'wait_until';
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
  /** Erst auslösen, wenn der Zustand so lange bestehen bleibt (Minuten).
   *  «Alle weg» heisst erst nach zehn Minuten wirklich alle weg - nicht
   *  beim kurzen Gang zum Briefkasten. Leer = sofort. */
  forMinutes: string;
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
    brightness?: number;
    color?: string;
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
  /** Durchsage: was gesagt wird, und auf welchen Boxen (leer = alle). */
  broadcastText: string;
  broadcastSpeakers: string[];
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
  broadcastText: '',
  broadcastSpeakers: [],
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
  forMinutes: '',
};

/** «ist» vergleicht den Zustand, «über»/«unter» eine Zahl – für Helligkeit,
 *  Temperatur oder eine Anzahl anwesender Personen. */
type Compare = 'is' | 'above' | 'below';

interface StateCondition {
  entity_id: string;
  op: Compare;
  value: string;
  /** Welcher Messwert verglichen wird. Leer = der Zustand selbst. */
  attribute?: string;
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
  /** Was geschieht, wenn er noch läuft und erneut ausgelöst wird:
   *  «single» verwirft den zweiten Auslöser, «restart» beginnt von vorn. */
  mode: 'single' | 'restart';
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
  mode: 'single',
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
  const hold = Math.max(0, Number(t.forMinutes) || 0) * 60;
  if (t.kind === 'threshold') {
    // Löst beim Übertritt aus, nicht bei jeder Schwankung darunter: Der
    // Tumbler ist fertig, wenn die Leistung von «über 5 W» auf «unter 5 W»
    // fällt – nicht jedes Mal, wenn 2.1 W zu 2.0 W wird.
    const trigger: Record<string, any> = { type: 'state', entity_id: t.entityId };
    if (t.attribute) trigger.attribute = t.attribute;
    trigger[t.thresholdOp] = Number(t.thresholdValue) || 0;
    if (hold > 0) trigger.for = hold;
    return trigger;
  }
  if (t.kind === 'geofence') {
    // Ein Geofence ist im Hub ein gewöhnlicher Zustand (home/away) – der
    // eigene Auslöser-Typ ist reine Bedienhilfe, damit niemand wissen
    // muss, dass «Stefan kommt heim» ein Zustandswechsel ist.
    const trigger: Record<string, any> = { type: 'state', entity_id: t.entityId, to: t.toState };
    if (hold > 0) trigger.for = hold;
    return trigger;
  }
  const state: Record<string, any> = { type: 'state', entity_id: t.entityId, to: t.toState };
  if (t.fromState) state.from = t.fromState;
  if (t.attribute) state.attribute = t.attribute;
  if (hold > 0) state.for = hold;
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
              : String(t?.entity_id ?? '').startsWith('geofence.')
                ? 'geofence'
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
    forMinutes: t?.for ? String(Math.round(Number(t.for) / 60)) : '',
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
  // Alles, was klingeln kann - die Gegensprechanlage an der Haustüre
  // ebenso wie eine Türklingel mit Kamera. Vorher wurde nach «last_ring»
  // gesucht: Das entsteht erst beim ersten Klingeln, und die Vorlage für
  // «Nachricht, wenn es klingelt» tauchte deshalb erst auf, nachdem man
  // sie schon gebraucht hätte.
  const doorbell = entities.find((entity) => 'ring' in entity.state);
  const appliance = entities.find((entity) => entity.kind === 'appliance');
  const alert = entities.find((entity) => entity.kind === 'alert');
  const vacuum = entities.find((entity) => entity.commands.includes('clean_rooms'));
  const grill = entities.find((entity) =>
    Object.keys(entity.state ?? {}).some((key) => key.startsWith('probe_'))
  );
  // Bewusst alle, nicht der erste Fund: Eine Store am Abend zu schliessen
  // und die übrigen offen zu lassen, ist keine Automation, sondern ein
  // Versehen. Einzelne abwählen kann man im Editor immer noch.
  const covers = entities.filter((entity) => entity.kind === 'cover');
  const cover = covers[0];
  // Jedes Gerät, das seinen Ladestand meldet - Türsensor, Schloss,
  // Thermostat. Ein Ablauf mit einem Auslöser je Gerät ist hier richtig:
  // Sonst überwacht man eine Batterie und übersieht die anderen sieben.
  const batteries = entities.filter(
    (entity) => typeof entity.state?.battery === 'number'
  );
  // Bewegungsmelder: als eigene Entität (device_class 'motion', etwa der
  // HmIP-SMI), notfalls am Namen, sonst als Feld an einer Kamera. Der
  // eigene Melder hat Vorrang - er sitzt im Raum, die Kamera schaut ihn
  // bloss an.
  const motion =
    entities.find((entity) => entity.state?.device_class === 'motion') ??
    entities.find(
      (entity) =>
        entity.kind === 'binary_sensor' && /bewegung|motion/i.test(entity.name)
    ) ??
    entities.find((entity) => 'motion' in (entity.state ?? {}));
  const offScene = scenes.find((scene) => scene.id === 'alles_aus');
  // Ohne Szene «Alles aus»: alle Lichter. Ein einzelnes beliebiges Gerät
  // auszuschalten wäre kein Anfang, den man nur noch speichern muss.
  const allLights = entities.filter(
    (entity) => entity.kind === 'light' && entity.commands.includes('turn_off')
  );

  if (motion && allLights.length > 0) {
    // Der häufigste Ablauf überhaupt - und der, bei dem man am ehesten an
    // der falschen Stelle landet: ohne «Wartezeit neu starten» geht im
    // Flur das Licht aus, während man noch davorsteht.
    const light =
      allLights.find((entity) => entity.room && entity.room === motion.room) ??
      allLights[0];
    templates.push({
      label: 'Licht bei Bewegung, mit Nachlauf',
      icon: 'walk-outline',
      draft: {
        ...EMPTY,
        alias: `Licht bei Bewegung${motion.room ? ` ${motion.room}` : ''}`,
        // «von vorn beginnen»: Jede neue Bewegung verlängert die Zeit.
        // Ohne das ginge das Licht vier Minuten nach der ersten Bewegung
        // aus - mitten im Betrieb.
        mode: 'restart',
        triggers: [
          {
            ...EMPTY_TRIGGER,
            entityId: motion.id,
            toState: 'on',
            attribute: 'motion' in (motion.state ?? {}) ? 'motion' : '',
          },
        ],
        // Nur wenn es dunkel ist. Am gemessenen Lux, falls der Melder ihn
        // liefert - der Sonnenstand weiss nichts von einem trüben
        // Novembernachmittag.
        ...(typeof motion.state?.illumination === 'number'
          ? {
              stateConditions: [
                {
                  entity_id: motion.id,
                  op: 'below' as Compare,
                  value: '20',
                  attribute: 'illumination',
                },
              ],
            }
          : { conditionKind: 'sun' as ConditionKind, conditionSun: 'down' as const }),
        steps: [
          {
            ...EMPTY_STEP,
            commandActions: [{ entity_id: light.id, command: 'turn_on' }],
          },
          { ...EMPTY_STEP, kind: 'delay' as StepKind, seconds: '240' },
          {
            ...EMPTY_STEP,
            commandActions: [{ entity_id: light.id, command: 'turn_off' }],
          },
        ],
      },
    });
  }

  if (presence && (offScene || allLights.length > 0)) {
    templates.push({
      label: 'Alles aus, wenn niemand da',
      icon: 'exit-outline',
      draft: {
        ...EMPTY,
        alias: 'Alles aus, wenn niemand zuhause',
        // Zehn Minuten Haltezeit: Der Gang zum Briefkasten ist kein Auszug.
        triggers: [
          { ...EMPTY_TRIGGER, entityId: presence.id, toState: 'off', forMinutes: '10' },
        ],
        steps: [
          offScene
            ? { ...EMPTY_STEP, kind: 'scene' as StepKind, sceneId: offScene.id }
            : {
                ...EMPTY_STEP,
                commandActions: allLights.map((entity) => ({
                  entity_id: entity.id,
                  command: 'turn_off',
                })),
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
        triggers: [
          { ...EMPTY_TRIGGER, entityId: presence.id, toState: 'off', forMinutes: '10' },
        ],
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
    if (entities.some((entity) => entity.commands.includes('play_url'))) {
      // Wer die Klingel im Garten oder mit Kopfhörern verpasst, hört
      // sie über die Boxen trotzdem.
      templates.push({
        label: 'Klingel-Ansage auf den Boxen',
        icon: 'megaphone-outline',
        draft: {
          ...EMPTY,
          alias: 'Klingel auf die Lautsprecher',
          triggers: [
            { ...EMPTY_TRIGGER, entityId: doorbell.id, attribute: 'ring', toState: 'on' },
          ],
          steps: [
            {
              ...EMPTY_STEP,
              kind: 'broadcast' as StepKind,
              broadcastText: 'Es hat geklingelt!',
            },
          ],
        },
      });
    }
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
    // 'clean_rooms' mit leerer Liste lehnt der Sauger ab - die Vorlage
    // liesse sich speichern und scheiterte beim Laufen. Fürs morgendliche
    // Saugen ist ohnehin die ganze Wohnung gemeint: dafür 'start'. Kennt
    // ein Sauger das nicht, kommen alle seine Räume in die Liste.
    const rooms = vacuumRooms(vacuum);
    const startet = vacuum.commands.includes('start');
    templates.push({
      label: 'Morgens saugen',
      icon: 'sparkles-outline',
      draft: {
        ...EMPTY,
        alias: 'Morgens saugen',
        // Werktags um neun: Da ist das Haus meist leer, und niemand wird
        // vom Sauger geweckt.
        triggers: [{ ...EMPTY_TRIGGER, kind: 'time', at: '09:00' }],
        steps: [
          {
            ...EMPTY_STEP,
            commandActions: [
              startet || rooms.length === 0
                ? { entity_id: vacuum.id, command: 'start' }
                : {
                    entity_id: vacuum.id,
                    command: 'clean_rooms',
                    rooms: rooms.map((raum) => raum.id),
                  },
            ],
          },
        ],
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
        steps: [
          {
            ...EMPTY_STEP,
            commandActions: covers.map((entity) => ({
              entity_id: entity.id,
              command: 'close',
            })),
          },
        ],
      },
    });
    templates.push({
      label: 'Storen auf bei Sonnenaufgang',
      icon: 'sunny-outline',
      draft: {
        ...EMPTY,
        alias: 'Storen auf bei Sonnenaufgang',
        triggers: [{ ...EMPTY_TRIGGER, kind: 'sun', sunEvent: 'sunrise', sunOffset: '0' }],
        steps: [
          {
            ...EMPTY_STEP,
            commandActions: covers.map((entity) => ({
              entity_id: entity.id,
              command: 'open',
            })),
          },
        ],
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
          steps: [
            {
              ...EMPTY_STEP,
              commandActions: covers.map((entity) => ({
                entity_id: entity.id,
                command: 'close',
              })),
            },
          ],
        },
      });
    }
  }
  if (grill) {
    templates.push({
      label: 'Grill: Sonde meldet',
      icon: 'flame-outline',
      draft: {
        ...EMPTY,
        alias: 'Fleisch hat Zieltemperatur',
        triggers: [
          {
            ...EMPTY_TRIGGER,
            kind: 'threshold' as TriggerKind,
            entityId: grill.id,
            attribute: 'probe_1',
            thresholdOp: 'above',
            thresholdValue: '63',
          },
        ],
        steps: [
          {
            ...EMPTY_STEP,
            kind: 'notify' as StepKind,
            title: 'Fleisch ist so weit',
            body: 'Sonde 1 hat 63 °C erreicht.',
          },
        ],
      },
    });
  }

  if (batteries.length > 0) {
    templates.push({
      label: 'Batterie wird schwach',
      icon: 'battery-half-outline',
      draft: {
        ...EMPTY,
        alias: 'Batterie wird schwach',
        // 20 % ist der Punkt, an dem eine Ersatzbatterie besorgt werden
        // kann, bevor der Sensor stumm wird - bei 5 % wäre die Meldung
        // eine Nachricht über etwas, das schon passiert ist.
        triggers: batteries.map((entity) => ({
          ...EMPTY_TRIGGER,
          kind: 'threshold' as TriggerKind,
          entityId: entity.id,
          attribute: 'battery',
          thresholdOp: 'below' as const,
          thresholdValue: '20',
        })),
        steps: [
          {
            ...EMPTY_STEP,
            kind: 'notify' as StepKind,
            title: 'Batterie wird schwach',
            body: 'Ein Gerät meldet weniger als 20 % - Batterie bereitlegen.',
          },
        ],
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
  onNote,
}: {
  settings: HubSettings;
  user: User | null;
  entities: Entity[];
  scenes: Scene[];
  onScenesChanged?: () => void;
  /** Kurze Bestätigung nach oben melden – dort hängt die Einblendung
   *  am Bildschirm statt an der mitscrollenden Liste. */
  onNote?: (text: string) => void;
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
  // Abläufe, die dasselbe Gerät gegensätzlich schalten – kein Fehler,
  // aber die erste Frage, wenn nachts das Licht von selbst angeht.
  const [conflicts, setConflicts] = useState<
    { entity_id: string; commands: string[]; automations: { id: string; alias: string }[] }[]
  >([]);
  const [trash, setTrash] = useState<
    { kind: string; id: string; name: string; at: number; by: string }[]
  >([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [hueScenes, setHueScenes] = useState<string[]>([]);
  const [sceneQuery, setSceneQuery] = useState('');
  // Aufgeklappte Kategorien, getrennt je Abschnitt. Standard ist
  // zugeklappt: Wer Kategorien vergibt, will zuerst die Übersicht sehen
  // und nicht wieder die ganze Liste.
  const [openAuto, setOpenAuto] = useState<string[]>([]);
  const [openScenes, setOpenScenes] = useState<string[]>([]);
  // Ablauf, dessen Lauf-Verlauf gerade aufgeklappt ist.
  const [runsFor, setRunsFor] = useState<string | null>(null);
  // Die Auskunft «warum schweigt der?» je Ablauf – erst auf Wunsch geholt,
  // denn sie kostet einen eigenen Aufruf und interessiert nur, wenn etwas
  // nicht stimmt.
  const [diagnose, setDiagnose] = useState<Record<string, TriggerHealth[]>>({});
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

    fetch(`${settings.url}/api/automations/conflicts`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setConflicts(data?.conflicts ?? []))
      .catch(() => setConflicts([]));
    fetch(`${settings.url}/api/trash`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setTrash(data?.trash ?? []))
      .catch(() => setTrash([]));
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
      mode: draft.mode,
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
      onNote?.(draft.id ? `«${body.alias}» gespeichert` : `«${body.alias}» angelegt`);
      setDraft(null);
      load();
    } catch (err: any) {
      setError(String(err.message ?? err));
    }
  };

  /** Kopie anlegen – sechs fast gleiche Taster-Abläufe tippt niemand. */
  /** Kopie anlegen – auch von einem, der aus der config.yaml stammt. */
  const duplicate = async (id: string) => {
    const quelle = automations?.find((entry) => entry.id === id);
    await fetch(`${settings.url}/api/automations/${id}/duplicate`, {
      method: 'POST',
      headers,
    }).catch(() => {});
    // Bei einem aus der Datei ist der Hinweis der Punkt: Die Kopie liegt
    // jetzt in der App, ist aber aus – sonst liefe derselbe Ablauf zweimal.
    onNote?.(
      quelle && !quelle.editable
        ? `«${quelle.alias}» als Kopie übernommen – noch ausgeschaltet`
        : 'Kopie angelegt'
    );
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
      onNote?.('Ablauf einmal ausgeführt');
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
    const name = automations?.find((item) => item.id === id)?.alias ?? 'Ablauf';
    await fetch(`${settings.url}/api/automations/${id}`, {
      method: 'DELETE',
      headers,
    }).catch(() => {});
    // Der Papierkorb ist der eigentliche Rückweg – der Hinweis sagt, dass
    // es ihn gibt. Sonst sucht man ihn erst, wenn man ihn braucht.
    onNote?.(`«${name}» in den Papierkorb gelegt`);
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
      transition: Math.max(0, Number(sceneDraft.transition) || 0),
      category: sceneDraft.category?.trim() || null,
      actions: sceneDraft.actions
        .filter((action) => action.entity_id)
        // flatMap, weil aus einem Eintrag zwei Aktionen werden können:
        // Helligkeit und Farbe sind zwei Befehle an dasselbe Licht.
        .flatMap(({ entity_id, command, rooms, position, brightness, color }) => {
          if (command === 'clean_rooms') {
            return [{ entity_id, command, data: { rooms: rooms ?? [] } }];
          }
          if (command === 'set_position') {
            return [{ entity_id, command, data: { position: position ?? 50 } }];
          }
          if (command === 'set_brightness') {
            return [
              { entity_id, command, data: { brightness: brightness ?? 50 } },
              ...(color ? [{ entity_id, command: 'set_color', data: { color } }] : []),
            ];
          }
          return [{ entity_id, command }];
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
      onNote?.(sceneDraft.id ? `Szene «${body.name}» gespeichert` : `Szene «${body.name}» angelegt`);
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
    return <Fehlschlag text={`Abläufe nicht abrufbar: ${error}`} onRetry={load} />;
  }
  if (!automations) {
    return <Laedt was="Abläufe" />;
  }

  const restore = async (kind: string, id: string) => {
    await fetch(`${settings.url}/api/trash/${kind}/${id}/restore`, {
      method: 'POST',
      headers,
    }).catch(() => {});
    load();
  };

  return (
    <View style={styles.list}>
      <Text style={[styles.sectionTitle, { marginTop: 0 }]}>Abläufe</Text>

      {conflicts.length > 0 ? (
        <Card style={styles.card}>
          <View style={styles.cardHead}>
            <Ionicons name="git-compare-outline" size={18} color={colors.warn} />
            <Text style={[styles.title, { flex: 1 }]}>
              {conflicts.length === 1
                ? 'Ein Gerät wird gegensätzlich geschaltet'
                : `${conflicts.length} Geräte werden gegensätzlich geschaltet`}
            </Text>
          </View>
          {conflicts.map((conflict, index) => (
            <Text key={index} style={styles.detail}>
              {entities.find((entity) => entity.id === conflict.entity_id)?.name ??
                conflict.entity_id}
              : «{conflict.automations[0].alias}» und «{conflict.automations[1].alias}»
            </Text>
          ))}
          <Text style={styles.triggerNote}>
            Kein Fehler – oft ist genau das gewollt (der eine schaltet ein, der
            andere später aus). Geht aber nachts das Licht von selbst an,
            steht die Ursache hier.
          </Text>
        </Card>
      ) : null}
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
                    {/* Antippbar: die letzten Läufe samt Begründung. «Warum
                        lief das nicht?» steht dann da - z.B. «übersprungen:
                        nur wenn dunkel» - statt nur des letzten Laufs. */}
                    <Pressable
                      onPress={() => {
                        const auf = runsFor === automation.id;
                        setRunsFor(auf ? null : automation.id);
                        // Beim Aufklappen gleich nachfragen, ob der
                        // Auslöser überhaupt ankommt - der Lauf-Verlauf
                        // allein beantwortet das nicht.
                        if (!auf && !diagnose[automation.id]) {
                          fetch(
                            `${settings.url}/api/automations/${automation.id}/diagnose`,
                            { headers }
                          )
                            .then((r) => (r.ok ? r.json() : null))
                            .then((d) =>
                              d?.triggers
                                ? setDiagnose((v) => ({ ...v, [automation.id]: d.triggers }))
                                : null
                            )
                            .catch(() => {});
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: runsFor === automation.id }}
                    >
                      <Text style={styles.detail}>
                        {lastRunText(runs, automation.id)}
                        {runs.some((run) => run.automation_id === automation.id)
                          ? runsFor === automation.id
                            ? ' ▾'
                            : ' ▸'
                          : ''}
                      </Text>
                    </Pressable>
                    {runsFor === automation.id ? (
                      <View style={{ marginTop: 4, gap: 2 }}>
                        {runs
                          .filter((run) => run.automation_id === automation.id)
                          .slice(0, 8)
                          .map((run, index) => (
                            <Text key={index} style={styles.triggerNote}>
                              {runLine(run)}
                            </Text>
                          ))}
                        <Text style={styles.triggerNote}>
                          «Übersprungen» heisst: ausgelöst, aber eine Bedingung
                          war nicht erfüllt - sie steht dahinter.
                        </Text>
                        {/* Und die andere Hälfte der Antwort: Kam der
                            Auslöser überhaupt? Ein Melder mit leerer
                            Batterie hinterlässt im Lauf-Verlauf nichts. */}
                        {(diagnose[automation.id] ?? [])
                          .filter((t) => !t.ok)
                          .map((t, index) => (
                            <Text
                              key={`d${index}`}
                              style={[styles.triggerNote, { color: colors.warn }]}
                            >
                              {t.hinweis}
                            </Text>
                          ))}
                      </View>
                    ) : null}
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
                    <>
                      {/* Der fehlende Weg von der Datei zur Bedienbarkeit:
                          Das Original bleibt unangetastet, die Kopie liegt
                          in der App und ist änderbar. Sie kommt
                          ausgeschaltet – sonst liefe derselbe Ablauf ab
                          sofort zweimal. */}
                      {mayEdit ? (
                        <Pressable
                          onPress={() => duplicate(automation.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`${automation.alias} als Kopie in die App übernehmen`}
                          style={styles.iconButton}
                        >
                          <Ionicons
                            name="download-outline"
                            size={20}
                            color={colors.inkSoft}
                          />
                        </Pressable>
                      ) : null}
                      <Text style={styles.badge}>aus config.yaml</Text>
                    </>
                  )}
                </View>
              </Card>
            )}
          />
        </>
      )}

      {/* Die eingebauten Wächter-Nachrichten als eigene Kategorie «Push»:
          Sie gehören zu den Abläufen - der Hub tut hier etwas von sich
          aus -, sind aber keine gespeicherten Automationen, sondern
          Regeln mit Schalter und Schwelle. */}
      <PushRules settings={settings} mayEdit={mayEdit} />

      <Text style={styles.sectionTitle}>Szenen</Text>
      {mayEdit ? (
        <Pressable
          onPress={() =>
            setSceneDraft({
              name: '',
              icon: SCENE_ICONS[0],
              onStart: false,
              transition: 0,
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
                          transition: Number(scene.transition) || 0,
                          category: scene.category ?? undefined,
                          actions: sceneActionsToDraft(scene.actions ?? []),
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

      {mayEdit && trash.length > 0 ? (
        <Card style={styles.card}>
          <Pressable
            onPress={() => setTrashOpen((open) => !open)}
            accessibilityRole="button"
            style={styles.cardHead}
          >
            <Ionicons name="trash-outline" size={18} color={colors.inkSoft} />
            <Text style={[styles.title, { flex: 1 }]}>
              Papierkorb ({trash.length})
            </Text>
            <Ionicons
              name={trashOpen ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.inkSoft}
            />
          </Pressable>
          {trashOpen ? (
            <>
              {trash.map((row) => (
                <View key={`${row.kind}:${row.id}`} style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detail}>{row.name}</Text>
                    <Text style={styles.triggerNote}>
                      {row.kind === 'scene' ? 'Szene' : 'Ablauf'} · gelöscht am{' '}
                      {new Date(row.at * 1000).toLocaleDateString('de-CH', {
                        day: 'numeric',
                        month: 'short',
                      })}
                      {row.by && row.by !== '?' ? ` von ${row.by}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => restore(row.kind, row.id)}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.newButton, pressed && { opacity: 0.75 }]}
                  >
                    <Ionicons name="arrow-undo-outline" size={16} color={colors.ink} />
                    <Text style={styles.newText}>Zurückholen</Text>
                  </Pressable>
                </View>
              ))}
              <Text style={styles.triggerNote}>
                Gelöschtes bleibt 30 Tage liegen und verschwindet danach von
                selbst.
              </Text>
            </>
          ) : null}
        </Card>
      ) : null}

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
        <Pressable
          onPress={() => onChange('')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Eingabe leeren"
        >
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
  /** Übergangszeit in Sekunden – Helligkeiten werden angefahren. */
  transition?: number;
  actions: SceneActionDraft[];
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
    // Die Alarmanlage kann arm_night/arm_away/arm_vacation/disarm – sie
    // fiel hier nur durchs Sieb, weil sie kein turn_on hat. Damit ging
    // «beim Weggehen scharf» ausgerechnet nicht in der App, obwohl der
    // Gute-Nacht-Knopf es längst vormacht.
    entity.kind === 'alarm' ||
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
  if (entity.kind === 'alarm') {
    // Dieselben Namen wie auf dem Alarm-Bildschirm – «scharf (Nacht)»
    // statt arm_night, damit niemand raten muss, was ein Modus tut.
    return [
      { key: 'arm_night', label: 'scharf (Nacht)' },
      { key: 'arm_away', label: 'scharf (Ausser Haus)' },
      { key: 'arm_vacation', label: 'scharf (Urlaub)' },
      { key: 'disarm', label: 'unscharf' },
    ];
  }
  const options = [
    { key: 'turn_on', label: 'ein' },
    { key: 'turn_off', label: 'aus' },
  ];
  // «ein mit Helligkeit» nur, wo das Gerät wirklich dimmen kann – ein
  // Schalter mit Helligkeitsregler wäre ein Knopf, der nichts tut.
  if (entity.commands.includes('set_brightness')) {
    options.splice(1, 0, { key: 'set_brightness', label: 'ein, gedimmt' });
  }
  return options;
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
          (entity.room ?? '').toLowerCase().includes(needle) ||
          // Auch über die Art: «Saugroboter» findet ihn, ohne dass man
          // wissen muss, dass er «Rosa» heisst.
          deviceKindLabel(entity).toLowerCase().includes(needle)
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
      items: devices
        .filter((entity) => (entity.room || 'Weitere') === room)
        // Nach Art, dann nach Name: So stehen die Lichter eines Raums
        // beieinander und die Storen auch – in der Reihenfolge, in der
        // die Integration sie meldet, standen sie durcheinander.
        .sort(
          (a, b) =>
            deviceKindLabel(a).localeCompare(deviceKindLabel(b)) ||
            a.name.localeCompare(b.name)
        ),
    });
  }

  const toggle = (entity: Entity) => {
    if (byId.has(entity.id)) {
      onActions(actions.filter((action) => action.entity_id !== entity.id));
    } else {
      onActions([...actions, snapshotAction(entity)]);
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

  const setBrightness = (entityId: string, brightness: number) =>
    onActions(
      actions.map((action) =>
        action.entity_id === entityId ? { ...action, brightness } : action
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
    onActions(
      devices
        // Die Alarmanlage nur, wenn man sie ausdrücklich anwählt: Eine
        // Szene «Kino», die per Schnappschuss heimlich «unscharf»
        // eingesammelt hat, entschärft sonst abends die Anlage.
        .filter((entity) => entity.kind !== 'alarm')
        .map(snapshotAction)
    );

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
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Suche leeren"
          >
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
                  accessibilityLabel={`${entity.name}, ${deviceKindLabel(entity)}`}
                  style={styles.deviceHead}
                >
                  <Ionicons
                    name={included ? 'checkmark-circle' : 'ellipse-outline'}
                    size={24}
                    color={included ? colors.on : colors.inkFaint}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.deviceName}>{entity.name}</Text>
                    {/* Wofür das Gerät steht. «Flur» allein sagt nicht, ob
                        das Licht oder der Melder gemeint ist. */}
                    <Text style={styles.pickKind}>{deviceKindLabel(entity)}</Text>
                  </View>
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
                    {action!.command === 'set_brightness' ? (
                      <Choice
                        options={[
                          { key: '10', label: '10 %' },
                          { key: '25', label: '25 %' },
                          { key: '50', label: '50 %' },
                          { key: '75', label: '75 %' },
                          { key: '100', label: '100 %' },
                        ]}
                        value={String(action!.brightness ?? 50)}
                        onSelect={(key) => setBrightness(entity.id, Number(key))}
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
                accessibilityLabel={`Symbol ${icon}`}
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

        <Field label="Übergang">
          <Choice
            options={[
              { key: '0', label: 'Sofort' },
              { key: '300', label: '5 Min' },
              { key: '900', label: '15 Min' },
              { key: '1800', label: '30 Min' },
            ]}
            value={String(draft.transition ?? 0)}
            onSelect={(value) => set({ transition: Number(value) })}
          />
          <Text style={styles.triggerNote}>
            Über diese Zeit werden Helligkeiten sanft angefahren statt
            geschaltet – als Lichtwecker oder Einschlaflicht. An und Aus,
            Storen und alles andere bleiben sofort.
          </Text>
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
                <EntityPicker
                  entities={entities}
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
                      // «ist» vergleicht immer den Zustand selbst.
                      attribute: op === 'is' ? undefined : entry.attribute,
                    })
                  }
                />
                {entry.op === 'is' ? (
                  <Choice
                    options={conditionOptions(chosen)}
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
                {entry.op !== 'is' && measurableAttributes(chosen).length > 0 ? (
                  <>
                    <Choice
                      options={[
                        { key: '', label: 'Zustand' },
                        ...measurableAttributes(chosen),
                      ]}
                      value={entry.attribute ?? ''}
                      onSelect={(attribute) => setEntry({ attribute })}
                    />
                    {entry.attribute === 'illumination' ? (
                      <Text style={styles.triggerNote}>
                        Lux, gemessen vom Melder selbst. Als Anhalt: unter 10
                        ist Nacht, 50 eine gemütliche Wohnzimmerbeleuchtung,
                        über 1000 heller Tag. Was dein Melder gerade misst,
                        steht unter Geräte auf seiner Kachel – daran den Wert
                        festmachen, nicht raten.
                      </Text>
                    ) : (
                      <Text style={styles.triggerNote}>
                        Vergleicht diesen Messwert des Geräts.
                      </Text>
                    )}
                  </>
                ) : entry.op !== 'is' ? (
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
          {hatWartezeit(draft.steps) ? (
            <>
              <Text style={styles.label}>Wenn er dabei erneut ausgelöst wird</Text>
              <Choice
                options={[
                  { key: 'single', label: 'nichts tun' },
                  { key: 'restart', label: 'von vorn beginnen' },
                ]}
                value={draft.mode}
                onSelect={(mode) => set({ mode: mode as 'single' | 'restart' })}
              />
              <Text style={styles.triggerNote}>
                {draft.mode === 'restart'
                  ? 'Der laufende Durchgang wird abgebrochen und beginnt neu – die Wartezeit zählt also ab dem letzten Mal. Das ist der Nachlauf eines Treppenhauslichts: Bewegung schaltet ein, jede weitere Bewegung verlängert.'
                  : 'Ein zweiter Auslöser wird verworfen, solange der Ablauf noch wartet. Richtig für alles, was einmal geschehen soll – eine Nachricht käme sonst doppelt.'}
              </Text>
            </>
          ) : null}
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
          // Nur anbieten, wenn es auch Zonen gibt – ein leerer Auslöser
          // wäre ein Versprechen, das der Hub nicht halten kann.
          ...(entities.some((entity) => entity.id.startsWith('geofence.'))
            ? [{ key: 'geofence', label: 'Ort' }]
            : []),
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
          <EntityPicker
            entities={entities}
            value={trigger.entityId}
            onSelect={(entityId) =>
              onChange({
                entityId,
                // Ein Taster kennt kein «an» – nach dem Wechsel muss der
                // Zustand zum neuen Gerät passen, sonst stünde da ein
                // Auslöser, der nie eintritt. Dasselbe gilt fürs Feld:
                // «klingelt» ergibt bei einer Lampe keinen Sinn.
                ...fittingTrigger(
                  entities.find((entity) => entity.id === entityId),
                  trigger.attribute,
                  trigger.toState
                ),
              })
            }
          />
          <Choice
            options={stateOptions(chosen)}
            value={optionKey(trigger.attribute, trigger.toState)}
            onSelect={(key) => {
              // Der Schlüssel trägt das Feld mit: «ring:on» heisst
              // klingeln, «on» heisst der Zustand selbst. Sonst liesse
              // sich beides nicht auseinanderhalten.
              const gewaehlt = stateOptions(chosen).find(
                (option) => option.key === key
              );
              onChange({
                toState: gewaehlt?.to ?? key,
                attribute: gewaehlt?.attribute ?? '',
                fromState: '',
              });
            }}
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
          <View style={styles.rowGap}>
            <Choice
              options={[
                { key: '', label: 'sofort' },
                { key: '5', label: 'bleibt 5 Min. so' },
                { key: '10', label: 'bleibt 10 Min. so' },
                { key: '30', label: 'bleibt 30 Min. so' },
              ]}
              value={trigger.forMinutes}
              onSelect={(forMinutes) => onChange({ forMinutes })}
            />
          </View>
          {trigger.forMinutes ? (
            <Text style={styles.triggerNote}>
              Löst erst aus, wenn der Zustand {trigger.forMinutes} Minuten
              bestehen bleibt - der kurze Gang zum Briefkasten zählt so
              nicht als «alle weg».
            </Text>
          ) : null}
        </>
      ) : trigger.kind === 'geofence' ? (
        <>
          <EntityPicker
            entities={entities.filter((entity) => entity.id.startsWith('geofence.'))}
            value={trigger.entityId}
            onSelect={(entityId) => onChange({ entityId })}
          />
          <Choice
            options={[
              { key: 'home', label: 'kommt an' },
              { key: 'away', label: 'geht weg' },
            ]}
            value={trigger.toState === 'away' ? 'away' : 'home'}
            onSelect={(toState) => onChange({ toState })}
          />
          <Text style={styles.triggerNote}>
            Das Telefon meldet den Wechsel selbst – auf dem iPhone über die
            Kurzbefehle-App («Wenn ich ankomme» → Inhalte von URL abrufen).
            Steht in docs/geofence.md.
          </Text>
          <View style={styles.rowGap}>
            <Choice
              options={[
                { key: '', label: 'sofort' },
                { key: '5', label: 'bleibt 5 Min. so' },
                { key: '10', label: 'bleibt 10 Min. so' },
                { key: '30', label: 'bleibt 30 Min. so' },
              ]}
              value={trigger.forMinutes}
              onSelect={(forMinutes) => onChange({ forMinutes })}
            />
          </View>
          {trigger.forMinutes ? (
            <Text style={styles.triggerNote}>
              Löst erst aus, wenn der Zustand {trigger.forMinutes} Minuten
              bestehen bleibt - der kurze Gang zum Briefkasten zählt so
              nicht als «alle weg».
            </Text>
          ) : null}
        </>
      ) : trigger.kind === 'threshold' ? (
        <>
          <EntityPicker
            entities={entities}
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
          <View style={styles.rowGap}>
            <Choice
              options={[
                { key: '', label: 'sofort' },
                { key: '5', label: 'bleibt 5 Min. so' },
                { key: '10', label: 'bleibt 10 Min. so' },
                { key: '30', label: 'bleibt 30 Min. so' },
              ]}
              value={trigger.forMinutes}
              onSelect={(forMinutes) => onChange({ forMinutes })}
            />
          </View>
          {trigger.forMinutes ? (
            <Text style={styles.triggerNote}>
              Löst erst aus, wenn der Zustand {trigger.forMinutes} Minuten
              bestehen bleibt - der kurze Gang zum Briefkasten zählt so
              nicht als «alle weg».
            </Text>
          ) : null}
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
              ...(entities.some((entity) => entity.commands.includes('play_url'))
                ? [{ key: 'broadcast', label: 'Durchsage' }]
                : []),
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
              <EntityPicker
                entities={entities.filter((entity) => entity.kind === 'camera')}
                noneLabel="Kein Bild"
                placeholder="Kamera suchen …"
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
          ) : step.kind === 'broadcast' ? (
            <>
              <TextInput
                style={styles.input}
                value={step.broadcastText}
                onChangeText={(broadcastText) => setStep(index, { broadcastText })}
                placeholder="Essen ist fertig!"
                placeholderTextColor={colors.inkFaint}
                maxLength={200}
              />
              {entities.filter((entity) => entity.commands.includes('play_url'))
                .length > 1 ? (
                <Choice
                  multi
                  options={entities
                    .filter((entity) => entity.commands.includes('play_url'))
                    .map((entity) => ({ key: entity.id, label: entity.name }))}
                  values={step.broadcastSpeakers}
                  onSelect={(id) =>
                    setStep(index, {
                      broadcastSpeakers: step.broadcastSpeakers.includes(id)
                        ? step.broadcastSpeakers.filter((entry) => entry !== id)
                        : [...step.broadcastSpeakers, id],
                    })
                  }
                />
              ) : null}
              <Text style={styles.triggerNote}>
                Der Text wird auf den Cast-Boxen vorgelesen - ohne Auswahl
                auf allen. Braucht Internet (Sprachausgabe) und dass die
                App den Hub mindestens einmal erreicht hat.
              </Text>
            </>
          ) : step.kind === 'delay' ? (
            <>
              <Choice
                // Die kurzen Stufen dazwischen sind kein Zierrat: Ein
                // Nachlauf für ein Treppenhaus liegt bei zwei bis vier
                // Minuten, und zwischen «1 Min.» und «5 Min.» lag genau
                // das, was man dafür braucht.
                options={[
                  { key: '30', label: '30 Sek.' },
                  { key: '60', label: '1 Min.' },
                  { key: '120', label: '2 Min.' },
                  { key: '240', label: '4 Min.' },
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
              <EntityPicker
                entities={entities}
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

/** Wartet dieser Ablauf irgendwo? (rein, testbar)
 *
 * Nur dann bedeutet «erneut ausgelöst» überhaupt etwas: Ein Ablauf, der
 * in Millisekunden durch ist, wird nie mitten im Lauf noch einmal
 * angestossen. Den Wähler trotzdem hinzustellen hiesse, eine Frage zu
 * stellen, die sich nicht stellt.
 */
export function hatWartezeit(steps: { kind: string }[]): boolean {
  return steps.some((step) => step.kind === 'delay' || step.kind === 'wait_until');
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

/** Die Geräte, die zur Suche passen – nach Raum gebündelt (rein, testbar).
 *
 * Gesucht wird über Name, Raum **und Geräteart**: «Bewegung» findet den
 * Melder auch dann, wenn er «Flur 2» heisst. Genau daran scheiterte die
 * alte Auswahl – wer den Namen nicht auswendig wusste, fand nichts.
 *
 * Das bereits Gewählte bleibt immer dabei, auch wenn es nicht zur Suche
 * passt: Sonst stünde beim Tippen plötzlich nirgends mehr, was gerade
 * eingestellt ist.
 */
export function groupEntities(
  entities: Entity[],
  query: string,
  chosen?: string
): { room: string; items: Entity[] }[] {
  const needle = query.trim().toLowerCase();
  const hits = needle
    ? entities.filter(
        (entity) =>
          entity.id === chosen ||
          entity.name.toLowerCase().includes(needle) ||
          (entity.room ?? '').toLowerCase().includes(needle) ||
          deviceKindLabel(entity).toLowerCase().includes(needle)
      )
    : entities;

  const rooms = Array.from(new Set(hits.map((entity) => entity.room || 'Weitere')));
  // «Weitere» ganz nach unten – dort steht, was keinem Raum zugeordnet
  // ist, und das sucht man am seltensten.
  rooms.sort((a, b) => (a === 'Weitere' ? 1 : b === 'Weitere' ? -1 : a.localeCompare(b)));
  return rooms.map((room) => ({
    room,
    items: hits
      .filter((entity) => (entity.room || 'Weitere') === room)
      // Innerhalb des Raums nach Art, dann nach Name: So stehen die
      // Lichter beieinander und die Melder auch.
      .sort(
        (a, b) =>
          deviceKindLabel(a).localeCompare(deviceKindLabel(b)) ||
          a.name.localeCompare(b.name)
      ),
  }));
}

/**
 * Ein Gerät auswählen: Suchfeld, nach Raum gebündelt, eine Zeile je Gerät
 * mit Symbol, Name und Geräteart.
 *
 * Vorher war das eine einzige waagrechte Reihe von Chips. Bei über
 * hundert Geräten hiess das: wischen, bis man das Richtige sieht – und
 * weil in den Chips nur der Name stand, war «Flur» genauso gut das Licht
 * wie der Melder. Beides ist hier behoben.
 */
function EntityPicker({
  entities,
  value,
  onSelect,
  placeholder = 'Gerät, Raum oder Art suchen …',
  noneLabel,
}: {
  entities: Entity[];
  value: string;
  onSelect: (id: string) => void;
  placeholder?: string;
  /** Beschriftung für «nichts davon» – ohne sie gibt es die Zeile nicht. */
  noneLabel?: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  // Kurze Listen brauchen kein Suchfeld; es stünde nur im Weg.
  const searchable = entities.length > 8;
  const groups = useMemo(
    () => groupEntities(entities, searchable ? query : '', value),
    [entities, query, searchable, value]
  );
  const chosen = entities.find((entity) => entity.id === value);

  const row = (
    key: string,
    label: string,
    sub: string | null,
    icon: string,
    selected: boolean,
    onPress: () => void
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      style={({ pressed }) => [
        styles.pickRow,
        selected && styles.pickRowActive,
        pressed && { opacity: 0.75 },
      ]}
    >
      <Ionicons
        name={icon as keyof typeof Ionicons.glyphMap}
        size={19}
        color={selected ? colors.accent : colors.inkFaint}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.pickName, selected && styles.pickNameActive]} numberOfLines={1}>
          {label}
        </Text>
        {sub ? <Text style={styles.pickKind}>{sub}</Text> : null}
      </View>
      {selected ? (
        <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
      ) : null}
    </Pressable>
  );

  return (
    <View style={{ gap: 8 }}>
      {searchable ? (
        <View style={styles.deviceSearch}>
          <Ionicons name="search" size={15} color={colors.inkFaint} />
          <TextInput
            style={styles.deviceSearchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={placeholder}
            placeholderTextColor={colors.inkFaint}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Suche löschen">
              <Ionicons name="close-circle" size={17} color={colors.inkFaint} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Bei langen Listen wandert das Gewählte beim Tippen ausser Sicht.
          Eine Zeile oben sagt, woran man gerade ist. */}
      {searchable && chosen ? (
        <Text style={styles.snapshotHint}>
          Gewählt: {chosen.name} · {deviceKindLabel(chosen)}
        </Text>
      ) : null}

      {/* Eigener Scrollbereich mit fester Höhe: Sonst schöbe eine Liste
          mit hundert Geräten den Rest des Editors ausser Sicht. */}
      <ScrollView
        style={styles.pickList}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {noneLabel
          ? row(
              '__ohne',
              noneLabel,
              null,
              'remove-circle-outline',
              value === '',
              () => onSelect('')
            )
          : null}
        {groups.length === 0 ? (
          <Text style={styles.snapshotHint}>Nichts gefunden.</Text>
        ) : null}
        {groups.map((group) => (
          <View key={group.room}>
            <Text style={styles.groupLabel}>{group.room}</Text>
            {group.items.map((entity) =>
              row(
                entity.id,
                entity.name,
                deviceKindLabel(entity),
                deviceKindIcon(entity),
                value === entity.id,
                () => onSelect(entity.id)
              )
            )}
          </View>
        ))}
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
    const base: Record<string, any> = { type: 'state', entity_id: entry.entity_id };
    // Ohne Angabe vergleicht der Hub den Zustand selbst - dann gehört das
    // Feld auch nicht in die gespeicherte Form.
    if (entry.attribute) base.attribute = entry.attribute;
    if (entry.op === 'above') {
      conditions.push({ ...base, above: Number(entry.value) || 0 });
    } else if (entry.op === 'below') {
      conditions.push({ ...base, below: Number(entry.value) || 0 });
    } else {
      conditions.push({ ...base, equals: entry.value });
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
  if (step.kind === 'broadcast') {
    if (!step.broadcastText.trim()) return [];
    return [
      {
        type: 'broadcast',
        text: step.broadcastText.trim(),
        ...(step.broadcastSpeakers.length > 0
          ? { speakers: step.broadcastSpeakers }
          : {}),
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
      if (action.command === 'set_brightness') {
        built.data = { brightness: action.brightness ?? 50 };
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
        brightness: action.data?.brightness,
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
    } else if (type === 'broadcast') {
      steps.push({
        ...EMPTY_STEP,
        kind: 'broadcast',
        broadcastText: action.text ?? '',
        broadcastSpeakers: Array.isArray(action.speakers) ? action.speakers : [],
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
        // Beim Speichern wird das Feld mitgeschrieben, beim Öffnen fiel es
        // bisher weg: Wer einen Ablauf mit «Helligkeit unter 20» erneut
        // speicherte, verglich danach den Zustand statt den Messwert.
        ...(entry.attribute ? { attribute: String(entry.attribute) } : {}),
      })),
    match: automation.match === 'any' ? 'any' : 'all',
    weekdays: Array.isArray(condition.weekdays) ? condition.weekdays.map(Number) : [],
    steps: withAtLeastOne(actionsToSteps(automation.actions ?? [])),
    elseSteps: actionsToSteps(automation.otherwise ?? []),
    mode: automation.mode === 'restart' ? 'restart' : 'single',
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
    // Geräteauswahl: eine Zeile je Gerät statt einer endlosen Chip-Reihe.
    pickList: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      paddingHorizontal: 10,
      paddingVertical: 6,
      // Über zehn Zeilen wird die Seite unbedienbar lang; hier scrollt
      // die Auswahl in sich selbst.
      maxHeight: 320,
    },
    pickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 9,
      paddingHorizontal: 6,
      borderRadius: radius.control,
    },
    pickRowActive: { backgroundColor: colors.surface },
    pickName: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    pickNameActive: { color: colors.accent },
    pickKind: { color: colors.inkFaint, fontSize: 12, marginTop: 1 },
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
