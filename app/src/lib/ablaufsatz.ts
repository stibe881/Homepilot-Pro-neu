import { Entity, Scene } from '../api/types';
import {
  SAMMEL_ANWESENHEIT,
  anwesenheitSatz,
  istOrtsmelder,
  ortsSatz,
} from './ortsausloeser';

/**
 * Der Ablauf als Satz – während man ihn baut.
 *
 * Der Editor beginnt mit «Ein Ablauf ist ein Satz: Wenn … passiert,
 * dann … tun» und zeigte diesen Satz dann nie. Sieben Felder über zwei
 * Bildschirmhöhen, und was zusammen dabei herauskommt, sah man erst in
 * der Liste nach dem Speichern. Die mitlaufende Zeile ist die billigste
 * Fehlerprüfung, die es gibt: Wer «und» meinte und «oder» gebaut hat,
 * liest es sofort.
 *
 * Mit Gerätenamen, nicht Kennungen: «Bewegung Flur», nicht
 * «homematic.0031A0C9A6F400_3».
 */

// Die rohe Konfigurationsform – dieselbe, die der Hub speichert. Ein
// einziges any mit Absicht: Die Felder je Auslöser-Art sauber zu tippen
// hiesse, die Hub-Schemas hier zu duplizieren (Punkt 60 der Werkbank).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Roh = Record<string, any>;

interface Benannt {
  triggers: Roh[];
  conditions: Roh[];
  actions: Roh[];
  otherwise: Roh[];
  match: 'all' | 'any';
}

/** Der Anzeigename einer Entität – oder ihre Kennung, wenn sie fehlt.
 *
 *  Auch für die Listenzeile (screens/automations/entwurf.ts): Dort stand
 *  bis dahin die nackte Kennung, und «geofence.anyone_home → off» ist
 *  keine Auskunft, sondern eine Aufgabe. */
export function nameVon(entities: Entity[], id: string | undefined): string {
  if (!id) return '?';
  return entities.find((entity) => entity.id === id)?.name ?? id;
}

function triggerSatz(trigger: Roh, entities: Entity[]): string {
  const wer = nameVon(entities, trigger.entity_id);
  const dauer = trigger.for ? ` seit ${Math.round(Number(trigger.for) / 60)} Min` : '';
  switch (trigger.type) {
    case 'time':
      return `täglich um ${trigger.at}`;
    case 'sun': {
      const versatz = Number(trigger.offset) || 0;
      const wann = trigger.event === 'sunrise' ? 'Sonnenaufgang' : 'Sonnenuntergang';
      if (!versatz) return `bei ${wann}`;
      return `${Math.abs(versatz)} Min ${versatz < 0 ? 'vor' : 'nach'} ${wann}`;
    }
    case 'interval':
      return `alle ${Math.round(Number(trigger.seconds) / 60) || 1} Min`;
    case 'availability':
      return trigger.to === true ? `${wer} wiederkommt` : `${wer} verstummt${dauer}`;
    default: {
      // Ortsauslöser lesen sich als Satz, nicht als Zustandswechsel:
      // «Livia verlässt Schule» statt «geofence.livia → ändert sich».
      if (istOrtsmelder(trigger.entity_id)) {
        return `${ortsSatz(wer, trigger)}${dauer}`;
      }
      // Die Sammelanwesenheit ist keine Person an einem Ort. Als
      // Ortsauslöser gelesen stand hier «Jemand zuhause kommt bei Off
      // an» - der Ablauf tat das Richtige, der Satz sagte Unsinn.
      if (String(trigger.entity_id ?? '') === SAMMEL_ANWESENHEIT) {
        return `${anwesenheitSatz(trigger.to)}${dauer}`;
      }
      if (trigger.above !== undefined) return `${wer} über ${trigger.above}${dauer}`;
      if (trigger.below !== undefined) return `${wer} unter ${trigger.below}${dauer}`;
      const feld = trigger.attribute ? ` (${trigger.attribute})` : '';
      return `${wer}${feld} → ${trigger.to ?? 'ändert sich'}${dauer}`;
    }
  }
}

function bedingungSatz(condition: Roh, entities: Entity[]): string {
  if (condition.type === 'group') {
    // Geschachtelte und/oder-Gruppen des Hubs – in Klammern, damit die
    // Verknüpfung im Satz lesbar bleibt: «(Wochenende oder Ferien) und dunkel».
    const teile = ((condition.conditions ?? []) as Roh[])
      .map((sub) => bedingungSatz(sub, entities))
      .filter(Boolean);
    if (teile.length === 0) return '';
    return `(${teile.join(condition.match === 'any' ? ' oder ' : ' und ')})`;
  }
  if (condition.type === 'sun') {
    return condition.state === 'up' ? 'hell' : 'dunkel';
  }
  if (condition.type === 'time') {
    const teile = [];
    if (condition.after) teile.push(`ab ${condition.after}`);
    if (condition.before) teile.push(`bis ${condition.before}`);
    return teile.join(' ') || 'immer';
  }
  const wer = nameVon(entities, condition.entity_id);
  if (condition.above !== undefined) return `${wer} über ${condition.above}`;
  if (condition.below !== undefined) return `${wer} unter ${condition.below}`;
  return `${wer} ist ${condition.equals ?? '?'}`;
}

const BEFEHL: Record<string, string> = {
  turn_on: 'ein',
  turn_off: 'aus',
  toggle: 'umschalten',
  set_brightness: 'dimmen',
  open: 'hoch',
  close: 'runter',
  set_position: 'auf Position',
  lock: 'abschliessen',
  unlock: 'aufschliessen',
  start: 'saugen',
  dock: 'zur Station',
  play: 'Musik an',
  pause: 'Musik aus',
  set_volume: 'Lautstärke',
  // Der Wert folgt: «Smoker auf 110 °C».
  set_temperature: 'auf',
  mute: 'stumm',
  play_playlist: 'Playlist',
  launch_app: 'App',
  play_url: 'Durchsage',
  play_radio: 'Sender',
  set_privacy: 'Privatsphäre',
  unlatch: 'aufziehen',
  open_door: 'öffnen',
  arm_night: 'scharf (Nacht)',
  arm_away: 'scharf (Ausser Haus)',
  arm_vacation: 'scharf (Urlaub)',
  disarm: 'unscharf',
  activate: 'aufrufen',
};

/** Das Wort für einen Befehl – «aus» statt turn_off (rein, testbar).
 *
 *  Auch für die Listenzeile: Dort stand «demo.light_livingroom
 *  turn_off», und das liest niemand als «Licht Wohnzimmer aus». */
export function befehlWort(command: unknown): string {
  const name = String(command ?? '');
  return BEFEHL[name] ?? name;
}

/** Der eingestellte Wert hinter dem Befehl (rein, testbar). */
function wertZusatz(action: Roh, entities: Entity[]): string {
  const data = (action.data ?? {}) as Record<string, unknown>;
  if (typeof data.volume === 'number') return ` ${data.volume} %`;
  if (typeof data.brightness === 'number') return ` ${data.brightness} %`;
  if (typeof data.position === 'number') return ` ${data.position} %`;
  if (typeof data.temperature === 'number') {
    // Die Einheit steht beim Gerät: Ein Fahrenheit-Grill meldet 225, und
    // «225 °C» wäre eine ganz andere Aussage.
    const einheit = entities.find((entity) => entity.id === action.entity_id)?.state
      ?.unit;
    return ` ${data.temperature} ${typeof einheit === 'string' ? einheit : '°C'}`;
  }
  if (typeof data.name === 'string' && data.name) return ` «${data.name}»`;
  // Der Sender gehört dazu: «Radio» allein sagt nicht, welcher – und
  // genau danach schaut man in der Liste.
  if (typeof data.station === 'string' && data.station) return ` «${data.station}»`;
  if (typeof data.muted === 'boolean') return data.muted ? '' : ' aus';
  return '';
}

function aktionSatz(
  action: Roh,
  entities: Entity[],
  scenes: Scene[]
): string {
  switch (action.type) {
    case 'scene':
      return `Szene «${scenes.find((s) => s.id === action.scene)?.name ?? action.scene}»`;
    case 'hue_scene':
      return `Hue-Szene «${action.scene}»`;
    case 'notify':
      return 'Nachricht';
    case 'broadcast':
      return 'Durchsage';
    case 'delay': {
      const sekunden = Number(action.seconds) || 0;
      return sekunden >= 60 ? `${Math.round(sekunden / 60)} Min warten` : `${sekunden} s warten`;
    }
    case 'wait_until':
      return `warten bis ${nameVon(entities, action.entity_id)} passt`;
    default: {
      const was = BEFEHL[String(action.command)] ?? action.command;
      // Der Wert gehört dazu: «Lautsprecher Lautstärke» sagt nicht, ob
      // leise oder laut - und genau danach schaut man in der Liste.
      const zusatz = wertZusatz(action, entities);
      return `${nameVon(entities, action.entity_id)} ${was}${zusatz}`;
    }
  }
}

/** Wie viele Aktionen im kurzen Satz stehen, bevor gezählt wird.
 *
 *  Ein Ablauf «alle weg» schaltet gern sechzig Geräte. Sie einzeln
 *  aufzuzählen füllt den halben Bildschirm und beantwortet die Frage
 *  trotzdem nicht: Was der Ablauf *tut*, sieht man an den ersten
 *  dreien - dass es viele sind, an der Zahl dahinter. */
export const KURZ_AKTIONEN = 3;

/** Aus vielen Satzteilen einer machen (rein, testbar).
 *
 *  Getrennt von `ablaufSatz`, weil es die Entscheidung ist und nicht
 *  die Darstellung: Ab wann wird gezählt statt aufgezählt. */
export function kuerze(teile: string[], hoechstens = KURZ_AKTIONEN): string {
  if (teile.length <= hoechstens) return teile.join(', ');
  const weitere = teile.length - hoechstens;
  return `${teile.slice(0, hoechstens).join(', ')} und ${weitere} weitere`;
}

/** Der ganze Satz (rein, testbar). Leerer Entwurf → leerer Satz.
 *
 *  `alle` nennt jede Aktion einzeln - für den Blick, der genau das
 *  wissen will. Ohne die Angabe steht die kurze Fassung. */
export function ablaufSatz(
  benannt: Benannt,
  entities: Entity[],
  scenes: Scene[],
  alle = false
): string {
  const wenn = benannt.triggers
    .map((trigger) => triggerSatz(trigger, entities))
    .filter(Boolean);
  const dann = benannt.actions
    .map((action) => aktionSatz(action, entities, scenes))
    .filter(Boolean);
  if (wenn.length === 0 || dann.length === 0) return '';

  let satz = `Wenn ${wenn.join(' oder ')}, dann ${
    alle ? dann.join(', ') : kuerze(dann)
  }`;
  const nur = benannt.conditions.map((c) => bedingungSatz(c, entities)).filter(Boolean);
  if (nur.length > 0) {
    satz += ` – nur wenn ${nur.join(benannt.match === 'any' ? ' oder ' : ' und ')}`;
  }
  if (benannt.otherwise.length > 0) {
    const sonst = benannt.otherwise.map((a) => aktionSatz(a, entities, scenes));
    satz += `; sonst ${sonst.join(', ')}`;
  }
  return satz + '.';
}
