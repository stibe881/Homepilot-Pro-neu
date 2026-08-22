import { Entity, Scene } from '../api/types';

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

function name(entities: Entity[], id: string | undefined): string {
  if (!id) return '?';
  return entities.find((entity) => entity.id === id)?.name ?? id;
}

function triggerSatz(trigger: Roh, entities: Entity[]): string {
  const wer = name(entities, trigger.entity_id);
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
      if (trigger.above !== undefined) return `${wer} über ${trigger.above}${dauer}`;
      if (trigger.below !== undefined) return `${wer} unter ${trigger.below}${dauer}`;
      const feld = trigger.attribute ? ` (${trigger.attribute})` : '';
      return `${wer}${feld} → ${trigger.to ?? 'ändert sich'}${dauer}`;
    }
  }
}

function bedingungSatz(condition: Roh, entities: Entity[]): string {
  if (condition.type === 'sun') {
    return condition.state === 'up' ? 'hell' : 'dunkel';
  }
  if (condition.type === 'time') {
    const teile = [];
    if (condition.after) teile.push(`ab ${condition.after}`);
    if (condition.before) teile.push(`bis ${condition.before}`);
    return teile.join(' ') || 'immer';
  }
  const wer = name(entities, condition.entity_id);
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
  arm_night: 'scharf (Nacht)',
  arm_away: 'scharf (Ausser Haus)',
  arm_vacation: 'scharf (Urlaub)',
  disarm: 'unscharf',
};

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
      return `warten bis ${name(entities, action.entity_id)} passt`;
    default: {
      const was = BEFEHL[String(action.command)] ?? action.command;
      return `${name(entities, action.entity_id)} ${was}`;
    }
  }
}

/** Der ganze Satz (rein, testbar). Leerer Entwurf → leerer Satz. */
export function ablaufSatz(
  benannt: Benannt,
  entities: Entity[],
  scenes: Scene[]
): string {
  const wenn = benannt.triggers
    .map((trigger) => triggerSatz(trigger, entities))
    .filter(Boolean);
  const dann = benannt.actions
    .map((action) => aktionSatz(action, entities, scenes))
    .filter(Boolean);
  if (wenn.length === 0 || dann.length === 0) return '';

  let satz = `Wenn ${wenn.join(' oder ')}, dann ${dann.join(', ')}`;
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
