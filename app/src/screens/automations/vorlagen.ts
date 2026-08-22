/**
 * Fertige Ablauf-Vorlagen aus dem Gerätebestand («Licht bei Bewegung» …).
 *
 * Herausgelöst aus AutomationsScreen.tsx (Punkt 21 der Werkbank).
 */
import { Ionicons } from '@expo/vector-icons';

import { Entity, Scene } from '../../api/types';
import { Compare, ConditionKind, Draft, EMPTY, EMPTY_STEP, EMPTY_TRIGGER, StepKind, TriggerKind, vacuumRooms } from './entwurf';

export interface Template {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  draft: Draft;
}

/** Fertige Anfänge für die häufigsten Automationen – nur die, deren Geräte
 *  es in diesem Haushalt wirklich gibt. Der Editor öffnet sich vorbefüllt,
 *  anpassen und speichern bleibt beim Benutzer. */
export function buildTemplates(entities: Entity[], scenes: Scene[]): Template[] {
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

