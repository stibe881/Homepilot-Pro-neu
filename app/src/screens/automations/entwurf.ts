/**
 * Reine Logik des Ablauf-Editors: Typen, Entwurf ↔ gespeicherte Form, Beschreibungen.
 *
 * Herausgelöst aus AutomationsScreen.tsx (Punkt 21 der Werkbank).
 */

import { Entity } from '../../api/types';
import { datumUhr, dauerText } from '../../lib/format';
import type { LaufEintrag } from '../../lib/laufzeile';
import { befehlWort, nameVon } from '../../lib/ablaufsatz';
import {
  SAMMEL_ANWESENHEIT,
  ZUHAUSE,
  anwesenheitSatz,
  ausTrigger,
  istOrtsmelder,
  ortsSatz,
  zuTrigger,
} from '../../lib/ortsausloeser';
import { musikBefehl, musikSchluessel, richtungBefehl, richtungSchluessel } from '../../lib/szenen';

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
  /** Nachts (22–8 Uhr) keine Nachricht und keine Durchsage – der Rest
   *  des Ablaufs läuft weiter. */
  quiet_night?: boolean;
  /** Ruht bis (Unix-Sekunden) - «aus bis morgen», Punkt 159. */
  quiet_until?: number | null;
  /** Nächster geplanter Lauf (Unix-Sekunden), nur Zeit/Sonne - Punkt 161. */
  next_run?: number | null;
  /** Der letzte Lauf. Fehlt er, wurde der Ablauf nie ausgelöst - und
   *  das ist eine eigene Auskunft, nicht dasselbe wie «lief und tat
   *  nichts». Siehe lib/laufzeile.ts. */
  last_run?: LaufEintrag | null;
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
  /** Ob der Lauf auch gewirkt hat – ein paar Sekunden nach dem Lauf am
   *  Gerät nachgesehen (hub/core/wirkung.py). Fehlt bei Läufen, an denen
   *  es nichts Prüfbares gab, und bei allen aus der Zeit davor. */
  effect?: {
    urteil: 'gewirkt' | 'teilweise' | 'wirkungslos';
    geprueft: number;
    nicht: string[];
  } | null;
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
  // Die Entfernung von zuhause, in Metern. Damit wird «wenn Stefan
  // näher als 2 km ist, Storen hoch» ein gewöhnlicher Schwellenwert -
  // ohne eigene Auslöser-Art. Der Geofence liefert sie, sobald eine
  // Position bekannt ist (siehe integrations/geofence.py).
  distance: 'Entfernung von zuhause (m)',
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

/** Wie eine Kamera-Erkennung heisst, wenn man sie auswählt.
 *
 *  Der Hub führt je Erkennung ein Feld `detected_…`. Die Beschriftung
 *  hier ist bewusst ein Satzteil («erkennt eine Person»), weil sie im
 *  Editor hinter dem Gerätenamen steht. */
export const ERKENNUNGEN: Record<string, string> = {
  person: 'erkennt eine Person',
  vehicle: 'erkennt ein Fahrzeug',
  package: 'erkennt ein Paket',
  animal: 'erkennt ein Tier',
  license_plate: 'erkennt ein Kennzeichen',
  face: 'erkennt ein Gesicht',
  baby_cry: 'hört ein Baby schreien',
  smoke_alarm: 'hört einen Rauchmelder',
  co_alarm: 'hört einen CO-Melder',
  siren: 'hört eine Sirene',
  speaking: 'hört jemanden sprechen',
  burglar: 'hört einen Einbruchalarm',
  glass_break: 'hört Glas brechen',
  bark: 'hört einen Hund bellen',
  car_alarm: 'hört einen Autoalarm',
  car_horn: 'hört eine Hupe',
};

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
  // Kameras können mehr als Bewegung: Person, Paket, Baby-Schreien. Der
  // Hub führt je Erkennung ein eigenes Feld, und er legt nur die an, die
  // diese Kamera wirklich kann - hier steht also nichts, was ins Leere
  // liefe.
  for (const feld of Object.keys(entity?.state ?? {})) {
    if (!feld.startsWith('detected_')) continue;
    const art = feld.slice('detected_'.length);
    ereignisse.push({
      key: `${feld}:on`,
      label: ERKENNUNGEN[art] ?? `erkennt ${art}`,
      attribute: feld,
      to: 'on',
    });
  }
  // Der Türsensor eines Schlosses (Nuki Pro, Matter) meldet «door», nicht
  // «state» - dort steht auf-/zugeschlossen. Beides ist nicht dasselbe:
  // Wer die Haustüre öffnet, ohne abzuschliessen, war hier bisher nicht
  // auslösbar, und «aufgeschlossen» wäre die falsche Antwort auf «hat
  // jemand die Türe geöffnet?».
  if (entity && 'door' in entity.state) {
    ereignisse.push({
      key: 'door:open',
      label: 'wird geöffnet',
      attribute: 'door',
      to: 'open',
    });
    ereignisse.push({
      key: 'door:closed',
      label: 'wird geschlossen',
      attribute: 'door',
      to: 'closed',
    });
  }
  return [
    ...ereignisse,
    ...plainStates(entity).map((zustand) => ({ ...zustand, to: zustand.key })),
  ];
}

/** Melder, deren «an» in Wahrheit «offen» heisst. */
const OFFEN_KLASSEN = ['contact', 'door', 'window', 'garage', 'opening'];

/** Die Zustände des Felds `state` selbst, je Geräteart. */
export function plainStates(entity?: Entity): { key: string; label: string }[] {
  // Anwesenheit zählt nicht in «an/aus», sondern in «zuhause/weg». Die
  // Geofence-Entitäten erkennt man am Feld `place`; ohne diesen Zweig
  // stand im Editor «an», und der Ablauf wartete auf einen Zustand, den
  // es dort nie gibt.
  if (entity && 'place' in entity.state) {
    return [
      { key: 'home', label: 'zuhause' },
      { key: 'away', label: 'weg' },
    ];
  }
  // Die Sammelfrage «ist überhaupt noch jemand da?» (geofence.anyone_home).
  // Sie zählt technisch in an/aus, und genau so stand es im Editor: «an».
  // Wer «wenn der Letzte geht» bauen wollte, musste raten, ob das nun
  // «an» oder «aus» ist - und die Hälfte rät falsch. Erkennbar ist sie an
  // der Liste der Abwesenden, die sie mitführt.
  if (entity && 'away' in entity.state) {
    return [
      { key: 'on', label: 'jemand ist zuhause' },
      { key: 'off', label: 'niemand ist zuhause' },
    ];
  }
  // Ein Tür- oder Fensterkontakt meldet technisch «an»/«aus». Wer einen
  // Ablauf für die Haustüre baut, sucht aber «geöffnet» - und wählt im
  // Zweifel das Falsche, weil «an» bei einer Türe nach Licht klingt.
  if (
    entity?.kind === 'binary_sensor' &&
    OFFEN_KLASSEN.includes(String(entity.state.device_class ?? ''))
  ) {
    return [
      { key: 'on', label: 'geöffnet' },
      { key: 'off', label: 'geschlossen' },
    ];
  }
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
      // Nicht jedes «Schloss» hat einen Riegel. Eine Gegensprechanlage
      // ist ein Türöffner: Sie kennt nur «wurde geöffnet» und meldet nie
      // «aufgeschlossen». Wer das trotzdem als Auslöser wählte, baute
      // einen Ablauf, der auf einen Zustand wartet, den es an diesem
      // Gerät nicht gibt - und der deshalb nie läuft, ohne einen Grund
      // zu nennen.
      if (!entity.commands.includes('lock') && entity.commands.includes('open_door')) {
        return [
          { key: 'opened', label: 'wird geöffnet' },
          { key: 'online', label: 'bereit' },
          { key: 'offline', label: 'nicht erreichbar' },
        ];
      }
      return [
        { key: 'unlocked', label: 'aufgeschlossen' },
        { key: 'locked', label: 'abgeschlossen' },
      ];
    case 'media_player':
      // Ein Fernseher kennt aus und an, eine Musikbox nicht: Der Cast
      // ist immer eingeschaltet, er spielt bloss nichts. Woran man es
      // erkennt, ist der Befehl - wer sich ausschalten lässt, hat auch
      // einen Zustand «aus». Ohne diesen Zweig liess sich «wenn ich den
      // Fernseher ausschalte» im Editor gar nicht auswählen.
      return [
        ...(entity.commands.includes('turn_off')
          ? [
              { key: 'off', label: 'aus' },
              { key: 'on', label: 'an' },
            ]
          : []),
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

/** Zieht eine getippte Uhrzeit gerade (rein, testbar).
 *
 *  Die Zeitfelder sind freie Eingaben, und getippt wird alles Mögliche:
 *  «22», «22.00», «2200», «8:5». Der Hub versteht das inzwischen auch,
 *  aber gespeichert werden soll trotzdem die saubere Form - sonst steht
 *  beim nächsten Öffnen wieder «2200» da und man traut ihm nicht.
 *
 *  Was keine Uhrzeit ist, bleibt unverändert stehen: Es kommentarlos zu
 *  löschen wäre die unfreundlichere Antwort auf einen Tippfehler. */
export function normalisiereZeit(roh: string): string {
  const text = String(roh ?? '').trim().replace(/\./g, ':').replace(/\s/g, '');
  if (!text) return '';
  let kern = text;
  if (!kern.includes(':') && /^\d+$/.test(kern)) {
    kern = kern.length > 2 ? `${kern.slice(0, -2)}:${kern.slice(-2)}` : `${kern}:00`;
  }
  const treffer = /^(\d{1,2}):(\d{1,2})$/.exec(kern);
  if (!treffer) return roh;
  const stunde = Number(treffer[1]);
  const minute = Number(treffer[2]);
  if (stunde > 23 || minute > 59) return roh;
  return `${String(stunde).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Erklärt ein Zeitfenster, das über Mitternacht geht (rein, testbar).
 *
 *  «ab 22:00 bis 06:00» ist wörtlich genommen leer - keine Uhrzeit ist
 *  gleichzeitig später als 22 und früher als 6. Der Hub liest es als
 *  Nachtfenster, und genau das gehört dazugeschrieben: Sonst traut man
 *  der Eingabe nicht und baut zwei Abläufe. */
export function zeitfensterHinweis(after: string, before: string): string | null {
  const minuten = (text: string): number | null => {
    const treffer = /^(\d{1,2}):(\d{2})$/.exec(normalisiereZeit(text));
    if (!treffer) return null;
    return Number(treffer[1]) * 60 + Number(treffer[2]);
  };
  const von = minuten(after);
  const bis = minuten(before);
  if (von === null || bis === null || von <= bis) return null;
  return `Geht über Mitternacht: gilt von ${normalisiereZeit(after)} bis ${normalisiereZeit(
    before
  )} am nächsten Morgen.`;
}

/**
 * Wartet dieser Auslöser auf etwas, das es am Gerät nicht gibt? (rein,
 * testbar)
 *
 * Der Fall entsteht beim Gerätewechsel und bei Abläufen aus früheren
 * Fassungen: Ein Ablauf horcht auf «aufgeschlossen», das Gerät ist aber
 * eine Gegensprechanlage ohne Riegel und meldet nie etwas anderes als
 * «bereit». Er läuft dann nie und nennt keinen Grund - stumm zu
 * scheitern ist die unangenehmste Art zu scheitern.
 *
 * Zurück kommt der Satz, der im Editor darunter steht, oder null.
 */
export function unbekannterZustand(
  entity: Entity | undefined,
  attribute: string,
  to: string
): string | null {
  if (!entity || !to) return null;
  const optionen = stateOptions(entity);
  if (optionen.length === 0) return null;
  if (optionen.some((option) => option.key === optionKey(attribute || undefined, to))) {
    return null;
  }
  return (
    `«${entity.name}» meldet nie «${to}» – der Ablauf würde nie laufen. ` +
    `Möglich sind: ${optionen.map((option) => option.label).join(', ')}.`
  );
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

/**
 * Was die Nachschau ergab – oder nichts (rein, testbar).
 *
 * «Ausgeführt» heisst nur: abgeschickt. Ob das Licht danach brannte,
 * sieht der Hub ein paar Sekunden später nach. Gemeldet wird nur, was
 * *nicht* gewirkt hat: Bei jedem Lauf «hat gewirkt» danebenzuschreiben
 * hiesse, die eine Zeile zu übersehen, auf die es ankommt.
 */
export function wirkungText(run: Run): string | null {
  const effect = run.effect;
  if (!effect || effect.urteil === 'gewirkt') return null;
  const namen = effect.nicht.join(', ');
  if (effect.urteil === 'wirkungslos') {
    return namen ? `wirkte nicht: ${namen}` : 'wirkte nicht';
  }
  return namen ? `wirkte nur halb – ohne ${namen}` : 'wirkte nur halb';
}

export function lastRunText(runs: Run[], automationId: string): string {
  const run = runs.find((entry) => entry.automation_id === automationId);
  if (!run) return 'Noch nicht gelaufen';
  // Die Nachschau gehört in die zugeklappte Zeile: Ein Ablauf, der
  // abgeschickt hat und nichts bewirkte, ist genau der, den man sucht -
  // und man sucht ihn, ohne vorher aufzuklappen.
  const wirkung = wirkungText(run);
  return wirkung ? `${runLine(run)} · ${wirkung}` : runLine(run);
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
/**
 * Ein Handgriff unter einer Nachricht.
 *
 * Ein Tipp bringt einen an den richtigen Ort - aber oft weiss man schon
 * vorher, was man dort tun will. «Waschmaschine fertig» und der Trockner
 * soll laufen. Entweder eine Szene oder ein Gerät samt Befehl.
 */
export interface NotifyKnopf {
  label: string;
  sceneId?: string;
  entityId?: string;
  command?: string;
}

export type StepKind = 'command' | 'toggle_all' | 'scene' | 'hue_scene' | 'notify' | 'broadcast' | 'presence' | 'delay' | 'wait_until' | 'fade' | 'music';

/** Was ein Musik-Schritt tun kann. */
export type MusikTat = 'favorite' | 'sleep' | 'pause_all' | 'night' | 'fade';
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
  /** Ortsauslöser: an welchem Ort. `home` fürs Zuhause, sonst die
   *  Kennung eines Ortes des Hubs oder aus Life360. Ob ankommen oder
   *  weggehen, sagt weiterhin `toState`. */
  ortId: string;
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
    /** Nachlauf in Sekunden – danach schaltet der Hub die Lampe aus. */
    offAfter?: number;
    /** Lamellenwinkel in Prozent, wenn das Kommando 'set_tilt' ist. */
    tilt?: number;
    /** Ziel-Lautstärke in Prozent, wenn das Kommando 'set_volume' ist. */
    volume?: number;
    /** Zieltemperatur, wenn das Kommando 'set_temperature' ist – beim
     *  Grill in seiner eigenen Einheit (°C oder °F). */
    temperature?: number;
    /** Name der Playlist, wenn das Kommando 'play_playlist' ist. */
    playlist?: string;
    /** Name des Senders, wenn das Kommando 'play_radio' ist. */
    station?: string;
    /** Paket-ID der App, wenn das Kommando 'launch_app' ist. */
    app?: string;
    /** Auf welcher Box die Playlist spielen soll. Leer = die zuletzt
     *  benutzte. */
    device?: string;
    /** Playlist zufällig abspielen. undefined lässt die Einstellung des
     *  Kontos, wie sie ist. */
    shuffle?: boolean;
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
  /** Wohin ein Tipp auf die Nachricht führt: 'raum:Küche',
   *  'familie:shopping', 'bereich:system' … Leer heisst: die App öffnet
   *  sich, wie sie zuletzt stand. Siehe lib/pushziel.ts. */
  notifyZiel: string;
  /** Handgriffe, die unter der Nachricht zur Wahl stehen. Höchstens
   *  drei - mehr liest dort niemand. */
  notifyKnoepfe: NotifyKnopf[];
  /** Wartezeit in Sekunden. */
  seconds: string;
  /** «Warten bis»: worauf, und wie lange höchstens. */
  waitEntityId: string;
  waitOp: Compare;
  waitValue: string;
  waitTimeout: string;
  /** Durchsage: was gesagt wird, und auf welchen Boxen (leer = alle). */
  broadcastText: string;
  /** Anwesenheit melden: die Kennung der Person (Zone) und die Richtung.
   *  Für alle, die kein Telefon tragen - ein Knopf am Schlüsselanhänger
   *  oder ein eigener Code am Türschloss meldet die Ankunft an ihrer
   *  Stelle (hub/core/automation.py: _anwesenheit). */
  presenceZone: string;
  presenceEvent: 'enter' | 'leave';
  broadcastSpeakers: string[];
  /** Dimmen über Zeit (Punkt 157): welches Licht, wohin, wie lange. */
  fadeEntityId: string;
  fadeTo: string;
  fadeMinutes: string;
  /** Musik-Schritt: was getan wird und womit. Alles davon gab es schon
   *  als Knopf in der App - «Wenn alle weg sind: Musik aus» ging aber
   *  nur über den nackten Pause-Befehl je Box, und wer eine vergass,
   *  merkte es erst beim Heimkommen. */
  musikTat: MusikTat;
  musikFavorit: string;
  musikEntityId: string;
  musikMinuten: string;
  musikLautstaerke: string;
  musikAn: boolean;
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
  notifyZiel: '',
  notifyKnoepfe: [],
  seconds: '60',
  waitEntityId: '',
  waitOp: 'is',
  waitValue: 'off',
  waitTimeout: '300',
  broadcastText: '',
  presenceZone: '',
  presenceEvent: 'enter',
  broadcastSpeakers: [],
  fadeEntityId: '',
  fadeTo: '0',
  fadeMinutes: '10',
  musikTat: 'pause_all',
  musikFavorit: '',
  musikEntityId: '',
  musikMinuten: '30',
  musikLautstaerke: '30',
  musikAn: true,
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
  ortId: ZUHAUSE,
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
  /** Nachts nichts melden: Nachricht und Durchsage bleiben zwischen 22
   *  und 8 Uhr aus. Für das, was ohnehin bis zum Morgen Zeit hat. */
  nachtsStill: boolean;
  /** Gesetzt, solange dieser Entwurf eine *Vorlage* ist und kein Ablauf:
   *  «neu» für eine frische, sonst die Kennung der gespeicherten. Der
   *  Editor sieht daran, dass beim Speichern eine Vorlage entsteht und
   *  kein Ablauf, der ab sofort schaltet. */
  templateId?: string;
  /** Beim Bearbeiten einer eingebauten Vorlage: Sie wird beim Sichern
   *  ausgeblendet, damit nicht zwei fast gleiche nebeneinander stehen. */
  templateHides?: string;
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
  nachtsStill: false,
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
    // Ein Geofence ist im Hub ein gewöhnlicher Zustand – der eigene
    // Auslöser-Typ ist reine Bedienhilfe, damit niemand wissen muss,
    // dass «Stefan kommt heim» ein Zustandswechsel ist.
    //
    // Der Zustand einer Zone ist der Name des engsten Ortes, in dem die
    // Person steckt. «Ankommen bei der Schule» ist also derselbe
    // Mechanismus wie «heimkommen», nur mit anderem Wort.
    const trigger: BausteinConfig = {
      type: 'state',
      entity_id: t.entityId,
      ...zuTrigger({ ort: t.ortId || ZUHAUSE, richtung: t.toState === 'away' ? 'weg' : 'an' }),
    };
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
  // Ein Ortsauslöser trägt seinen Ort im Zielzustand (`to: schule`) oder,
  // beim Verlassen eines benannten Ortes, im Ausgangszustand
  // (`from: schule`). Beides muss wieder als «Ort + Richtung» dastehen,
  // sonst zeigt der Editor bei einem gespeicherten Ablauf etwas anderes,
  // als der Hub ausführt.
  const istOrt = istOrtsmelder(t?.entity_id);
  const ortswahl = istOrt ? ausTrigger(t ?? {}) : null;
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
                : istOrt
                  ? 'geofence'
                  : 'state',
    entityId: t?.entity_id ?? '',
    toState: ortswahl ? (ortswahl.richtung === 'weg' ? 'away' : 'home') : (t?.to ?? 'on'),
    ortId: ortswahl ? ortswahl.ort : EMPTY_TRIGGER.ortId,
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

/**
 * Sagt dieser Ablauf überhaupt etwas? (rein, testbar)
 *
 * Nur dann lohnt die Frage nach der Nachtruhe. Ein Ablauf, der bloss
 * das Licht löscht, weckt niemanden - und eine Einstellung, die nichts
 * bewirkt, macht die Seite länger und die Sache unklarer.
 */
export function meldetEtwas(steps: { kind: string }[]): boolean {
  return steps.some((step) => step.kind === 'notify' || step.kind === 'broadcast');
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

/**
 * Symbole, die im Namen stehen (rein, testbar).
 *
 * Ein «Babysitter-Modus» hört auf nichts Besonderes - er wird von Hand
 * ausgelöst, und die Auslöserart hatte dafür nur den allgemeinen Blitz.
 * Ausgerechnet die Abläufe, die man am Namen kennt, sahen so alle gleich
 * aus. Sagt der Auslöser nichts, darf der Name reden.
 *
 * Bewusst nur ganze Wörter und nur wenige: «Kinderzimmer» soll nicht
 * zum Babysitter werden, und eine lange Liste rät irgendwann falsch.
 * Dasselbe Symbol wie unter Familie → Babysitter - dieselbe Sache, also
 * dasselbe Bild.
 */
export const NAMENS_SYMBOLE: { woerter: string[]; icon: string }[] = [
  { woerter: ['babysitter', 'hüten', 'hueten'], icon: 'happy-outline' },
  { woerter: ['gäste', 'gaeste', 'besuch', 'party', 'fest'], icon: 'people-outline' },
  { woerter: ['kino', 'film'], icon: 'film-outline' },
  { woerter: ['essen', 'znacht', 'abendessen', 'brunch'], icon: 'restaurant-outline' },
  { woerter: ['putzen', 'saugen', 'aufräumen', 'aufraeumen'], icon: 'sparkles-outline' },
  { woerter: ['ferien', 'urlaub'], icon: 'airplane-outline' },
  { woerter: ['lernen', 'hausaufgaben'], icon: 'school-outline' },
];

/** Das Symbol, das im Namen steckt - oder null (rein, testbar). */
export function symbolFuerNamen(name: string): string | null {
  // Nur ganze Wörter: «Kinderzimmer dunkel» ist kein Babysitter-Modus.
  const woerter = new Set(
    String(name ?? '')
      .toLowerCase()
      .split(/[^a-zäöüáàéèíìóòúù]+/i)
      .filter(Boolean)
  );
  for (const eintrag of NAMENS_SYMBOLE) {
    if (eintrag.woerter.some((wort) => woerter.has(wort))) return eintrag.icon;
  }
  return null;
}

/** Das Symbol einer Szene in der Liste (rein, testbar).
 *
 * Der Hub setzt ohne eigene Angabe «sparkles-outline». Genau das steht
 * dann auch vor «Babysitter-Modus». Sagt der Name etwas und wurde nie
 * ein Symbol gewählt, gilt der Name - was gespeichert ist, bleibt
 * unangetastet. */
export const SZENEN_STANDARD = 'sparkles-outline';

export function szenenSymbol(scene: { name: string; icon?: string }): string {
  const gewaehlt = scene.icon || SZENEN_STANDARD;
  if (gewaehlt !== SZENEN_STANDARD) return gewaehlt;
  return symbolFuerNamen(scene.name) ?? SZENEN_STANDARD;
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
  // Die Sammelanwesenheit fragt nach Menschen, nicht nach einem Ort.
  if (String(trigger.entity_id ?? '') === SAMMEL_ANWESENHEIT) return 'people-outline';
  if (istOrtsmelder(trigger.entity_id)) return 'location-outline';
  if (trigger.attribute === 'ring') return 'notifications-outline';
  if (trigger.attribute === 'motion') return 'walk-outline';
  // Erst jetzt der Name: Ein Auslöser, der etwas aussagt, sagt mehr über
  // die Zeile aus als das Wort, das jemand hingeschrieben hat.
  return symbolFuerNamen(automation.alias ?? '') ?? 'flash-outline';
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

/** Der Wert, mit dem eine Nachricht «die Kamera, die ausgelöst hat»
 *  meint – derselbe wie im Hub (core/kamera.py).
 *
 * Ein Wort statt einer Kennung: Genau das ist der Punkt, damit ein
 * Ablauf für alle Kameras gilt statt für eine. */
export const KAMERA_AUSLOESER = 'trigger';

/** Was sich in einen Nachrichtentext einsetzen lässt.
 *
 * «Jemand weint im Zimmer {raum}» gilt damit für alle Kinderzimmer, wenn
 * alle Melder Auslöser desselben Ablaufs sind - vorher brauchte jedes
 * Zimmer einen eigenen Ablauf mit eigenem Text. */
export const PLATZHALTER: { key: string; label: string }[] = [
  { key: '{raum}', label: '+ Raum' },
  { key: '{gerät}', label: '+ Gerät' },
];

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

/** Die angebotenen Nachlaufzeiten (Sekunden als Schlüssel).
 *
 * Sekunden statt Minuten, weil eine halbe Minute im WC eine ehrliche
 * Angabe ist – und weil der Hub ohnehin in Sekunden rechnet. */
export const NACHLAUF_STUFEN: { key: string; label: string }[] = [
  { key: '', label: 'an lassen' },
  { key: '30', label: '30 Sek.' },
  { key: '60', label: '1 Min.' },
  { key: '120', label: '2 Min.' },
  { key: '300', label: '5 Min.' },
  { key: '600', label: '10 Min.' },
  { key: '1800', label: '30 Min.' },
];

/** Eingetippte Minuten als Sekunden, wie sie gespeichert werden
 *  (rein, testbar). */
export function sekundenWert(text: string): string {
  const minuten = minutenWert(text);
  return minuten ? String(Number(minuten) * 60) : '';
}

/** Eine Nachlaufzeit, wie sie auf dem Knopf steht (rein, testbar).
 *
 * In der Schreibweise der Knöpfe daneben – «5 Min.», nicht «5 min»:
 * Zwei Schreibweisen in einer Reihe liest man als zwei verschiedene
 * Dinge. Erst über einer Stunde übernimmt dauerText, wo «90 Min.» keine
 * Antwort mehr wäre. */
export function nachlaufLabel(seconds: string | number): string {
  const wert = Math.max(0, Math.round(Number(seconds) || 0));
  if (wert === 0) return 'an lassen';
  if (wert < 60) return `${wert} Sek.`;
  if (wert % 60 === 0 && wert < 3600) return `${wert / 60} Min.`;
  return dauerText(wert / 60);
}

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
  offAfter?: number;
}): boolean {
  return !!(action.adaptive || action.color || action.colorTemp || action.offAfter);
}

/**
 * Ein Musik-Schritt in die gespeicherte Form (rein, testbar).
 *
 * Jede Tat braucht andere Felder; ein Schritt, dem das nötige fehlt,
 * ergibt gar keine Aktion. Ein halber Schritt, der beim Ablaufen
 * stillschweigend nichts tut, wäre schlimmer als einer, der im Editor
 * unfertig aussieht.
 */
export function musikSchrittZuAktion(step: StepDraft): BausteinConfig[] {
  const tat = step.musikTat;
  if (tat === 'pause_all') return [{ type: 'music', do: 'pause_all' }];
  if (tat === 'night') return [{ type: 'music', do: 'night', on: step.musikAn }];
  if (tat === 'favorite') {
    return step.musikFavorit
      ? [{ type: 'music', do: 'favorite', favorite: step.musikFavorit }]
      : [];
  }
  if (!step.musikEntityId) return [];
  if (tat === 'sleep') {
    return [
      {
        type: 'music',
        do: 'sleep',
        entity_id: step.musikEntityId,
        minutes: Number(step.musikMinuten) || 30,
      },
    ];
  }
  return [
    {
      type: 'music',
      do: 'fade',
      entity_id: step.musikEntityId,
      volume: Number(step.musikLautstaerke) || 30,
    },
  ];
}

/** Einen einzelnen Schritt in die gespeicherte Form (rein, testbar).
 *
 * Ein Schritt kann mehrere Aktionen ergeben: «Gerät schalten» mit drei
 * angehakten Lampen sind drei Kommandos.
 */
export function stepToActions(step: StepDraft): BausteinConfig[] {
  if (step.kind === 'toggle_all') {
    // Ein Wandtaster, zwei Räume, ein Zustand: Der Hub entscheidet beim
    // Drücken anhand aller Geräte, ob alles an- oder ausgeht. Einzelne
    // «umschalten» ergäben aus «einer an, einer aus» das Gegenteil.
    const ids = step.commandActions
      .map((action) => action.entity_id)
      .filter((entity_id) => !!entity_id);
    return ids.length > 0 ? [{ type: 'toggle_all', entity_ids: ids }] : [];
  }
  if (step.kind === 'scene') {
    return step.sceneId ? [{ type: 'scene', scene: step.sceneId }] : [];
  }
  if (step.kind === 'hue_scene') {
    return step.hueScene ? [{ type: 'hue_scene', scene: step.hueScene }] : [];
  }
  if (step.kind === 'music') {
    return musikSchrittZuAktion(step);
  }
  if (step.kind === 'notify') {
    // Nur, was vollständig ist: Ein Knopf ohne Etikett oder ohne Ziel
    // stünde als leerer Balken unter der Nachricht.
    const knoepfe = (step.notifyKnoepfe ?? [])
      .filter(
        (knopf) =>
          knopf.label.trim() && (knopf.sceneId || (knopf.entityId && knopf.command))
      )
      .map((knopf) =>
        knopf.sceneId
          ? { label: knopf.label.trim(), scene: knopf.sceneId }
          : {
              label: knopf.label.trim(),
              entity: knopf.entityId as string,
              command: knopf.command as string,
            }
      );
    return [
      {
        type: 'notify',
        to: step.notifyTo || 'all',
        title: step.title,
        body: step.body,
        ...(step.notifyCamera ? { camera: step.notifyCamera } : {}),
        ...(step.notifyZiel ? { open: step.notifyZiel } : {}),
        ...(knoepfe.length > 0 ? { buttons: knoepfe } : {}),
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
  if (step.kind === 'presence') {
    if (!step.presenceZone) return [];
    return [
      { type: 'presence', zone: step.presenceZone, event: step.presenceEvent },
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
        if (action.offAfter) licht.off_after = action.offAfter;
        return licht;
      }
      // Kamera und Lautsprecher kennen je einen Befehl, dessen Richtung
      // in unsichtbaren Zusatzdaten steckt («stumm» ist mute mit
      // muted: true). In der Auswahl sind es zwei Chips.
      const richtung = richtungBefehl(action.command);
      if (richtung) {
        return {
          type: 'command',
          entity_id: action.entity_id,
          command: richtung.command,
          data: richtung.data,
        };
      }
      // «Musik an» mit gewählter Playlist wird zu play_playlist – mit
      // Ziel-Box und Reihenfolge als Zusatzdaten.
      const musik = musikBefehl(action.command, {
        playlist: action.playlist,
        device: action.device,
        shuffle: action.shuffle,
      });
      if (musik) {
        return {
          type: 'command',
          entity_id: action.entity_id,
          command: musik.command,
          data: musik.data,
        };
      }
      const built: BausteinConfig = {
        type: 'command',
        entity_id: action.entity_id,
        command: action.command,
      };
      // Radio: Sendername, und die Box nur, wenn eine gewählt wurde.
      // Ohne sie spielt der Hub dort, wo zuletzt Radio lief.
      if (action.command === 'play_radio') {
        built.data = {
          station: action.station ?? '',
          ...(action.device ? { device: action.device } : {}),
        };
      }
      if (action.command === 'clean_rooms') {
        built.data = { rooms: action.rooms ?? [] };
      }
      if (action.command === 'set_position') {
        built.data = { position: action.position ?? 50 };
      }
      if (action.command === 'set_tilt') {
        built.data = { tilt: action.tilt ?? 50 };
      }
      if (action.command === 'set_brightness') {
        built.data = { brightness: action.brightness ?? 50 };
      }
      // Ohne diese drei ging der eingestellte Wert beim Speichern
      // verloren: Der Chip stand da, die Lautstärke kam nie beim Hub an.
      if (action.command === 'set_volume') {
        built.data = { volume: action.volume ?? 30 };
      }
      if (action.command === 'set_temperature') {
        built.data = { temperature: action.temperature ?? 120 };
      }
      if (action.command === 'launch_app') {
        built.data = { app: action.app ?? '' };
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
      // Gespeichert steht play_playlist, im Editor leuchtet «Musik an»
      // mit der Playlist als Beilage.
      const musik = musikSchluessel(action.command ?? '', action.data);
      const entry = {
        entity_id: action.entity_id,
        // «stumm» und «Privatsphäre ein» stehen gespeichert als mute
        // bzw. set_privacy mit einem Zusatzfeld - im Editor sind es
        // eigene Chips, sonst leuchtete beim Öffnen der falsche.
        command:
          musik?.command ??
          richtungSchluessel(action.command ?? '', action.data) ??
          action.command ??
          'turn_on',
        rooms: action.data?.rooms ?? [],
        position: action.data?.position,
        tilt: action.data?.tilt,
        brightness: action.data?.brightness,
        volume: action.data?.volume,
        temperature: action.data?.temperature,
        // Beim Hub heisst die Playlist 'name' - hier ein eigenes Feld,
        // damit sie nicht mit dem Namen des Ablaufs verwechselt wird.
        playlist: action.data?.name,
        station: action.data?.station,
        app: action.data?.app,
        device: action.data?.device,
        shuffle: musik?.shuffle,
      };
      const last = steps[steps.length - 1];
      if (last && last.kind === 'command') {
        last.commandActions = [...last.commandActions, entry];
      } else {
        steps.push({ ...EMPTY_STEP, kind: 'command', commandActions: [entry] });
      }
    } else if (type === 'toggle_all') {
      steps.push({
        ...EMPTY_STEP,
        kind: 'toggle_all',
        commandActions: (action.entity_ids ?? []).map((entity_id: string) => ({
          entity_id,
          command: 'toggle',
          rooms: [],
        })),
      });
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
        offAfter: action.off_after ? Number(action.off_after) : undefined,
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
    } else if (type === 'music') {
      steps.push({
        ...EMPTY_STEP,
        kind: 'music',
        musikTat: (action.do as MusikTat) ?? 'pause_all',
        musikFavorit: action.favorite ? String(action.favorite) : '',
        musikEntityId: action.entity_id ? String(action.entity_id) : '',
        musikMinuten: action.minutes ? String(action.minutes) : '30',
        musikLautstaerke: action.volume ? String(action.volume) : '30',
        musikAn: action.on !== false,
      });
    } else if (type === 'notify') {
      steps.push({
        ...EMPTY_STEP,
        kind: 'notify',
        title: action.title ?? '',
        body: action.body ?? '',
        notifyCamera: action.camera ?? '',
        notifyTo: action.to && action.to !== 'all' ? String(action.to) : '',
        notifyZiel: typeof action.open === 'string' ? action.open : '',
        notifyKnoepfe: Array.isArray(action.buttons)
          ? action.buttons
              .filter((knopf: unknown) => !!knopf && typeof knopf === 'object')
              .map((roh: object) => {
                const knopf = roh as Record<string, unknown>;
                return {
                  label: typeof knopf.label === 'string' ? knopf.label : '',
                  sceneId: typeof knopf.scene === 'string' ? knopf.scene : undefined,
                  entityId: typeof knopf.entity === 'string' ? knopf.entity : undefined,
                  command:
                    typeof knopf.command === 'string' ? knopf.command : undefined,
                };
              })
          : [],
      });
    } else if (type === 'broadcast') {
      steps.push({
        ...EMPTY_STEP,
        kind: 'broadcast',
        broadcastText: action.text ?? '',
        broadcastSpeakers: Array.isArray(action.speakers) ? action.speakers : [],
      });
    } else if (type === 'presence') {
      steps.push({
        ...EMPTY_STEP,
        kind: 'presence',
        presenceZone: String(action.zone ?? ''),
        presenceEvent: String(action.event ?? 'enter') === 'leave' ? 'leave' : 'enter',
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
    nachtsStill: automation.quiet_night === true,
  };
}

/** Ein Ablauf ohne einen einzigen Schritt wäre im Editor eine leere Seite. */
export function withAtLeastOne(steps: StepDraft[]): StepDraft[] {
  return steps.length > 0 ? steps : [{ ...EMPTY_STEP }];
}

/** Wie das Licht in der Listenzeile steht (rein, testbar).
 *
 * Mit dem Nachlauf, wenn es einen gibt: «Licht an» allein lässt die
 * Frage offen, wann es wieder ausgeht. */
export function lichtKurz(action: BausteinConfig): string {
  const wie =
    String(action.brightness ?? '') === 'adaptive'
      ? 'angepasst'
      : action.brightness != null
        ? `${action.brightness} %`
        : 'an';
  return action.off_after ? `${wie}, ${nachlaufLabel(action.off_after)}` : wie;
}

export function describe(automation: Automation, entities: Entity[] = []): string {
  const trigger = automation.triggers[0];
  // Der Name statt der Kennung: «geofence.anyone_home → off» ist keine
  // Auskunft, sondern eine Aufgabe. Und wo es einen ganzen Satz dafür
  // gibt - Ort und Anwesenheit -, steht der Satz.
  const wer = nameVon(entities, trigger?.entity_id);
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
            ? `wenn ${wer} ${trigger.to === true ? 'wiederkommt' : 'verstummt'}`
            : istOrtsmelder(trigger.entity_id)
              ? `wenn ${ortsSatz(wer, trigger)}`
              : String(trigger.entity_id ?? '') === SAMMEL_ANWESENHEIT
                ? `wenn ${anwesenheitSatz(trigger.to)}`
                : `wenn ${wer}${
                    trigger.attribute ? `.${trigger.attribute}` : ''
                  } → ${trigger.to ?? 'sich ändert'}`;
  const dann = !action
    ? 'ohne Aktion'
    : action.type === 'toggle_all'
      ? `${(action.entity_ids ?? []).length} Geräte gemeinsam umschalten`
      : action.type === 'light'
      ? `${nameVon(entities, action.entity_id)}: Licht ${lichtKurz(action)}`
      : action.type === 'scene'
        ? `Szene ${action.scene}`
        : action.type === 'notify'
          ? 'Nachricht senden'
          : action.command === 'clean_rooms'
            ? `${nameVon(entities, action.entity_id)}: ${
                action.data?.rooms?.length ?? 0
              } Räume saugen`
            : `${nameVon(entities, action.entity_id)} ${befehlWort(action.command)}`;
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


// ── Ist der Entwurf fertig? ──────────────────────────────────────────────
//
// Bisher liess sich jeder Entwurf speichern. Wer «Neuer Ablauf» tippte
// und irgendwo hängenblieb, bekam auf «Speichern» ein «Ohne Namen»
// angelegt, das nichts tat - und merkte es erst, wenn es abends nicht
// schaltete. Der Editor wusste die ganze Zeit, was fehlt; er sagte es
// nur nicht.

/** Auslöser, die ein Gerät brauchen – die anderen hängen an der Uhr. */
const AUSLOESER_MIT_GERAET: readonly TriggerKind[] = [
  'state',
  'threshold',
  'availability',
  'geofence',
];

/**
 * Was am Entwurf noch fehlt (rein, testbar).
 *
 * Eine Liste von Sätzen, nicht ein Wahrheitswert: «Speichern geht
 * nicht» hilft niemandem, «Auslöser 1: kein Gerät gewählt» schon. Die
 * Reihenfolge ist die des Formulars, damit man von oben nach unten
 * abarbeiten kann.
 */
export function wasFehlt(draft: Draft): string[] {
  const fehlt: string[] = [];

  // Jede Zeile nennt erst den Abschnitt, dann was dort zu tun ist -
  // sonst liest man «kein Gerät gewählt» und weiss nicht, in welchem
  // der beiden Abschnitte eines fehlt.
  draft.triggers.forEach((trigger, index) => {
    const wo = draft.triggers.length > 1 ? `Auslöser ${index + 1}` : 'Wenn';
    if (AUSLOESER_MIT_GERAET.includes(trigger.kind) && !trigger.entityId) {
      fehlt.push(`${wo}: ein Gerät wählen`);
    }
    if (trigger.kind === 'time' && !String(trigger.at ?? '').trim()) {
      fehlt.push(`${wo}: eine Uhrzeit eintragen`);
    }
  });

  // Nicht die Schritte zählen, sondern was aus ihnen wird: Ein Schritt
  // «Gerät schalten» ohne angekreuztes Gerät sieht im Formular aus wie
  // einer und ergibt beim Speichern nichts. Genau daran ist die alte
  // Meldung «einen Schritt, der etwas tut» gescheitert: Wer den Schritt
  // vor sich sah, verstand sie nicht - es fehlte ja keiner, ihm fehlte
  // etwas. Deshalb steht jetzt am Schritt, was ihm fehlt.
  if (stepsToActions(draft.steps).length === 0) {
    if (draft.steps.length === 0) {
      fehlt.push('Dann: einen Schritt, der etwas tut');
    } else {
      draft.steps.forEach((step, index) => {
        const grund = schrittFehlt(step);
        if (grund === null) return;
        const wo =
          draft.steps.length > 1
            ? `Dann, Schritt ${index + 1} («${SCHRITT_WORT[step.kind]}»)`
            : `Dann («${SCHRITT_WORT[step.kind]}»)`;
        fehlt.push(`${wo}: ${grund}`);
      });
    }
  }

  return fehlt;
}

/** Das Wort auf dem Chip des Schritts – damit die Fehlzeile denselben
 *  Namen trägt wie das Formular (editor.tsx). */
const SCHRITT_WORT: Record<StepKind, string> = {
  command: 'Gerät schalten',
  toggle_all: 'Gemeinsam umschalten',
  scene: 'Szene',
  hue_scene: 'Hue-Szene',
  notify: 'Nachricht',
  broadcast: 'Durchsage',
  presence: 'Anwesenheit melden',
  delay: 'Warten',
  wait_until: 'Warten bis',
  fade: 'Dimmen',
  music: 'Musik',
};

/**
 * Was diesem Schritt fehlt – oder null, wenn er etwas ergibt (rein, testbar).
 *
 * Die Sätze nennen den Handgriff, nicht den Zustand: «ein Gerät
 * ankreuzen» sagt, wohin die Hand muss.
 */
export function schrittFehlt(step: StepDraft): string | null {
  if (stepToActions(step).length > 0) return null;
  switch (step.kind) {
    case 'command':
      return 'ein Gerät ankreuzen';
    case 'toggle_all':
      return 'Geräte ankreuzen';
    case 'scene':
      return 'eine Szene wählen';
    case 'hue_scene':
      return 'eine Lichtszene wählen';
    case 'broadcast':
      return 'einen Text eintragen';
    case 'presence':
      return 'eine Person wählen';
    case 'fade':
      return 'ein Gerät wählen';
    case 'delay':
      return 'eine Wartezeit eintragen';
    case 'wait_until':
      return 'ein Gerät wählen';
    case 'music':
      return 'wählen, was laufen soll';
    default:
      return 'ausfüllen';
  }
}

/**
 * Lässt sich der Entwurf speichern? (rein, testbar)
 *
 * Der Name gehört ausdrücklich *nicht* dazu. Ein namenloser Ablauf
 * schaltet trotzdem richtig, und einen Entwurf am fehlenden Namen
 * scheitern zu lassen, wäre Schikane - der Hub trägt «Ohne Namen» ein
 * und man benennt ihn später um.
 */
export function istSpeicherbar(draft: Draft): boolean {
  return wasFehlt(draft).length === 0;
}

/**
 * Was in der zugeklappten Bedingung steht (rein, testbar).
 *
 * Leer heisst «nichts eingestellt» – und die Klappe bleibt zu. Ein
 * Ablauf ohne Bedingung ist der Normalfall; die halbe Seite Formular
 * dafür offenzuhalten kostet jeden, der bloss ein Licht schalten will,
 * zwei Bildschirme Scrollen.
 */
export function bedingungStand(draft: Draft): string {
  const teile: string[] = [];
  if (draft.conditionKind === 'sun') {
    teile.push(draft.conditionSun === 'up' ? 'nur wenn hell' : 'nur wenn dunkel');
  } else if (draft.conditionKind === 'time') {
    teile.push('Zeitfenster');
  }
  const geraete = draft.stateConditions.length;
  if (geraete > 0) {
    teile.push(geraete === 1 ? '1 Gerät' : `${geraete} Geräte`);
  }
  if (draft.groups.length > 0) {
    teile.push(
      draft.groups.length === 1 ? '1 Gruppe' : `${draft.groups.length} Gruppen`
    );
  }
  if (draft.weekdays.length > 0) teile.push('Wochentage');
  if (draft.exceptHolidays) teile.push('ohne Feiertage');
  if (draft.extraConditions.length > 0) teile.push('aus der Konfiguration');
  return teile.join(' · ');
}

/** Was in der zugeklappten «Kategorie und Zustand» steht (rein, testbar). */
export function angabenStand(draft: Draft): string {
  const teile: string[] = [];
  const kategorie = draft.category.trim();
  if (kategorie) teile.push(kategorie);
  // «läuft» ist der Normalfall und steht deshalb nicht da - nur das
  // Abweichende verdient eine Zeile im zugeklappten Kopf.
  if (!draft.enabled) teile.push('aus');
  return teile.join(' · ');
}

/** Was im zugeklappten «sonst» steht (rein, testbar). */
export function sonstStand(draft: Draft): string {
  const anzahl = draft.elseSteps.length;
  if (anzahl === 0) return '';
  return anzahl === 1 ? '1 Schritt' : `${anzahl} Schritte`;
}

/**
 * Ein Namensvorschlag aus dem, was der Ablauf tut (rein, testbar).
 *
 * Wer den Namen leer liess, fand in der Liste «Ohne Namen» – und bei
 * zweien davon weiss niemand mehr, welcher welcher ist. Der Vorschlag
 * steht als Platzhalter im Feld und wird beim Speichern genommen, wenn
 * nichts eingetippt wurde: «Licht Wohnzimmer bei Bewegung Flur» sagt
 * mehr als jeder Zähler.
 *
 * Leer, solange der Entwurf keine zwei Enden hat – dann bleibt es beim
 * «Ohne Namen», und das ist ehrlich.
 */
export function namensVorschlag(draft: Draft, entities: Entity[]): string {
  const name = (id: string) =>
    entities.find((entity) => entity.id === id)?.name ?? '';

  const trigger = draft.triggers[0];
  if (!trigger) return '';
  let wenn = '';
  if (trigger.kind === 'time') {
    wenn = String(trigger.at ?? '').trim() ? `um ${trigger.at}` : '';
  } else if (trigger.kind === 'sun') {
    wenn = trigger.sunEvent === 'sunrise' ? 'bei Sonnenaufgang' : 'bei Sonnenuntergang';
  } else if (trigger.kind === 'interval') {
    wenn = 'regelmässig';
  } else if (trigger.kind === 'calendar') {
    wenn = 'bei einem Termin';
  } else {
    const geraet = name(trigger.entityId);
    wenn = geraet ? `bei ${geraet}` : '';
  }
  if (!wenn) return '';

  const schritt = draft.steps[0];
  if (!schritt) return '';
  let dann = '';
  if (schritt.kind === 'command') {
    dann = name(schritt.commandActions[0]?.entity_id ?? '');
  } else if (schritt.kind === 'broadcast') {
    dann = 'Durchsage';
  } else if (schritt.kind === 'presence') {
    dann = 'Anwesenheit';
  } else if (schritt.kind === 'notify') {
    dann = 'Nachricht';
  } else if (schritt.kind === 'scene' || schritt.kind === 'hue_scene') {
    // Der Szenenname steht nicht in den Entitäten - hier genügt das
    // Wort, den Rest liest man im Ablauf selbst.
    dann = 'Szene';
  }
  if (!dann) return '';

  return `${dann} ${wenn}`;
}

// ── Wohin ein Tipp auf die Nachricht führt ────────────────────────────────
//
// Gespeichert wird eine Zeichenkette ('raum:Küche'), bedient wird sie in
// zwei Teilen: erst die Art, dann der Wert. Diese beiden Funktionen
// halten das auseinander, damit der Editor nicht mit Doppelpunkten
// hantieren muss.

/** Welche Art von Ziel ist das? (rein, testbar) */
export function zielArt(ziel: string): string {
  if (!ziel) return '';
  const [art] = ziel.split(':');
  return art;
}

/** Der Wert dahinter – Raumname, Kennung, Kachel (rein, testbar). */
export function zielWert(ziel: string): string {
  const index = ziel.indexOf(':');
  return index < 0 ? '' : ziel.slice(index + 1);
}

/**
 * Die Art wechseln und den Wert dabei behalten, wo er passt (rein).
 *
 * Wer von «Raum» auf «Gerät» wechselt, meint nicht den Raum als
 * Kennung - der Wert fällt weg. Wer dieselbe Art nochmal wählt, behält
 * ihn: Sonst verliert ein Fehlgriff die halbe Eingabe.
 */
export function zielMitArt(ziel: string, art: string): string {
  if (!art) return '';
  if (zielArt(ziel) === art) return ziel;
  // Arten ohne Wert stehen für sich allein.
  return ['start', 'sorgen', 'timer', 'offen', 'batterien', 'klingel'].includes(art)
    ? art
    : `${art}:`;
}
