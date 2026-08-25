/** Entwurf ↔ gespeicherte Form: die neuen Felder aus dem zweiten Heft. */
import {
  EMPTY,
  EMPTY_STEP,
  EMPTY_TRIGGER,
  buildConditions,
  plainStates,
  stateOptions,
  stepToActions,
  actionsToSteps,
  toDraft,
  describe as zeileFuer,
  measurableAttributes,
  triggerFromConfig,
  istLichtFein,
  lichtKurz,
  nachlaufLabel,
  sekundenWert,
  melderMitLux,
  minutenLabel,
  minutenWert,
  symbolFuerNamen,
  szenenSymbol,
  triggerIcon,
  triggerToConfig,
  normalisiereZeit,
  unbekannterZustand,
  zeitfensterHinweis,
  zeitpunktLabel,
} from './entwurf';
import { Entity } from '../../api/types';
import { STUMM_EIN } from '../../lib/szenen';

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

  it('lässt den Namen reden, wenn der Auslöser nichts sagt', () => {
    // «Babysitter-Modus» wird von Hand ausgelöst - der Blitz sagte
    // darüber nichts, der Name sehr wohl.
    expect(triggerIcon({ ...mit({ entity_id: 'x.y' }), alias: 'Babysitter-Modus' })).toBe(
      'happy-outline'
    );
  });

  it('lässt den Auslöser vorgehen, wo er etwas weiss', () => {
    expect(
      triggerIcon({ ...mit({ type: 'time', at: '20:00' }), alias: 'Babysitter-Abend' })
    ).toBe('time-outline');
  });
});

describe('symbolFuerNamen', () => {
  it('erkennt die Abende, an denen jemand anderes im Haus ist', () => {
    expect(symbolFuerNamen('Babysitter-Modus')).toBe('happy-outline');
    expect(symbolFuerNamen('Kinder hüten')).toBe('happy-outline');
    expect(symbolFuerNamen('Besuch da')).toBe('people-outline');
  });

  it('rät nicht in zusammengesetzten Wörtern', () => {
    // Sonst würde aus «Licht im Kinderzimmer» ein Babysitter-Abend.
    expect(symbolFuerNamen('Licht im Kinderzimmer')).toBeNull();
    expect(symbolFuerNamen('Filmriss')).toBeNull();
  });

  it('sagt bei einem gewöhnlichen Namen nichts', () => {
    expect(symbolFuerNamen('Flurlicht')).toBeNull();
    expect(symbolFuerNamen('')).toBeNull();
  });
});

describe('szenenSymbol', () => {
  it('nimmt den Namen, solange niemand ein Symbol gewählt hat', () => {
    expect(szenenSymbol({ name: 'Babysitter-Modus' })).toBe('happy-outline');
    expect(szenenSymbol({ name: 'Babysitter-Modus', icon: 'sparkles-outline' })).toBe(
      'happy-outline'
    );
  });

  it('lässt ein gewähltes Symbol stehen', () => {
    expect(szenenSymbol({ name: 'Babysitter-Modus', icon: 'moon-outline' })).toBe(
      'moon-outline'
    );
  });

  it('bleibt beim Funkeln, wenn der Name nichts hergibt', () => {
    expect(szenenSymbol({ name: 'Abends' })).toBe('sparkles-outline');
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

describe('Gemeinsam umschalten', () => {
  const step = {
    ...EMPTY_STEP,
    kind: 'toggle_all' as const,
    commandActions: [
      { entity_id: 'hue.eingang', command: 'toggle' },
      { entity_id: 'hue.gang', command: 'toggle' },
    ],
  };

  it('schreibt eine Aktion mit allen Geräten, nicht eine je Lampe', () => {
    // Genau das war der Fehler: Zwei einzelne «umschalten» ergeben aus
    // «einer an, einer aus» das Gegenteil, nie einen gemeinsamen Zustand.
    const actions = stepToActions(step);
    expect(actions).toEqual([
      { type: 'toggle_all', entity_ids: ['hue.eingang', 'hue.gang'] },
    ]);
  });

  it('lässt einen leeren Schritt weg', () => {
    expect(stepToActions({ ...step, commandActions: [] })).toEqual([]);
  });

  it('liest den Schritt unverändert zurück', () => {
    const gespeichert = stepToActions(step);
    const [zurueck] = actionsToSteps(gespeichert);
    expect(zurueck.kind).toBe('toggle_all');
    expect(zurueck.commandActions.map((a) => a.entity_id)).toEqual([
      'hue.eingang',
      'hue.gang',
    ]);
    expect(stepToActions(zurueck)).toEqual(gespeichert);
  });
});

describe('Zustände, die es im Editor bisher nicht gab', () => {
  const geraet = (over: Partial<Entity>): Entity =>
    ({
      id: 'x.y',
      kind: 'light',
      name: 'Gerät',
      integration: 'x',
      state: {},
      commands: [],
      ...over,
    }) as Entity;

  it('bietet beim Fernseher an und aus an', () => {
    // Ohne das liess sich «wenn ich den Fernseher ausschalte» gar nicht
    // auswählen - dort standen nur spielt, pausiert und still.
    const tv = geraet({
      kind: 'media_player',
      commands: ['turn_on', 'turn_off', 'play', 'pause'],
    });
    expect(plainStates(tv).map((z) => z.key)).toEqual([
      'off',
      'on',
      'playing',
      'paused',
      'idle',
    ]);
  });

  it('bietet ihn bei einer Musikbox nicht an', () => {
    // Ein Cast ist immer eingeschaltet, er spielt bloss nichts.
    const box = geraet({ kind: 'media_player', commands: ['play', 'pause'] });
    expect(plainStates(box).map((z) => z.key)).toEqual(['playing', 'paused', 'idle']);
  });

  it('zählt Anwesenheit in zuhause und weg', () => {
    const person = geraet({
      kind: 'binary_sensor',
      state: { state: 'home', place: 'home', device_class: 'presence' },
    });
    expect(plainStates(person).map((z) => z.key)).toEqual(['home', 'away']);
  });

  it('bietet die Erkennungen einer Kamera als Auslöser an', () => {
    const kamera = geraet({
      kind: 'camera',
      state: { state: 'online', motion: 'off', detected_person: 'off', detected_baby_cry: 'off' },
    });
    const schluessel = stateOptions(kamera).map((option) => option.key);
    expect(schluessel).toContain('detected_baby_cry:on');
    expect(schluessel).toContain('detected_person:on');
    const baby = stateOptions(kamera).find((o) => o.key === 'detected_baby_cry:on');
    expect(baby?.label).toBe('hört ein Baby schreien');
    expect(baby?.attribute).toBe('detected_baby_cry');
  });

  it('erfindet keine Erkennung, die die Kamera nicht kann', () => {
    // Der Hub legt nur die Felder an, die die Kamera meldet - hier steht
    // also nichts, was ins Leere liefe.
    const kamera = geraet({ kind: 'camera', state: { state: 'online', motion: 'off' } });
    const schluessel = stateOptions(kamera).map((option) => option.key);
    expect(schluessel).toEqual(['motion:on', 'on', 'off']);
  });
});

describe('Zeitfenster über Mitternacht', () => {
  it('erklärt, was ab 22:00 bis 06:00 bedeutet', () => {
    expect(zeitfensterHinweis('22:00', '06:00')).toContain('über Mitternacht');
    expect(zeitfensterHinweis('22:00', '06:00')).toContain('nächsten Morgen');
  });

  it('schweigt beim gewöhnlichen Fenster und bei Unsinn', () => {
    expect(zeitfensterHinweis('08:00', '17:00')).toBeNull();
    expect(zeitfensterHinweis('22:00', '')).toBeNull();
    expect(zeitfensterHinweis('', '')).toBeNull();
    expect(zeitfensterHinweis('abends', '06:00')).toBeNull();
  });
});

describe('Uhrzeit von Hand eintippen', () => {
  it('zieht gerade, was man tatsächlich tippt', () => {
    expect(normalisiereZeit('22:00')).toBe('22:00');
    expect(normalisiereZeit('22')).toBe('22:00');
    expect(normalisiereZeit('2230')).toBe('22:30');
    expect(normalisiereZeit('22.30')).toBe('22:30');
    expect(normalisiereZeit(' 8:5 ')).toBe('08:05');
    expect(normalisiereZeit('')).toBe('');
  });

  it('lässt einen Tippfehler stehen, statt ihn zu löschen', () => {
    // Kommentarlos leeren wäre die unfreundlichere Antwort - dann sucht
    // man, wo die Eingabe hin ist.
    expect(normalisiereZeit('abends')).toBe('abends');
    expect(normalisiereZeit('25:00')).toBe('25:00');
    expect(normalisiereZeit('22:75')).toBe('22:75');
  });

  it('erkennt das Nachtfenster auch in Kurzschreibweise', () => {
    expect(zeitfensterHinweis('22', '6')).toContain('über Mitternacht');
    expect(zeitfensterHinweis('22', '6')).toContain('von 22:00 bis 06:00');
  });
});

describe('Türen als Auslöser', () => {
  const geraet = (over = {}) =>
    ({
      id: 'x.y',
      kind: 'binary_sensor',
      name: 'Haustüre',
      integration: 'demo',
      state: { state: 'off' },
      commands: [],
      available: true,
      ...over,
    }) as never;

  it('bietet den Türsensor eines Schlosses an', () => {
    // Nuki Pro und Matter melden «door» neben dem Schloss-Zustand: Wer
    // die Türe öffnet, ohne abzuschliessen, war sonst nicht auslösbar.
    const schloss = geraet({ kind: 'lock', state: { state: 'locked', door: 'closed' } });
    const keys = stateOptions(schloss).map((option) => option.key);
    expect(keys).toContain('door:open');
    expect(keys).toContain('door:closed');
    const auf = stateOptions(schloss).find((option) => option.key === 'door:open');
    expect(auf).toMatchObject({ attribute: 'door', to: 'open', label: 'wird geöffnet' });
  });

  it('lässt ein Schloss ohne Türsensor in Ruhe', () => {
    const keys = stateOptions(geraet({ kind: 'lock', state: { state: 'locked' } })).map(
      (option) => option.key
    );
    expect(keys).toEqual(['unlocked', 'locked']);
  });

  it('nennt «an» bei einem Türkontakt «geöffnet»', () => {
    // «an» klingt bei einer Türe nach Licht - und man wählt das Falsche.
    expect(
      plainStates(geraet({ state: { state: 'off', device_class: 'contact' } }))
    ).toEqual([
      { key: 'on', label: 'geöffnet' },
      { key: 'off', label: 'geschlossen' },
    ]);
  });

  it('lässt andere Melder bei an/aus', () => {
    expect(
      plainStates(geraet({ state: { state: 'off', device_class: 'motion' } }))
    ).toEqual([
      { key: 'on', label: 'an' },
      { key: 'off', label: 'aus' },
    ]);
  });
});

describe('Lautsprecher in Abläufen', () => {
  it('schreibt die eingestellte Lautstärke mit', () => {
    // Der Chip «Lautstärke» stand da, der Wert ging beim Speichern
    // verloren: stepToActions kannte set_volume nicht, und der Hub bekam
    // ein Kommando ohne Zahl.
    const actions = stepToActions({
      ...EMPTY_STEP,
      commandActions: [
        { entity_id: 'cast.bad', command: 'set_volume', volume: 20 },
      ],
    });
    expect(actions).toEqual([
      { type: 'command', entity_id: 'cast.bad', command: 'set_volume', data: { volume: 20 } },
    ]);
  });

  it('liest sie unverändert zurück', () => {
    const gespeichert = stepToActions({
      ...EMPTY_STEP,
      commandActions: [{ entity_id: 'cast.bad', command: 'set_volume', volume: 20 }],
    });
    const [zurueck] = actionsToSteps(gespeichert);
    expect(zurueck.commandActions[0].volume).toBe(20);
    expect(stepToActions(zurueck)).toEqual(gespeichert);
  });

  it('macht aus «Musik an» mit Playlist ein play_playlist – und zurück', () => {
    // Im Editor wählt man den Lautsprecher, «Musik an» und darunter die
    // Playlist. Beim Hub heisst das play_playlist mit dem Namen in den
    // Zusatzdaten; beim nächsten Öffnen muss wieder «Musik an» leuchten,
    // sonst steht die Zeile da wie versehentlich angelegt.
    const gespeichert = [
      {
        type: 'command',
        entity_id: 'spotify.player',
        command: 'play_playlist',
        data: { name: 'Frühstück', device: 'Küche', shuffle: true },
      },
      {
        type: 'command',
        entity_id: 'tv.stube',
        command: 'launch_app',
        data: { app: 'com.netflix' },
      },
    ];
    expect(
      stepToActions({
        ...EMPTY_STEP,
        commandActions: [
          {
            entity_id: 'spotify.player',
            command: 'play',
            playlist: 'Frühstück',
            device: 'Küche',
            shuffle: true,
          },
          { entity_id: 'tv.stube', command: 'launch_app', app: 'com.netflix' },
        ],
      })
    ).toEqual(gespeichert);

    const [zurueck] = actionsToSteps(gespeichert);
    expect(zurueck.commandActions[0]).toMatchObject({
      command: 'play',
      playlist: 'Frühstück',
      device: 'Küche',
      shuffle: true,
    });
    expect(stepToActions(zurueck)).toEqual(gespeichert);
  });

  it('lässt «Musik an» ohne Playlist ein schlichtes play', () => {
    // Wer nur «weiterspielen» will, soll nicht ungefragt eine Playlist
    // gestartet bekommen.
    expect(
      stepToActions({
        ...EMPTY_STEP,
        commandActions: [{ entity_id: 'spotify.player', command: 'play' }],
      })
    ).toEqual([{ type: 'command', entity_id: 'spotify.player', command: 'play' }]);
  });

  it('rührt die Reihenfolge nicht an, wenn niemand sie gewählt hat', () => {
    // Eine Szene «Kino» soll das Konto nicht heimlich auf Zufall stellen.
    const [aktion] = stepToActions({
      ...EMPTY_STEP,
      commandActions: [
        { entity_id: 'spotify.player', command: 'play', playlist: 'Kino' },
      ],
    });
    expect(aktion.data).toEqual({ name: 'Kino' });
  });

  it('übersetzt «stumm» in mute mit Zusatzfeld – und zurück', () => {
    const actions = stepToActions({
      ...EMPTY_STEP,
      commandActions: [{ entity_id: 'cast.bad', command: STUMM_EIN }],
    });
    expect(actions).toEqual([
      { type: 'command', entity_id: 'cast.bad', command: 'mute', data: { muted: true } },
    ]);
    // Beim Öffnen muss wieder der Chip «stumm» leuchten, nicht «Ton an».
    expect(actionsToSteps(actions)[0].commandActions[0].command).toBe(STUMM_EIN);
  });

  it('lässt eine Lautstärke ohne Zahl nicht ins Leere laufen', () => {
    const [action] = stepToActions({
      ...EMPTY_STEP,
      commandActions: [{ entity_id: 'cast.bad', command: 'set_volume' }],
    });
    expect(action.data).toEqual({ volume: 30 });
  });
});

describe('Türöffner sind keine Schlösser', () => {
  const geraet = (over: Partial<Entity>): Entity =>
    ({
      id: 'ring.haustuere',
      kind: 'lock',
      name: 'Haustüre',
      integration: 'ring',
      state: { state: 'online' },
      commands: [],
      available: true,
      ...over,
    }) as Entity;

  it('bietet bei der Gegensprechanlage «wird geöffnet» statt «aufgeschlossen»', () => {
    // Sie hat keinen Riegel und meldet nie «unlocked». Wer das als
    // Auslöser wählte, baute einen Ablauf, der nie läuft - und der
    // keinen Grund dafür nennt.
    const anlage = geraet({ commands: ['open_door'] });
    expect(plainStates(anlage).map((z) => z.key)).toEqual([
      'opened',
      'online',
      'offline',
    ]);
  });

  it('lässt ein richtiges Schloss bei auf- und abgeschlossen', () => {
    const nuki = geraet({ commands: ['lock', 'unlock', 'unlatch'] });
    expect(plainStates(nuki).map((z) => z.key)).toEqual(['unlocked', 'locked']);
  });
});

describe('Ein Auslöser, der auf Unmögliches wartet', () => {
  const anlage = {
    id: 'ring.haustuere',
    kind: 'lock',
    name: 'Haustüre',
    integration: 'ring',
    state: { state: 'online' },
    commands: ['open_door'],
    available: true,
  } as Entity;

  it('sagt es, statt stumm keinen Chip auszuwählen', () => {
    // Ein Ablauf aus früherer Zeit horcht auf «aufgeschlossen» - die
    // Gegensprechanlage meldet das nie. Er läuft dann nie und nennt
    // keinen Grund.
    const satz = unbekannterZustand(anlage, '', 'unlocked');
    expect(satz).toContain('meldet nie «unlocked»');
    expect(satz).toContain('wird geöffnet');
  });

  it('schweigt, wenn der Zustand passt', () => {
    expect(unbekannterZustand(anlage, '', 'opened')).toBeNull();
    expect(unbekannterZustand(undefined, '', 'opened')).toBeNull();
    expect(unbekannterZustand(anlage, '', '')).toBeNull();
  });
});

describe('Grill in Abläufen', () => {
  it('schreibt die Zieltemperatur mit', () => {
    // Dieselbe Falle wie bei der Lautstärke: Der Chip steht da, und ohne
    // diesen Zweig bekäme der Hub ein set_temperature ohne Zahl.
    expect(
      stepToActions({
        ...EMPTY_STEP,
        commandActions: [
          { entity_id: 'pitboss.smoker', command: 'set_temperature', temperature: 110 },
        ],
      })
    ).toEqual([
      {
        type: 'command',
        entity_id: 'pitboss.smoker',
        command: 'set_temperature',
        data: { temperature: 110 },
      },
    ]);
  });

  it('liest sie unverändert zurück', () => {
    const gespeichert = stepToActions({
      ...EMPTY_STEP,
      commandActions: [
        { entity_id: 'pitboss.smoker', command: 'set_temperature', temperature: 110 },
      ],
    });
    const [zurueck] = actionsToSteps(gespeichert);
    expect(zurueck.commandActions[0].temperature).toBe(110);
    expect(stepToActions(zurueck)).toEqual(gespeichert);
  });

  it('lässt eine Temperatur ohne Zahl nicht ins Leere laufen', () => {
    const [action] = stepToActions({
      ...EMPTY_STEP,
      commandActions: [{ entity_id: 'pitboss.smoker', command: 'set_temperature' }],
    });
    expect(action.data).toEqual({ temperature: 120 });
  });
});


// ── Die Sammelfrage «ist noch jemand da?» ────────────────────────────────
//
// Sie zählt technisch in an/aus, und genau so stand es im Editor. Wer
// «wenn der Letzte geht» bauen wollte, musste raten, ob das nun «an» oder
// «aus» ist - und die Hälfte rät falsch.

describe('plainStates für die Anwesenheit', () => {
  const sammel = {
    id: 'geofence.anyone_home',
    kind: 'binary_sensor',
    name: 'Jemand zuhause',
    integration: 'geofence',
    state: { state: 'on', device_class: 'presence', away: ['Livia'] },
    commands: [],
    available: true,
  } as unknown as Entity;

  it('sagt, was an und aus bedeuten', () => {
    expect(plainStates(sammel)).toEqual([
      { key: 'on', label: 'jemand ist zuhause' },
      { key: 'off', label: 'niemand ist zuhause' },
    ]);
  });

  it('verwechselt sie nicht mit einer einzelnen Person', () => {
    // Die Zone einer Person führt einen Ort, keine Abwesenden-Liste.
    const person = {
      id: 'geofence.stefan',
      kind: 'binary_sensor',
      name: 'Stefan',
      integration: 'geofence',
      state: { state: 'home', device_class: 'presence', place: 'home' },
      commands: [],
      available: true,
    } as unknown as Entity;
    expect(plainStates(person)).toEqual([
      { key: 'home', label: 'zuhause' },
      { key: 'away', label: 'weg' },
    ]);
  });
});

describe('Die Sammelanwesenheit im Editor', () => {
  it('kommt als Zustandswechsel zurück, nicht als Ort', () => {
    // Der gemeldete Ablauf «Niemand mehr zuhause»: gespeichert richtig,
    // im Editor aber unter «Ort» mit «kommt an / geht weg» und einer
    // Liste von Orten - eine Frage, die es hier gar nicht gibt.
    const zurueck = triggerFromConfig({
      type: 'state',
      entity_id: 'geofence.anyone_home',
      to: 'off',
      for: 600,
    });
    expect(zurueck.kind).toBe('state');
    expect(zurueck.toState).toBe('off');
    expect(zurueck.forMinutes).toBe('10');
  });

  it('lässt echte Ortsmelder unverändert', () => {
    const zurueck = triggerFromConfig({
      type: 'state',
      entity_id: 'geofence.livia',
      to: 'schule_zell',
    });
    expect(zurueck.kind).toBe('geofence');
    expect(zurueck.ortId).toBe('schule_zell');
  });

  it('gibt ihr ein eigenes Sinnbild', () => {
    // Sie fragt nach Menschen, nicht nach einem Ort.
    const mit = (trigger: Record<string, unknown>) =>
      triggerIcon({ triggers: [trigger] } as unknown as Parameters<typeof triggerIcon>[0]);
    expect(mit({ entity_id: 'geofence.anyone_home', to: 'off' })).toBe('people-outline');
    expect(mit({ entity_id: 'geofence.livia', to: 'home' })).toBe('location-outline');
  });
});

describe('Die Listenzeile spricht Deutsch', () => {
  const jemand = {
    id: 'geofence.anyone_home',
    name: 'Jemand zuhause',
    kind: 'binary_sensor',
    integration: 'geofence',
    state: { state: 'on', away: [] },
    commands: [],
  } as unknown as Entity;

  it('sagt bei der Sammelanwesenheit, was gemeint ist', () => {
    // Vorher stand hier die nackte Kennung: «wenn geofence.anyone_home
    // → off» - keine Auskunft, sondern eine Aufgabe.
    const zeile = zeileFuer(
      {
        id: 'x',
        alias: 'Niemand mehr zuhause',
        triggers: [{ type: 'state', entity_id: 'geofence.anyone_home', to: 'off' }],
        actions: [{ type: 'command', entity_id: 'light.buero', command: 'turn_off' }],
      } as unknown as Parameters<typeof zeileFuer>[0],
      [jemand, { id: 'light.buero', name: 'Büro' } as unknown as Entity]
    );
    expect(zeile).toContain('wenn niemand mehr zuhause ist');
    expect(zeile).not.toContain('geofence.anyone_home');
    // Und auf der anderen Seite des Pfeils dasselbe: «light.buero
    // turn_off» liest niemand als «Büro aus».
    expect(zeile).toContain('Büro aus');
    expect(zeile).not.toContain('turn_off');
  });

  it('nennt bei einem Ortsmelder Person und Ort', () => {
    const livia = { ...jemand, id: 'geofence.livia', name: 'Livia' } as unknown as Entity;
    const zeile = zeileFuer(
      {
        id: 'x',
        alias: 'Livia in der Schule',
        triggers: [{ type: 'state', entity_id: 'geofence.livia', to: 'schule_zell' }],
        actions: [{ type: 'notify' }],
      } as unknown as Parameters<typeof zeileFuer>[0],
      [livia]
    );
    expect(zeile).toContain('wenn Livia kommt bei Schule Zell an');
  });
});

describe('Ankunft als Auslöser', () => {
  it('bietet die Entfernung als Messwert an', () => {
    // «Wenn Stefan näher als 2 km ist, Storen hoch» - ein gewöhnlicher
    // Schwellenwert, keine eigene Auslöser-Art.
    const stefan = {
      id: 'geofence.stefan',
      name: 'Stefan',
      kind: 'binary_sensor',
      integration: 'geofence',
      state: { state: 'away', place: null, distance: 4200 },
      commands: [],
    } as unknown as Entity;
    expect(measurableAttributes(stefan).map((m) => m.key)).toContain('distance');
    expect(measurableAttributes(stefan).find((m) => m.key === 'distance')?.label).toBe(
      'Entfernung von zuhause (m)'
    );
  });

  it('bietet sie nicht an, wo keine Position vorliegt', () => {
    const ohne = {
      id: 'geofence.oma',
      name: 'Oma',
      kind: 'binary_sensor',
      integration: 'geofence',
      state: { state: 'away', distance: null },
      commands: [],
    } as unknown as Entity;
    expect(measurableAttributes(ohne).map((m) => m.key)).not.toContain('distance');
  });
});
