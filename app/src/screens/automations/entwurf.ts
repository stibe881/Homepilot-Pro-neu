/**
 * Reine Logik des Ablauf-Editors: Typen, Entwurf ↔ gespeicherte Form, Beschreibungen.
 *
 * Herausgelöst aus AutomationsScreen.tsx (Punkt 21 der Werkbank).
 */

import { Entity } from '../../api/types';
import { datumUhr, dauerText } from '../../lib/format';

/**
 * Die gespeicherte Form eines Ablauf-Bausteins (Auslöser, Bedingung,
 * Aktion) - dieselbe, die der Hub in der config.yaml führt. Ein offenes
 * Objekt mit Absicht (Punkt 60 der Werkbank): Die Felder je Art sauber zu
 * tippen hiesse, die Hub-Schemas hier zu duplizieren; der eine Alias
 * ersetzt die achtzehn verstreuten `any` von vorher.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BausteinConfig = Record<string, any>;

export interface Automation {
  id: string;
  alias: string;
  triggers: BausteinConfig[];
  conditions: BausteinConfig[];
  actions: BausteinConfig[];
  /** Was stattdessen läuft, wenn die Bedingungen nicht passen. */
  otherwise?: BausteinConfig[];
  editable: boolean;
  /** Frei benannte Kategorie zum Gruppieren (vom Hub, kann fehlen). */
  category?: string | null;
  /** Verknüpfung der Bedingungen: 'all' oder 'any'. */
  match?: string;
  mode?: string;
  /** Frühestens wieder nach so vielen Sekunden (0 = kein Abstand). */
  cooldown?: number;
  /** Ausgeschaltete Abläufe bleiben stehen, laufen aber nicht. */
  enabled?: boolean;
  /** Ruht bis (Unix-Sekunden) - «aus bis morgen», Punkt 159. */
  quiet_until?: number | null;
  /** Nächster geplanter Lauf (Unix-Sekunden), nur Zeit/Sonne - Punkt 161. */
  next_run?: number | null;
}

/** Je Auslöser: kam er überhaupt an? Antwort von /diagnose. */
export interface TriggerHealth {
  type: string;
  entity_id?: string;
  ok: boolean;
  hinweis: string;
  zuletzt_gefeuert_vor?: number | null;
  zuletzt_gemeldet_vor?: number | null;
}

/** Was der Ablauf jetzt täte – ohne dass etwas passiert. */
export interface DryRun {
  conditions_hold: boolean;
  skipped: string[];
  branch: string;
  would_run: string[];
}

/** Ein protokollierter Lauf – auch ein nicht ausgeführter. */
export interface Run {
  automation_id: string;
  alias: string;
  at: number;
  executed: boolean;
  error?: string | null;
  skipped: string[];
  /** Die Schritt-Spur (Punkt 160): was wann dran war, und was hing. */
  steps?: { label: string; after: number; note?: string; error?: string }[];
}

/** Welche Zustände bei diesem Gerät als Auslöser oder Bedingung taugen
 *  (rein, testbar).
 *
 * Ein Wandtaster kennt kein «an»/«aus» – er meldet einen Druck. Nach an/aus
 * gefragt käme ein Auslöser heraus, der nie eintritt. Dasselbe gilt für
 * Storen, Schlösser und die Alarmanlage: Jede Art hat ihre eigenen Worte. */
/** Deutsche Namen der Messwerte, die in Bedingungen taugen. */
export const MEASURE_LABELS: Record<string, string> = {
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
export function plainStates(entity?: Entity): { key: string; label: string }[] {
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
  const time = datumUhr(run.at * 1000);
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
export const NO_CATEGORY = 'Ohne Kategorie';

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
export type TriggerKind =
  | 'state'
  | 'threshold'
  | 'interval'
  | 'time'
  | 'sun'
  | 'calendar'
  | 'geofence'
  | 'availability';
export type StepKind = 'command' | 'scene' | 'hue_scene' | 'notify' | 'broadcast' | 'delay' | 'wait_until' | 'fade';
export type ConditionKind = 'none' | 'sun' | 'time';

/** Ein einzelner Auslöser – ein Ablauf kann mehrere haben («oder»). */
export interface TriggerDraft {
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
  /** Erreichbarkeits-Auslöser: verstummt das Gerät oder kommt es wieder? */
  availabilityTo: 'weg' | 'wieder-da';
  /** ± Minuten Zufalls-Versatz für Zeit/Sonne (Punkt 155): Storen, die
   *  sekundengleich fahren, verraten die Zeitschaltuhr. Leer = pünktlich. */
  jitter: string;
  /** Kalender-Auslöser (Punkt 153): Wort im Termin-Titel (leer = jeder),
   *  Beginn oder Ende, und Minuten Vorlauf («am Vorabend» = 720). */
  calendarContains: string;
  calendarEvent: 'start' | 'end';
  calendarBefore: string;
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
export interface StepDraft {
  kind: StepKind;
  /** Mehrere Geräte für «Gerät schalten» (Checkliste). */
  commandActions: {
    entity_id: string;
    command: string;
    rooms?: number[];
    position?: number;
    brightness?: number;
    /** Lichtfarbe als #RRGGBB – nur bei Lampen, die Farbe können. */
    color?: string;
    /** Weissanteil als Mirek (153 kühl … 500 warm). */
    colorTemp?: number;
    /** Helligkeit erst beim Auslösen aus den Lux des Melders rechnen. */
    adaptive?: boolean;
  }[];
  sceneId: string;
  /** Name einer auf der Hue-Bridge gespeicherten Szene. */
  hueScene: string;
  title: string;
  body: string;
  /** Kamera, deren Bild der Nachricht beiliegt. Leer = ohne Bild. */
  notifyCamera: string;
  /** Wer die Nachricht bekommt (Punkt 158): leer = alle; sonst ein
   *  Benutzername - «Waschmaschine fertig» piepst dann nur bei dem, der
   *  sie ausräumt. */
  notifyTo: string;
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
  /** Dimmen über Zeit (Punkt 157): welches Licht, wohin, wie lange. */
  fadeEntityId: string;
  fadeTo: string;
  fadeMinutes: string;
}

export const EMPTY_STEP: StepDraft = {
  kind: 'command',
  commandActions: [],
  sceneId: '',
  hueScene: '',
  title: '',
  body: '',
  notifyCamera: '',
  notifyTo: '',
  seconds: '60',
  waitEntityId: '',
  waitOp: 'is',
  waitValue: 'off',
  waitTimeout: '300',
  broadcastText: '',
  broadcastSpeakers: [],
  fadeEntityId: '',
  fadeTo: '0',
  fadeMinutes: '10',
};

/** Ein neuer Auslöser für dieses Gerät – mit einem Zustand, den es auch
 *  wirklich kennt. */
export function newTrigger(entity?: Entity): TriggerDraft {
  return {
    ...EMPTY_TRIGGER,
    entityId: entity?.id ?? '',
    toState: fittingState(entity, EMPTY_TRIGGER.toState),
  };
}

export const EMPTY_TRIGGER: TriggerDraft = {
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
  availabilityTo: 'weg',
  jitter: '',
  calendarContains: '',
  calendarEvent: 'start',
  calendarBefore: '',
};

/** «ist» vergleicht den Zustand, «über»/«unter» eine Zahl – für Helligkeit,
 *  Temperatur oder eine Anzahl anwesender Personen. */
export type Compare = 'is' | 'above' | 'below';

export interface StateCondition {
  entity_id: string;
  op: Compare;
  value: string;
  /** Welcher Messwert verglichen wird. Leer = der Zustand selbst. */
  attribute?: string;
}

/** Eine Und/Oder-Gruppe von Gerätebedingungen (Punkt 152).
 *
 *  Eine Schachtelungsebene, mit Absicht: «dunkel und (jemand da oder
 *  Gast-Modus)» deckt praktisch alle Fälle - tiefere Gruppen bleiben der
 *  config.yaml und wandern als extraConditions unangetastet mit. */
export interface ConditionGroup {
  match: 'all' | 'any';
  conditions: StateCondition[];
}

export interface Draft {
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
  /** Und/Oder-Gruppen aus Gerätebedingungen (Punkt 152). */
  groups: ConditionGroup[];
  /** Bedingungen, die der Editor (noch) nicht bauen kann – etwa
   *  geschachtelte und/oder-Gruppen aus der config.yaml. Sie werden
   *  unverändert mitgespeichert, statt beim Öffnen stumm zu verschwinden. */
  extraConditions: Record<string, unknown>[];
  /** Wie die Bedingungen verknüpft sind: alle oder eine genügt. */
  match: 'all' | 'any';
  /** Erlaubte Wochentage der Uhrzeit-Bedingung (0 = Montag). Leer = alle. */
  weekdays: number[];
  /** «ausser an Feiertagen» (Punkt 154): Auffahrt ist ein Donnerstag,
   *  aber kein Werktag - der Hub kennt die Luzerner Feiertage. */
  exceptHolidays: boolean;
  /** Was der Ablauf tut – der Reihe nach. */
  steps: StepDraft[];
  /** Was stattdessen läuft, wenn die Bedingungen nicht passen. */
  elseSteps: StepDraft[];
  /** Was geschieht, wenn er noch läuft und erneut ausgelöst wird:
   *  «single» verwirft den zweiten Auslöser, «restart» beginnt von vorn. */
  mode: 'single' | 'restart';
  /** Frühestens wieder nach so vielen Minuten. Leer = kein Abstand. */
  cooldownMinutes: string;
  /** Frei benannte Kategorie zum Gruppieren in der Liste. */
  category: string;
  /** Ausgeschaltet: bleibt stehen, läuft aber nicht. */
  enabled: boolean;
}

export const EMPTY: Draft = {
  alias: '',
  triggers: [{ ...EMPTY_TRIGGER }],
  conditionKind: 'none',
  conditionSun: 'down',
  conditionAfter: '',
  conditionBefore: '',
  stateConditions: [],
  groups: [],
  extraConditions: [],
  match: 'all',
  weekdays: [],
  exceptHolidays: false,
  steps: [{ ...EMPTY_STEP }],
  elseSteps: [],
  mode: 'single',
  cooldownMinutes: '',
  category: '',
  enabled: true,
};

/** Einen Trigger-Entwurf in die gespeicherte Form bringen (rein, testbar). */
export function triggerToConfig(t: TriggerDraft): BausteinConfig {
  const jitter = Math.max(0, Math.min(240, Number(t.jitter) || 0));
  if (t.kind === 'sun') {
    return {
      type: 'sun',
      event: t.sunEvent,
      offset: Number(t.sunOffset) || 0,
      ...(jitter > 0 ? { jitter } : {}),
    };
  }
  if (t.kind === 'time') {
    return { type: 'time', at: t.at, ...(jitter > 0 ? { jitter } : {}) };
  }
  if (t.kind === 'calendar') {
    const vorlauf = Math.max(0, Number(t.calendarBefore) || 0);
    return {
      type: 'calendar',
      ...(t.calendarContains.trim() ? { contains: t.calendarContains.trim() } : {}),
      event: t.calendarEvent,
      ...(vorlauf > 0 ? { minutes_before: vorlauf } : {}),
    };
  }
  if (t.kind === 'interval') {
    return { type: 'interval', seconds: Math.max(10, Number(t.intervalSeconds) || 600) };
  }
  const hold = Math.max(0, Number(t.forMinutes) || 0) * 60;
  if (t.kind === 'availability') {
    const trigger: { type: string; entity_id: string; to: boolean; for?: number } = {
      type: 'availability',
      entity_id: t.entityId,
      to: t.availabilityTo !== 'weg',
    };
    if (hold > 0) trigger.for = hold;
    return trigger;
  }
  if (t.kind === 'threshold') {
    // Löst beim Übertritt aus, nicht bei jeder Schwankung darunter: Der
    // Tumbler ist fertig, wenn die Leistung von «über 5 W» auf «unter 5 W»
    // fällt – nicht jedes Mal, wenn 2.1 W zu 2.0 W wird.
    const trigger: BausteinConfig = { type: 'state', entity_id: t.entityId };
    if (t.attribute) trigger.attribute = t.attribute;
    trigger[t.thresholdOp] = Number(t.thresholdValue) || 0;
    if (hold > 0) trigger.for = hold;
    return trigger;
  }
  if (t.kind === 'geofence') {
    // Ein Geofence ist im Hub ein gewöhnlicher Zustand (home/away) – der
    // eigene Auslöser-Typ ist reine Bedienhilfe, damit niemand wissen
    // muss, dass «Stefan kommt heim» ein Zustandswechsel ist.
    const trigger: BausteinConfig = { type: 'state', entity_id: t.entityId, to: t.toState };
    if (hold > 0) trigger.for = hold;
    return trigger;
  }
  const state: BausteinConfig = { type: 'state', entity_id: t.entityId, to: t.toState };
  if (t.fromState) state.from = t.fromState;
  if (t.attribute) state.attribute = t.attribute;
  if (hold > 0) state.for = hold;
  return state;
}

/** Umgekehrt: gespeicherter Trigger → Entwurf (rein, testbar). */
export function triggerFromConfig(t: BausteinConfig): TriggerDraft {
  const threshold = t?.above !== undefined || t?.below !== undefined;
  return {
    ...EMPTY_TRIGGER,
    kind:
      t?.type === 'time'
        ? 'time'
        : t?.type === 'calendar'
          ? 'calendar'
        : t?.type === 'sun'
          ? 'sun'
          : t?.type === 'interval'
            ? 'interval'
            : t?.type === 'availability'
              ? 'availability'
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
    availabilityTo: t?.type === 'availability' && t?.to === true ? 'wieder-da' : 'weg',
    jitter: t?.jitter ? String(t.jitter) : '',
    calendarContains: String(t?.contains ?? ''),
    calendarEvent: t?.event === 'end' ? 'end' : 'start',
    calendarBefore: t?.minutes_before ? String(t.minutes_before) : '',
  };
}

/** Sauger mit Raumsteuerung? Dann bietet der Editor 'Räume saugen' an. */
export function vacuumRooms(entity: Entity | undefined): { id: number; name: string }[] {
  if (!entity || !entity.commands.includes('clean_rooms')) return [];
  return Array.isArray(entity.state.rooms) ? entity.state.rooms : [];
}

export function hatWartezeit(steps: { kind: string }[]): boolean {
  // Dimmen dauert - für «restart oder nicht» zählt es wie eine Wartezeit.
  return steps.some(
    (step) => step.kind === 'delay' || step.kind === 'wait_until' || step.kind === 'fade'
  );
}

export const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** «Werktage», «Wochenende» oder die Kürzel (rein, testbar). */
export function weekdayLabel(days: number[]): string {
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

/** «heute 21:12», «morgen 06:00» oder «Mo 09:00» (rein, testbar).
 *
 *  Für die nächste Ausführung (Punkt 161) und «ruht bis» (Punkt 159) -
 *  ein nackter Zeitstempel beantwortet die Frage «wann?» nicht. */
export function zeitpunktLabel(ts: number, jetzt: Date = new Date()): string {
  const dann = new Date(ts * 1000);
  const uhr = `${String(dann.getHours()).padStart(2, '0')}:${String(
    dann.getMinutes()
  ).padStart(2, '0')}`;
  const tage = Math.floor(
    (new Date(dann.getFullYear(), dann.getMonth(), dann.getDate()).getTime() -
      new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate()).getTime()) /
      86_400_000
  );
  if (tage === 0) return `heute ${uhr}`;
  if (tage === 1) return `morgen ${uhr}`;
  return `${WEEKDAY_LABELS[(dann.getDay() + 6) % 7]} ${uhr}`;
}

/** Das Symbol zur Auslöserart (Punkt 162) - der Zeilenanfang der Liste
 *  sagt damit auf einen Blick, WORAUF ein Ablauf hört (rein, testbar). */
export function triggerIcon(automation: Automation): string {
  const trigger = automation.triggers?.[0] ?? {};
  const art = String(trigger.type ?? 'state');
  if (art === 'time') return 'time-outline';
  if (art === 'sun') return 'sunny-outline';
  if (art === 'interval') return 'repeat-outline';
  if (art === 'calendar') return 'calendar-outline';
  if (art === 'availability') return 'pulse-outline';
  if ('above' in trigger || 'below' in trigger) return 'analytics-outline';
  if (String(trigger.entity_id ?? '').startsWith('geofence.')) return 'location-outline';
  if (trigger.attribute === 'ring') return 'notifications-outline';
  if (trigger.attribute === 'motion') return 'walk-outline';
  return 'flash-outline';
}

/** Lesbarer Text für eine Wartezeit (rein, testbar). */
export function delayLabel(seconds: string): string {
  const value = Number(seconds) || 0;
  if (value < 60) return `${value} Sekunden`;
  const minutes = Math.round(value / 60);
  return `${minutes} Minute${minutes === 1 ? '' : 'n'}`;
}

/** Höchste eintippbare Haltedauer: eine Woche.
 *
 * Nicht, weil längere unmöglich wären, sondern weil sich «10080» noch
 * erklären lässt und ein verrutschtes «100000» (69 Tage) nicht. */
export const MAX_MINUTEN = 7 * 24 * 60;

/** Eine Minutenzahl so, wie man sie ausspricht (rein, testbar).
 *
 * «125» liest sich schlechter als «2 h 5 min» – und beim Prüfen der
 * eigenen Eingabe zählt genau das: ob die Zahl das meint, was man wollte.
 * Ganze Tage bleiben Tage: «1440 min» wäre richtig und trotzdem
 * unlesbar. */
export function minutenLabel(minutes: string | number): string {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value === 0) return 'sofort';
  if (value % 1440 === 0) {
    const tage = value / 1440;
    return `${tage} Tag${tage === 1 ? '' : 'e'}`;
  }
  return dauerText(value);
}

/** Eine eingetippte Haltedauer auf das, was gespeichert wird (rein, testbar).
 *
 * Leer, null oder Unsinn heisst «sofort» – das ist die Vorgabe und der
 * einzige Wert, bei dem das Feld leer bleiben darf. */
export function minutenWert(text: string): string {
  const value = Math.round(Number(text) || 0);
  if (value <= 0) return '';
  return String(Math.min(MAX_MINUTEN, value));
}

/** Die Bedingung eines Ablaufs in die gespeicherte Form (rein, testbar). */
export function buildConditions(draft: Draft): BausteinConfig[] {
  const conditions: BausteinConfig[] = [];
  if (draft.conditionKind === 'sun') {
    conditions.push({ type: 'sun', state: draft.conditionSun });
  } else if (draft.conditionKind === 'time') {
    const condition: BausteinConfig = { type: 'time' };
    if (draft.conditionAfter) condition.after = draft.conditionAfter;
    if (draft.conditionBefore) condition.before = draft.conditionBefore;
    // Alle sieben Tage anzugeben heisst dasselbe wie keinen – dann lieber
    // das Feld weglassen, damit die gespeicherte Form schlank bleibt.
    if (draft.weekdays.length > 0 && draft.weekdays.length < 7) {
      condition.weekdays = [...draft.weekdays].sort((a, b) => a - b);
    }
    if (draft.exceptHolidays) condition.except_holidays = true;
    // Eine Bedingung ganz ohne Angabe wäre sinnlos – dann keine.
    if (
      condition.after ||
      condition.before ||
      condition.weekdays ||
      condition.except_holidays
    ) {
      conditions.push(condition);
    }
  }
  for (const entry of draft.stateConditions) {
    const built = stateConditionToConfig(entry);
    if (built) conditions.push(built);
  }
  // Und/Oder-Gruppen (Punkt 152): eine Gruppe ohne brauchbare Bedingung
  // wäre eine leere Klammer - die fällt weg.
  for (const gruppe of draft.groups ?? []) {
    const subs = gruppe.conditions
      .map(stateConditionToConfig)
      .filter((sub): sub is BausteinConfig => sub !== null);
    if (subs.length > 0) {
      conditions.push({ type: 'group', match: gruppe.match, conditions: subs });
    }
  }
  // Was der Editor nicht kennt (tiefere Gruppen u.ä.), bleibt erhalten.
  conditions.push(...(draft.extraConditions ?? []));
  return conditions;
}

/** Eine Gerätebedingung in die gespeicherte Form (rein, testbar). */
export function stateConditionToConfig(entry: StateCondition): BausteinConfig | null {
  if (!entry.entity_id) return null;
  const base: BausteinConfig = { type: 'state', entity_id: entry.entity_id };
  // Ohne Angabe vergleicht der Hub den Zustand selbst - dann gehört das
  // Feld auch nicht in die gespeicherte Form.
  if (entry.attribute) base.attribute = entry.attribute;
  if (entry.op === 'above') return { ...base, above: Number(entry.value) || 0 };
  if (entry.op === 'below') return { ...base, below: Number(entry.value) || 0 };
  return { ...base, equals: entry.value };
}

/** Die Auslöser eines Ablaufs, die Helligkeit messen (rein, testbar).
 *
 * «An die Helligkeit angepasst» braucht einen Melder, der Lux liefert.
 * Ein Bewegungsmelder ohne Helligkeitsfühler meldet nur an/aus – die
 * Wahl gehört dann gar nicht erst auf den Bildschirm. */
export function melderMitLux(
  draft: { triggers: { entityId: string }[] },
  entities: Entity[]
): Entity[] {
  const ids = Array.from(
    new Set(draft.triggers.map((trigger) => trigger.entityId).filter(Boolean))
  );
  return ids
    .map((id) => entities.find((entity) => entity.id === id))
    .filter(
      (entity): entity is Entity => !!entity && typeof entity.state.illumination === 'number'
    );
}

/** Weisstöne, die zur Auswahl stehen: Mirek und was man dazu sagt.
 *
 * Mirek statt Kelvin, weil die Lampen so rechnen (153 = 6500 K, 500 =
 * 2000 K) – auf dem Knopf steht trotzdem die Kelvin-Zahl, die auf jeder
 * Glühbirnen-Packung steht. */
export const WEISSTOENE: { key: string; label: string; mirek: number }[] = [
  { key: 'warm', label: 'warmweiss', mirek: 370 },
  { key: 'neutral', label: 'neutralweiss', mirek: 286 },
  { key: 'kalt', label: 'tageslichtweiss', mirek: 200 },
];

/** Hat dieser Schritt Licht-Feinheiten – Farbe, Weiss oder Anpassung?
 *  (rein, testbar)
 *
 * Nur dann wird daraus ein Licht-Schritt. Ein blosses «einschalten»
 * bleibt das schlichte Kommando, das es immer war. */
export function istLichtFein(action: {
  command: string;
  color?: string;
  colorTemp?: number;
  adaptive?: boolean;
}): boolean {
  return !!(action.adaptive || action.color || action.colorTemp);
}

/** Einen einzelnen Schritt in die gespeicherte Form (rein, testbar).
 *
 * Ein Schritt kann mehrere Aktionen ergeben: «Gerät schalten» mit drei
 * angehakten Lampen sind drei Kommandos.
 */
export function stepToActions(step: StepDraft): BausteinConfig[] {
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
        to: step.notifyTo || 'all',
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
  if (step.kind === 'fade') {
    if (!step.fadeEntityId) return [];
    return [
      {
        type: 'fade',
        entity_id: step.fadeEntityId,
        to: Math.max(0, Math.min(100, Number(step.fadeTo) || 0)),
        minutes: Math.max(0.1, Math.min(120, Number(step.fadeMinutes) || 10)),
      },
    ];
  }
  if (step.kind === 'delay') {
    const seconds = Number(step.seconds) || 0;
    return seconds > 0 ? [{ type: 'delay', seconds }] : [];
  }
  if (step.kind === 'wait_until') {
    if (!step.waitEntityId) return [];
    const action: BausteinConfig = {
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
      // Licht mit Feinheiten bekommt den eigenen Aktionstyp: Helligkeit,
      // Farbe und Weissanteil gehen dann in einem Zug an die Lampe,
      // statt als drei Kommandos hintereinander - dazwischen sähe man
      // sie sichtbar umspringen. Ohne Feinheiten bleibt alles, wie es
      // war; ein bestehender Ablauf ändert sich durch Öffnen nicht.
      if (istLichtFein(action)) {
        const licht: BausteinConfig = { type: 'light', entity_id: action.entity_id };
        if (action.adaptive) licht.brightness = 'adaptive';
        else if (action.command === 'set_brightness') {
          licht.brightness = action.brightness ?? 50;
        }
        if (action.color) licht.color = action.color;
        else if (action.colorTemp) licht.color_temp = action.colorTemp;
        return licht;
      }
      const built: BausteinConfig = {
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
export function stepsToActions(steps: StepDraft[]): BausteinConfig[] {
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
export function actionsToSteps(actions: BausteinConfig[]): StepDraft[] {
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
    } else if (type === 'light') {
      const adaptive = String(action.brightness ?? '') === 'adaptive';
      const entry = {
        entity_id: action.entity_id,
        command:
          adaptive || typeof action.brightness === 'number'
            ? 'set_brightness'
            : 'turn_on',
        rooms: [],
        brightness: typeof action.brightness === 'number' ? action.brightness : undefined,
        adaptive: adaptive || undefined,
        color: action.color ? String(action.color) : undefined,
        colorTemp: action.color_temp ? Number(action.color_temp) : undefined,
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
        notifyTo: action.to && action.to !== 'all' ? String(action.to) : '',
      });
    } else if (type === 'broadcast') {
      steps.push({
        ...EMPTY_STEP,
        kind: 'broadcast',
        broadcastText: action.text ?? '',
        broadcastSpeakers: Array.isArray(action.speakers) ? action.speakers : [],
      });
    } else if (type === 'fade') {
      steps.push({
        ...EMPTY_STEP,
        kind: 'fade',
        fadeEntityId: action.entity_id ?? '',
        fadeTo: String(action.to ?? 0),
        fadeMinutes: String(action.minutes ?? 10),
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

/** Lässt sich diese Gruppe im Editor bearbeiten? Nur eine Ebene aus
 *  reinen Gerätebedingungen - alles andere bleibt extraCondition. */
function editierbareGruppe(entry: BausteinConfig): boolean {
  return (
    entry.type === 'group' &&
    Array.isArray(entry.conditions) &&
    entry.conditions.length > 0 &&
    entry.conditions.every(
      (sub: BausteinConfig) => (sub?.type ?? 'state') === 'state' && sub?.entity_id
    )
  );
}

function stateConditionFromConfig(entry: BausteinConfig): StateCondition {
  return {
    entity_id: entry.entity_id,
    op: ('above' in entry ? 'above' : 'below' in entry ? 'below' : 'is') as Compare,
    value: String(entry.above ?? entry.below ?? entry.equals ?? 'on'),
    ...(entry.attribute ? { attribute: String(entry.attribute) } : {}),
  };
}

export function toDraft(automation: Automation): Draft {
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
      // Beim Speichern wird das attribute-Feld mitgeschrieben, beim
      // Öffnen fiel es bisher weg: Wer einen Ablauf mit «Helligkeit
      // unter 20» erneut speicherte, verglich danach den Zustand.
      .map(stateConditionFromConfig),
    // Einfache Und/Oder-Gruppen kann der Editor jetzt selbst (Punkt 152).
    groups: all.filter(editierbareGruppe).map((entry) => ({
      match: entry.match === 'any' ? ('any' as const) : ('all' as const),
      conditions: entry.conditions.map(stateConditionFromConfig),
    })),
    // Alles, was der Editor nicht abbilden kann (tiefere Gruppen, zweite
    // Zeitfenster), unverändert mittragen – sonst löscht «Öffnen und
    // Speichern» genau die Bedingung, die jemand in der config.yaml
    // gebaut hat.
    extraConditions: all.filter(
      (entry) =>
        entry !== condition &&
        !((entry.type ?? 'state') === 'state' && entry.entity_id) &&
        !editierbareGruppe(entry)
    ),
    match: automation.match === 'any' ? 'any' : 'all',
    weekdays: Array.isArray(condition.weekdays) ? condition.weekdays.map(Number) : [],
    exceptHolidays: condition.except_holidays === true,
    steps: withAtLeastOne(actionsToSteps(automation.actions ?? [])),
    elseSteps: actionsToSteps(automation.otherwise ?? []),
    mode: automation.mode === 'restart' ? 'restart' : 'single',
    cooldownMinutes: automation.cooldown
      ? String(Math.round(automation.cooldown / 60))
      : '',
    category: automation.category ?? '',
    enabled: automation.enabled !== false,
  };
}

/** Ein Ablauf ohne einen einzigen Schritt wäre im Editor eine leere Seite. */
export function withAtLeastOne(steps: StepDraft[]): StepDraft[] {
  return steps.length > 0 ? steps : [{ ...EMPTY_STEP }];
}

/** Wie das Licht in der Listenzeile steht (rein, testbar). */
export function lichtKurz(action: BausteinConfig): string {
  if (String(action.brightness ?? '') === 'adaptive') return 'angepasst';
  if (action.brightness != null) return `${action.brightness} %`;
  return 'an';
}

export function describe(automation: Automation): string {
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
          : trigger.type === 'availability'
            ? `wenn ${trigger.entity_id} ${trigger.to === true ? 'wiederkommt' : 'verstummt'}`
            : `wenn ${trigger.entity_id}${
                trigger.attribute ? `.${trigger.attribute}` : ''
              } → ${trigger.to ?? 'sich ändert'}`;
  const dann = !action
    ? 'ohne Aktion'
    : action.type === 'light'
      ? `${action.entity_id}: Licht ${lichtKurz(action)}`
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

