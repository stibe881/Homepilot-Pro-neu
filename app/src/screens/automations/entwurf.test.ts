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
