/** Entwurf ↔ gespeicherte Form: die neuen Felder aus dem zweiten Heft. */
import {
  EMPTY,
  EMPTY_STEP,
  EMPTY_TRIGGER,
  buildConditions,
  stepToActions,
  actionsToSteps,
  toDraft,
  triggerFromConfig,
  istLichtFein,
  lichtKurz,
  nachlaufLabel,
  sekundenWert,
  melderMitLux,
  minutenLabel,
  minutenWert,
  triggerIcon,
  triggerToConfig,
  zeitpunktLabel,
} from './entwurf';

describe('Zufalls-Versatz (Punkt 155)', () => {
  it('wandert in die gespeicherte Form und zurück', () => {
    const config = triggerToConfig({ ...EMPTY_TRIGGER, kind: 'time', at: '21:30', jitter: '15' });
    expect(config).toEqual({ type: 'time', at: '21:30', jitter: 15 });
    expect(triggerFromConfig(config).jitter).toBe('15');
  });

  it('leer oder Unsinn heisst pünktlich', () => {
    expect(triggerToConfig({ ...EMPTY_TRIGGER, kind: 'time', at: '21:30' }).jitter).toBeUndefined();
    expect(
      triggerToConfig({ ...EMPTY_TRIGGER, kind: 'sun', jitter: 'viel' }).jitter
    ).toBeUndefined();
  });
});

describe('Feiertags-Bedingung (Punkt 154)', () => {
  it('speichert das Häkchen als except_holidays', () => {
    const conditions = buildConditions({
      ...EMPTY,
      conditionKind: 'time',
      exceptHolidays: true,
    });
    expect(conditions).toEqual([{ type: 'time', except_holidays: true }]);
  });

  it('ohne Häkchen bleibt die Bedingung schlank', () => {
    const conditions = buildConditions({
      ...EMPTY,
      conditionKind: 'time',
      conditionAfter: '08:00',
    });
    expect(conditions[0].except_holidays).toBeUndefined();
  });
});

describe('Nachricht-Empfänger (Punkt 158)', () => {
  it('leer heisst weiterhin an alle', () => {
    const [action] = stepToActions({ ...EMPTY_STEP, kind: 'notify', title: 'Hallo', body: '' });
    expect(action.to).toBe('all');
  });

  it('ein Name wandert hin und zurück', () => {
    const [action] = stepToActions({
      ...EMPTY_STEP,
      kind: 'notify',
      title: 'Wäsche',
      body: 'fertig',
      notifyTo: 'Stefan',
    });
    expect(action.to).toBe('Stefan');
    const [zurueck] = actionsToSteps([action]);
    expect(zurueck.notifyTo).toBe('Stefan');
    // «all» wird beim Öffnen wieder zur leeren Auswahl.
    expect(actionsToSteps([{ ...action, to: 'all' }])[0].notifyTo).toBe('');
  });
});

describe('Und/Oder-Gruppen (Punkt 152)', () => {
  const basis = {
    id: 'x',
    alias: 'X',
    triggers: [],
    conditions: [],
    actions: [],
    editable: true,
  };

  it('baut eine Gruppe in die gespeicherte Form', () => {
    const conditions = buildConditions({
      ...EMPTY,
      groups: [
        {
          match: 'any',
          conditions: [
            { entity_id: 'a.b', op: 'is', value: 'on' },
            { entity_id: 'c.d', op: 'below', value: '20' },
          ],
        },
      ],
    });
    expect(conditions).toEqual([
      {
        type: 'group',
        match: 'any',
        conditions: [
          { type: 'state', entity_id: 'a.b', equals: 'on' },
          { type: 'state', entity_id: 'c.d', below: 20 },
        ],
      },
    ]);
  });

  it('öffnet eine flache Gruppe im Editor statt sie nur mitzutragen', () => {
    const draft = toDraft({
      ...basis,
      conditions: [
        {
          type: 'group',
          match: 'any',
          conditions: [{ type: 'state', entity_id: 'a.b', equals: 'on' }],
        },
      ],
    });
    expect(draft.groups).toHaveLength(1);
    expect(draft.groups[0].conditions[0].entity_id).toBe('a.b');
    expect(draft.extraConditions).toEqual([]);
  });

  it('zu tief Geschachteltes bleibt unangetastet erhalten', () => {
    const tief = {
      type: 'group',
      match: 'all',
      conditions: [{ type: 'group', conditions: [] }],
    };
    const draft = toDraft({ ...basis, conditions: [tief] });
    expect(draft.groups).toEqual([]);
    expect(draft.extraConditions).toEqual([tief]);
  });
});

describe('Dimm-Schritt (Punkt 157)', () => {
  it('wandert in die gespeicherte Form und zurück', () => {
    const [action] = stepToActions({
      ...EMPTY_STEP,
      kind: 'fade',
      fadeEntityId: 'hue.stube',
      fadeTo: '0',
      fadeMinutes: '10',
    });
    expect(action).toEqual({ type: 'fade', entity_id: 'hue.stube', to: 0, minutes: 10 });
    const [zurueck] = actionsToSteps([action]);
    expect(zurueck.kind).toBe('fade');
    expect(zurueck.fadeTo).toBe('0');
    expect(zurueck.fadeMinutes).toBe('10');
  });

  it('ohne Lampe kein Schritt', () => {
    expect(stepToActions({ ...EMPTY_STEP, kind: 'fade' })).toEqual([]);
  });
});

describe('Kalender-Auslöser (Punkt 153)', () => {
  it('wandert in die gespeicherte Form und zurück', () => {
    const config = triggerToConfig({
      ...EMPTY_TRIGGER,
      kind: 'calendar',
      calendarContains: 'Abfuhr',
      calendarEvent: 'start',
      calendarBefore: '720',
    });
    expect(config).toEqual({
      type: 'calendar',
      contains: 'Abfuhr',
      event: 'start',
      minutes_before: 720,
    });
    const zurueck = triggerFromConfig(config);
    expect(zurueck.kind).toBe('calendar');
    expect(zurueck.calendarContains).toBe('Abfuhr');
    expect(zurueck.calendarBefore).toBe('720');
  });
});

describe('triggerIcon (Punkt 162)', () => {
  const mit = (trigger: Record<string, unknown>) => ({
    id: 'x',
    alias: 'X',
    triggers: [trigger],
    conditions: [],
    actions: [],
    editable: true,
  });

  it('kennt die Auslöserarten', () => {
    expect(triggerIcon(mit({ type: 'time', at: '09:00' }))).toBe('time-outline');
    expect(triggerIcon(mit({ type: 'sun' }))).toBe('sunny-outline');
    expect(triggerIcon(mit({ type: 'calendar' }))).toBe('calendar-outline');
    expect(triggerIcon(mit({ entity_id: 'x.y', attribute: 'ring' }))).toBe(
      'notifications-outline'
    );
    expect(triggerIcon(mit({ entity_id: 'x.y', below: 20 }))).toBe('analytics-outline');
    expect(triggerIcon(mit({ entity_id: 'x.y' }))).toBe('flash-outline');
  });
});

describe('zeitpunktLabel (Punkte 159/161)', () => {
  const jetzt = new Date(2026, 7, 22, 12, 0); // Samstag
  it('sagt heute, morgen oder den Wochentag', () => {
    const heute = new Date(2026, 7, 22, 21, 12).getTime() / 1000;
    const morgen = new Date(2026, 7, 23, 6, 0).getTime() / 1000;
    const montag = new Date(2026, 7, 24, 9, 5).getTime() / 1000;
    expect(zeitpunktLabel(heute, jetzt)).toBe('heute 21:12');
    expect(zeitpunktLabel(morgen, jetzt)).toBe('morgen 06:00');
    expect(zeitpunktLabel(montag, jetzt)).toBe('Mo 09:05');
  });
});

describe('eigene Haltedauer', () => {
  it('schreibt die eingetippten Minuten aus', () => {
    expect(minutenLabel('45')).toBe('45 min');
    expect(minutenLabel('125')).toBe('2 h 5 min');
    expect(minutenLabel('120')).toBe('2 h');
  });

  it('nennt ganze Tage Tage – «1440 min» wäre richtig und unlesbar', () => {
    expect(minutenLabel('1440')).toBe('1 Tag');
    expect(minutenLabel('2880')).toBe('2 Tage');
  });

  it('nennt die leere Angabe «sofort»', () => {
    expect(minutenLabel('')).toBe('sofort');
    expect(minutenLabel('0')).toBe('sofort');
  });

  it('macht aus Unsinn und Null wieder «sofort»', () => {
    expect(minutenWert('')).toBe('');
    expect(minutenWert('abc')).toBe('');
    expect(minutenWert('-5')).toBe('');
  });

  it('rundet und deckelt bei einer Woche', () => {
    expect(minutenWert('45.6')).toBe('46');
    // Ein verrutschtes «100000» wären 69 Tage.
    expect(minutenWert('100000')).toBe('10080');
  });

  it('trägt die eigene Zahl durch die gespeicherte Form und zurück', () => {
    const trigger = { ...EMPTY_TRIGGER, kind: 'state' as const, entityId: 'demo.x', forMinutes: '125' };
    const config = triggerToConfig(trigger);
    expect(config.for).toBe(125 * 60);
    expect(triggerFromConfig(config).forMinutes).toBe('125');
  });
});

describe('Licht mit Feinheiten', () => {
  const licht = (over = {}) => ({
    ...EMPTY_STEP,
    kind: 'command' as const,
    commandActions: [
      { entity_id: 'hue.flur', command: 'set_brightness', brightness: 50, ...over },
    ],
  });

  it('bleibt ein schlichtes Kommando, solange nichts Feines dabei ist', () => {
    // Sonst änderte sich ein bestehender Ablauf allein durchs Öffnen.
    const [action] = stepToActions(licht());
    expect(action.type).toBe('command');
    expect(action.data.brightness).toBe(50);
  });

  it('wird zum Licht-Schritt, sobald eine Farbe dabei ist', () => {
    const [action] = stepToActions(licht({ color: '#FFD9A0' }));
    expect(action.type).toBe('light');
    expect(action.color).toBe('#FFD9A0');
    expect(action.brightness).toBe(50);
  });

  it('schreibt «adaptive» statt einer Zahl, wenn es sich anpassen soll', () => {
    const [action] = stepToActions(licht({ adaptive: true }));
    expect(action.type).toBe('light');
    expect(action.brightness).toBe('adaptive');
  });

  it('nimmt den Weissanteil mit, wenn keine Farbe gesetzt ist', () => {
    const [action] = stepToActions(licht({ colorTemp: 370 }));
    expect(action.color_temp).toBe(370);
    expect(action.color).toBeUndefined();
  });

  it('liest den Licht-Schritt unverändert zurück', () => {
    const gespeichert = stepToActions(licht({ adaptive: true, color: '#FF2D2D' }));
    const [step] = actionsToSteps(gespeichert);
    expect(step.kind).toBe('command');
    expect(step.commandActions[0]).toMatchObject({
      entity_id: 'hue.flur',
      command: 'set_brightness',
      adaptive: true,
      color: '#FF2D2D',
    });
    // Und wieder hinaus ergibt dasselbe wie vorher.
    expect(stepToActions(step)).toEqual(gespeichert);
  });

  it('erkennt, wann ein Schritt Feinheiten hat', () => {
    expect(istLichtFein({ command: 'turn_on' })).toBe(false);
    expect(istLichtFein({ command: 'turn_on', color: '#FFD9A0' })).toBe(true);
    expect(istLichtFein({ command: 'set_brightness', adaptive: true })).toBe(true);
    expect(istLichtFein({ command: 'set_brightness', colorTemp: 286 })).toBe(true);
  });
});

describe('melderMitLux', () => {
  const melder = (id: string, illumination?: number) =>
    ({
      id,
      kind: 'binary_sensor',
      name: id,
      integration: 'demo',
      state: illumination === undefined ? { state: 'off' } : { state: 'off', illumination },
      commands: [],
      available: true,
    }) as never;

  it('nimmt nur Auslöser, die wirklich Lux melden', () => {
    const entities = [melder('demo.mit', 12), melder('demo.ohne')];
    const draft = { triggers: [{ entityId: 'demo.mit' }, { entityId: 'demo.ohne' }] };
    expect(melderMitLux(draft, entities).map((entity) => entity.id)).toEqual(['demo.mit']);
  });

  it('bleibt leer, wenn kein Melder einen Helligkeitsfühler hat', () => {
    // Dann gehört die Wahl «an Helligkeit angepasst» gar nicht erst hin.
    expect(melderMitLux({ triggers: [{ entityId: 'demo.ohne' }] }, [melder('demo.ohne')])).toEqual([]);
  });
});

describe('lichtKurz', () => {
  it('sagt in der Liste, was die Lampe tut', () => {
    expect(lichtKurz({ brightness: 'adaptive' })).toBe('angepasst');
    expect(lichtKurz({ brightness: 40 })).toBe('40 %');
    expect(lichtKurz({ color: '#FF2D2D' })).toBe('an');
    expect(lichtKurz({ brightness: 40, off_after: 240 })).toBe('40 %, 4 Min.');
  });
});

describe('Nachlauf – wie lange bleibt das Licht an?', () => {
  const licht = (over = {}) => ({
    ...EMPTY_STEP,
    kind: 'command' as const,
    commandActions: [{ entity_id: 'hue.flur', command: 'turn_on', ...over }],
  });

  it('macht aus dem blossen Einschalten einen Licht-Schritt mit Nachlauf', () => {
    const [action] = stepToActions(licht({ offAfter: 240 }));
    expect(action.type).toBe('light');
    expect(action.off_after).toBe(240);
  });

  it('bleibt ohne Nachlauf das schlichte Kommando', () => {
    expect(stepToActions(licht())[0].type).toBe('command');
  });

  it('liest den Nachlauf unverändert zurück', () => {
    const gespeichert = stepToActions(licht({ offAfter: 300 }));
    const [step] = actionsToSteps(gespeichert);
    expect(step.commandActions[0].offAfter).toBe(300);
    expect(stepToActions(step)).toEqual(gespeichert);
  });

  it('schreibt die Zeit so, wie sie auf dem Knopf steht', () => {
    expect(nachlaufLabel(30)).toBe('30 Sek.');
    expect(nachlaufLabel(240)).toBe('4 Min.');
    expect(nachlaufLabel(5400)).toBe('1 h 30 min');
    expect(nachlaufLabel(0)).toBe('an lassen');
  });

  it('rechnet eingetippte Minuten in Sekunden um', () => {
    expect(sekundenWert('15')).toBe('900');
    // Nichts eingetippt heisst «an lassen», nicht «sofort aus».
    expect(sekundenWert('')).toBe('');
    expect(sekundenWert('0')).toBe('');
  });
});
