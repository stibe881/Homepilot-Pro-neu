/**
 * Fertige Ablauf-Vorlagen aus dem Gerätebestand («Licht bei Bewegung» …).
 *
 * Herausgelöst aus AutomationsScreen.tsx (Punkt 21 der Werkbank).
 */
import { Ionicons } from '@expo/vector-icons';

import { Entity, Scene } from '../../api/types';
import { istOrtsmelder } from '../../lib/ortsausloeser';
import { Compare, ConditionKind, Draft, EMPTY, EMPTY_STEP, EMPTY_TRIGGER, StepDraft, StepKind, TriggerKind, vacuumRooms } from './entwurf';

export interface Template {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  draft: Draft;
}

/** Eine selbst gesicherte Vorlage, wie sie vom Hub kommt. */
export interface EigeneVorlage {
  id: string;
  label: string;
  icon: string;
  draft: Partial<Draft>;
}

/** Eine Zeile der Vorlagenliste - eingebaut oder eigen. */
export interface VorlagenZeile {
  key: string;
  id: string;
  label: string;
  icon: string;
  draft: Partial<Draft>;
  /** Selbst gesichert? Dann löschbar; sonst nur ausblendbar. */
  eigen: boolean;
}

/**
 * Eingebaute und eigene Vorlagen zu einer Liste (rein, testbar).
 *
 * Die eigenen zuerst: Wer sich eine gesichert hat, sucht sie und nicht
 * den Vorschlag des Hubs. Ausgeblendete eingebaute fallen weg, und eine
 * eigene mit derselben Beschriftung verdrängt die eingebaute - sonst
 * stünden zwei fast gleiche nebeneinander, was genau der Grund ist,
 * warum man eine bearbeitet hat.
 */
export function mischeVorlagen(
  eingebaut: Template[],
  eigene: EigeneVorlage[],
  versteckt: string[]
): VorlagenZeile[] {
  const weg = new Set(
    [...versteckt, ...eigene.map((vorlage) => vorlage.label)].map((label) =>
      String(label ?? '').trim().toLowerCase()
    )
  );
  const meine: VorlagenZeile[] = (eigene ?? []).map((vorlage) => ({
    key: `eigen:${vorlage.id}`,
    id: vorlage.id,
    label: vorlage.label,
    icon: vorlage.icon || 'flash-outline',
    draft: vorlage.draft ?? {},
    eigen: true,
  }));
  const gebaut: VorlagenZeile[] = (eingebaut ?? [])
    .filter((vorlage) => !weg.has(vorlage.label.trim().toLowerCase()))
    .map((vorlage) => ({
      key: `eingebaut:${vorlage.label}`,
      id: vorlage.label,
      label: vorlage.label,
      icon: vorlage.icon,
      draft: vorlage.draft,
      eigen: false,
    }));
  return [...meine, ...gebaut];
}

/** Fertige Anfänge für die häufigsten Automationen – nur die, deren Geräte
 *  es in diesem Haushalt wirklich gibt. Der Editor öffnet sich vorbefüllt,
 *  anpassen und speichern bleibt beim Benutzer. */
export function buildTemplates(entities: Entity[], scenes: Scene[]): Template[] {
  const templates: Template[] = [];
  // Nur der Geofence. `unifi.anyone_home` heisst «Geräte im WLAN» und
  // beantwortet «ist eines der verfolgten Geräte im Netz» – eine Vorlage
  // «alles aus, wenn niemand mehr da ist» darauf schaltet das Haus ab,
  // sobald das Telefon im Garten den Funk verliert.
  const presence = entities.find((entity) => entity.id === 'geofence.anyone_home');
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
        // Ein Schritt, nicht drei: Die Lampe trägt ihren Nachlauf selbst,
        // und der Ablauf ist nach dem Einschalten fertig statt vier
        // Minuten lang beschäftigt. Verlängert wird trotzdem - der Hub
        // stellt den Zeitgeber bei neuer Bewegung neu.
        steps: [
          {
            ...EMPTY_STEP,
            commandActions: [
              {
                entity_id: light.id,
                command: 'turn_on',
                offAfter: 240,
                // Misst der Melder Lux, richtet sich die Helligkeit
                // danach: nachts gedämpft statt Flutlicht.
                ...(typeof motion.state?.illumination === 'number'
                  ? { command: 'set_brightness', adaptive: true }
                  : {}),
              },
            ],
          },
        ],
      },
    });
  }

  if (presence) {
    // Die zwei Anfänge, nach denen am häufigsten gefragt wird - und die
    // bisher fehlten, weil jede Anwesenheits-Vorlage schon eine Aktion
    // mitbrachte: Alarm scharf, alles aus. Wer etwas anderes vorhat,
    // musste den Auslöser selbst finden und dabei raten, ob «jemand
    // zuhause» nun «an» oder «aus» heisst.
    //
    // Ohne Schritte: Der Auslöser ist das Schwierige, die Aktion weiss
    // nur der Haushalt selbst.
    templates.push({
      label: 'Der Erste kommt heim',
      icon: 'enter-outline',
      draft: {
        ...EMPTY,
        alias: 'Wenn der Erste heimkommt',
        // «on» heisst hier: Vorher war niemand da. Kommt der Zweite
        // dazu, ändert sich nichts - der Ablauf läuft also genau einmal
        // je Heimkehr, nicht je Person.
        triggers: [{ ...EMPTY_TRIGGER, entityId: presence.id, toState: 'on' }],
      },
    });
    templates.push({
      label: 'Der Letzte geht',
      icon: 'exit-outline',
      draft: {
        ...EMPTY,
        alias: 'Wenn der Letzte geht',
        // Zehn Minuten Haltezeit: Der Gang zum Briefkasten ist kein
        // Auszug, und ein Telefon, das kurz den Funk verliert, auch
        // nicht.
        triggers: [
          { ...EMPTY_TRIGGER, entityId: presence.id, toState: 'off', forMinutes: '10' },
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
  if (presence && allLights.length > 0) {
    // Der Klassiker, der noch fehlte (Punkt 156): Wenn niemand zuhause
    // ist, abends ein Licht mit Zufalls-Versatz an und später wieder aus
    // - ein bewohntes Haus, kein Uhrwerk. Das Wohnzimmer, wenn es sich
    // finden lässt: Dort brennt abends glaubwürdig Licht.
    const wohnzimmer =
      allLights.find((entity) =>
        /wohn|stube/i.test(`${entity.room ?? ''} ${entity.name}`)
      ) ?? allLights[0];
    templates.push({
      label: 'Ferienmodus: Anwesenheit simulieren',
      icon: 'airplane-outline',
      draft: {
        ...EMPTY,
        alias: 'Ferienmodus: Licht simulieren',
        category: 'Ferien',
        triggers: [
          {
            ...EMPTY_TRIGGER,
            kind: 'sun',
            sunEvent: 'sunset',
            sunOffset: '-10',
            // Jeden Abend ein anderer Zeitpunkt - das ist der ganze Trick.
            jitter: '30',
          },
        ],
        stateConditions: [
          { entity_id: presence.id, op: 'is' as Compare, value: 'off' },
        ],
        steps: [
          {
            ...EMPTY_STEP,
            commandActions: [{ entity_id: wohnzimmer.id, command: 'turn_on' }],
          },
          // Zweieinhalb Stunden «Fernsehabend», dann Nachtruhe.
          { ...EMPTY_STEP, kind: 'delay' as StepKind, seconds: '9000' },
          {
            ...EMPTY_STEP,
            commandActions: [{ entity_id: wohnzimmer.id, command: 'turn_off' }],
          },
        ],
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

  // Punkt 199: Der Fall, für den Familien so etwas überhaupt einrichten –
  // das Kind ist von der Schule heimgekommen. Oder eben noch nicht.
  const zonen = entities.filter(
    (entity) => istOrtsmelder(entity.id)
  );
  for (const zone of zonen.slice(0, 3)) {
    const wer = zone.name;
    templates.push({
      label: `${wer} ist angekommen`,
      icon: 'location-outline',
      draft: {
        ...EMPTY,
        alias: `${wer} ist zuhause`,
        triggers: [{ ...EMPTY_TRIGGER, kind: 'geofence' as TriggerKind, entityId: zone.id, toState: 'home' }],
        // Werktags nachmittags: Ohne Fenster piepst jede Heimkehr, auch
        // die um sieben Uhr morgens vom Briefkasten.
        conditionKind: 'time' as ConditionKind,
        conditionAfter: '15:00',
        conditionBefore: '18:00',
        weekdays: [0, 1, 2, 3, 4],
        steps: [
          {
            ...EMPTY_STEP,
            kind: 'notify' as StepKind,
            title: `${wer} ist zuhause`,
            body: 'Gerade angekommen.',
          },
        ],
      },
    });
    // Die stille Umkehrung, die man erst schätzt, wenn sie fehlt.
    templates.push({
      label: `${wer} ist um 17:30 noch nicht da`,
      icon: 'alarm-outline',
      draft: {
        ...EMPTY,
        alias: `${wer} um 17:30 noch nicht zuhause`,
        triggers: [{ ...EMPTY_TRIGGER, kind: 'time' as TriggerKind, at: '17:30' }],
        stateConditions: [
          { entity_id: zone.id, op: 'is' as Compare, value: 'away' },
        ],
        weekdays: [0, 1, 2, 3, 4],
        steps: [
          {
            ...EMPTY_STEP,
            kind: 'notify' as StepKind,
            title: `${wer} ist noch nicht zuhause`,
            body: 'Um 17:30 immer noch unterwegs.',
          },
        ],
      },
    });
  }

  // «Wenn ich abends den Fernseher ausschalte» - der Ablauf, den man
  // sich zuerst wünscht und der bisher am Editor scheiterte: Ein
  // Fernseher ist ein media_player, und dort stand nur spielt/pausiert.
  const tv = entities.find(
    (entity) => entity.kind === 'media_player' && entity.commands.includes('turn_off')
  );
  if (tv && allLights.length > 0) {
    // Das Licht dort, wo man danach hingeht - Essbereich, Küche, sonst
    // irgendeines. Ändern kann man es im Editor.
    const licht =
      allLights.find((entity) => /ess|küche|kueche/i.test(`${entity.room ?? ''} ${entity.name}`)) ??
      allLights.find((entity) => entity.room === tv.room) ??
      allLights[0];
    templates.push({
      label: 'Licht an, wenn der Fernseher spätabends ausgeht',
      icon: 'tv-outline',
      draft: {
        ...EMPTY,
        alias: 'Licht an nach dem Fernsehen',
        triggers: [{ ...EMPTY_TRIGGER, entityId: tv.id, toState: 'off' }],
        // Über Mitternacht hinaus: Ein Film endet auch mal um halb eins,
        // und «nach 22:00» allein hörte um Mitternacht auf.
        conditionKind: 'time' as ConditionKind,
        conditionAfter: '22:00',
        conditionBefore: '03:00',
        steps: [
          {
            ...EMPTY_STEP,
            commandActions: [{ entity_id: licht.id, command: 'turn_on' }],
          },
        ],
      },
    });
  }

  // «Niemand mehr zuhause» in einem Ablauf statt in dreien – dieselbe
  // Sammel-Entität des Geofence wie oben.
  const alleWeg = presence;
  const sauger = entities.find((entity) => entity.commands.includes('dock'));
  if (alleWeg && (allLights.length > 0 || sauger || alarm)) {
    const schritte: StepDraft[] = [];
    if (offScene) {
      schritte.push({ ...EMPTY_STEP, kind: 'scene' as StepKind, sceneId: offScene.id });
    } else if (allLights.length > 0) {
      schritte.push({
        ...EMPTY_STEP,
        commandActions: allLights.map((entity) => ({
          entity_id: entity.id,
          command: 'turn_off',
        })),
      });
    }
    if (sauger) {
      schritte.push({
        ...EMPTY_STEP,
        commandActions: [{ entity_id: sauger.id, command: 'start' }],
      });
    }
    if (alarm) {
      // Zuletzt und mit Abstand: Erst wenn die Lichter aus sind und der
      // Sauger läuft, wird scharf geschaltet - sonst meldet die eigene
      // Anlage den eigenen Saugroboter.
      schritte.push({ ...EMPTY_STEP, kind: 'delay' as StepKind, seconds: '60' });
      schritte.push({
        ...EMPTY_STEP,
        commandActions: [{ entity_id: alarm.id, command: 'arm_away' }],
      });
    }
    templates.push({
      label: 'Wenn niemand mehr zuhause ist',
      icon: 'walk-outline',
      draft: {
        ...EMPTY,
        alias: 'Niemand mehr zuhause',
        // Zehn Minuten Haltezeit: Der Gang zum Briefkasten ist kein Auszug.
        triggers: [
          { ...EMPTY_TRIGGER, entityId: alleWeg.id, toState: 'off', forMinutes: '10' },
        ],
        steps: schritte,
      },
    });
  }

  // Die Gegenrichtung: Wer heimkommt, soll nicht als Erstes den
  // Saugroboter aus dem Weg räumen.
  const wohnungstuere =
    entities.find(
      (entity) => entity.kind === 'lock' && /wohnung/i.test(entity.name)
    ) ?? entities.find((entity) => entity.kind === 'lock');
  if (zonen.length > 0 && (sauger || wohnungstuere)) {
    const zone = zonen[0];
    const schritte: StepDraft[] = [];
    if (sauger) {
      schritte.push({
        ...EMPTY_STEP,
        commandActions: [{ entity_id: sauger.id, command: 'dock' }],
      });
    }
    if (wohnungstuere) {
      schritte.push({
        ...EMPTY_STEP,
        commandActions: [{ entity_id: wohnungstuere.id, command: 'unlock' }],
      });
    }
    templates.push({
      label: 'Willkommen zuhause',
      icon: 'home-outline',
      draft: {
        ...EMPTY,
        alias: `${zone.name} kommt heim`,
        triggers: [
          {
            ...EMPTY_TRIGGER,
            kind: 'geofence' as TriggerKind,
            entityId: zone.id,
            toState: 'home',
          },
        ],
        steps: schritte,
      },
    });
  }

  return templates;
}

