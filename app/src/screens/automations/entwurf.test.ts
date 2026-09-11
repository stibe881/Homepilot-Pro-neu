/** Entwurf ↔ gespeicherte Form: die neuen Felder aus dem zweiten Heft. */
import {
  EMPTY,
  type Run,
  wirkungText,
  lastRunText,
  EMPTY_STEP,
  EMPTY_TRIGGER,
  buildConditions,
  plainStates,
  stateOptions,
  stepToActions,
  actionsToSteps,
  toDraft,
  describe as zeileFuer,
  geraetePlatzhalter,
  hatWartezeit,
  schaltetSpaeterAus,
  kopieSchritt,
  measurableAttributes,
  meldetEtwas,
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
  wasFehlt,
  istSpeicherbar,
  angabenStand,
  bedingungStand,
  namensVorschlag,
  sonstStand,
  stundeAusText,
  kontextConditionFromConfig,
  kontextConditionToConfig,
} from './entwurf';
import { Draft, StepDraft } from './entwurf';
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

describe('Nachricht mit Verzögerung', () => {
  it('lässt «sofort» ganz weg', () => {
    // Ein `delay: 0` in jedem Ablauf wäre Ballast in der Datei - und
    // beim Vergleichen zweier Abläufe ein Unterschied, der keiner ist.
    const [action] = stepToActions({
      ...EMPTY_STEP,
      kind: 'notify',
      title: 'Hallo',
      body: '',
    });
    expect(action.delay).toBeUndefined();
  });

  it('trägt die Sekunden hin und zurück', () => {
    // Der Fall: «Jemand hat die Türe geöffnet» mit einem Bild, auf dem
    // niemand steht - das Bild entsteht beim Senden und wartet mit.
    const [action] = stepToActions({
      ...EMPTY_STEP,
      kind: 'notify',
      title: 'Türe',
      body: '',
      notifyCamera: 'unifi.keller',
      notifyVerzoegerung: 5,
    });
    expect(action.delay).toBe(5);
    expect(actionsToSteps([action])[0].notifyVerzoegerung).toBe(5);
  });

  it('nimmt Unsinn aus einer alten Datei als «sofort»', () => {
    expect(actionsToSteps([{ type: 'notify', delay: 'gleich' }])[0].notifyVerzoegerung).toBe(0);
    expect(actionsToSteps([{ type: 'notify' }])[0].notifyVerzoegerung).toBe(0);
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

  it('nimmt das Umschalten mit - der Wandtaster', () => {
    // Der Hub kennt seit Kurzem `toggle` am Licht-Schritt: Brennt die
    // Lampe, geht sie aus; brennt sie nicht, geht sie so an, wie es
    // hier steht. Vorher fielen die Feinheiten beim Umschalten
    // stillschweigend weg, und man musste sich zwischen «immer an» und
    // «umschalten ohne Vorgaben» entscheiden.
    expect(istLichtFein({ command: 'toggle', colorTemp: 286 })).toBe(true);
    // Auch die blosse Helligkeit zählt: Einen Chip «umschalten,
    // gedimmt» gibt es nicht, die Zahl steht unter demselben Knopf.
    expect(istLichtFein({ command: 'toggle', brightness: 20 })).toBe(true);
    // Ohne Vorgabe bleibt es das schlichte Kommando von früher.
    expect(istLichtFein({ command: 'toggle' })).toBe(false);
  });

  it('nur beim Einschalten - «aus» hat keine Feinheiten', () => {
    // Der Aktionstyp 'light' heisst beim Hub «mach sie an, und zwar so»;
    // einen Befehl trägt er nur als `toggle`. Eine Farbe, die vom
    // Einschalten stehen geblieben ist, darf ein «aus» nicht dorthin
    // schicken.
    expect(istLichtFein({ command: 'turn_off', color: '#FFD9A0' })).toBe(false);
    expect(istLichtFein({ command: 'turn_off', offAfter: 300 })).toBe(false);
  });

  it('trägt das Umschalten samt Vorgaben hin und zurück', () => {
    const step = licht({ command: 'toggle', brightness: 20, colorTemp: 400 });
    const [gespeichert] = stepToActions(step);
    expect(gespeichert).toMatchObject({
      type: 'light',
      toggle: true,
      brightness: 20,
      color_temp: 400,
    });
    const [zurueck] = actionsToSteps([gespeichert]);
    expect(zurueck.commandActions[0]).toMatchObject({
      command: 'toggle',
      brightness: 20,
      colorTemp: 400,
    });
  });

  it('lässt die Helligkeit beim Umschalten weg, wenn keine gewählt ist', () => {
    // «Helligkeit lassen» ist dort die Vorgabe - ein Taster, der jedes
    // Mal auf 50 % zwingt, nähme einem das Dimmen von Hand weg.
    const [gespeichert] = stepToActions(
      licht({ command: 'toggle', brightness: undefined, color: '#FFD9A0' })
    );
    expect(gespeichert.toggle).toBe(true);
    expect(gespeichert.brightness).toBeUndefined();
  });

  it('«aus» bleibt «aus» - auch mit stehen gebliebener Farbe', () => {
    // Der gemeldete Fehler: Chip auf «aus», speichern, öffnen - und er
    // stand wieder auf «ein». Der Ablauf schaltete die Lampe damit AN,
    // wo er sie ausschalten sollte; die Anzeige war nur der sichtbare
    // Teil davon.
    const aus = licht({ command: 'turn_off', brightness: undefined, color: '#FFD9A0' });
    const gespeichert = stepToActions(aus);
    expect(gespeichert[0].type).toBe('command');
    expect(gespeichert[0].command).toBe('turn_off');

    const [zurueck] = actionsToSteps(gespeichert);
    expect(zurueck.commandActions[0].command).toBe('turn_off');
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
    expect(lichtKurz({ brightness: 'adaptive' })).toBe('nach Raumhelligkeit');
    // Der zweite Weg zur Helligkeit - der ohne Fühler.
    expect(lichtKurz({ brightness: 'tageszeit' })).toBe('nach Tageszeit');
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

describe('wasFehlt', () => {
  const entwurf = (patch: Partial<Draft> = {}): Draft => ({
    ...EMPTY,
    triggers: [{ ...EMPTY_TRIGGER }],
    steps: [{ ...EMPTY_STEP }],
    ...patch,
  });

  const schalten = (entityId: string): StepDraft => ({
    ...EMPTY_STEP,
    kind: 'command',
    commandActions: [{ entity_id: entityId, command: 'turn_on' }],
  });

  it('bemängelt einen Auslöser ohne Gerät', () => {
    expect(wasFehlt(entwurf({ steps: [schalten('licht')] }))).toEqual([
      'Wenn: ein Gerät wählen',
    ]);
  });

  it('sagt am unvollständigen Schritt, was ihm fehlt', () => {
    // Der Schritt steht im Formular, hat aber kein Gerät angekreuzt.
    // «Einen Schritt, der etwas tut» las sich da wie Unsinn - der
    // Schritt stand ja vor einem. Jetzt steht, wohin die Hand muss.
    const raus = wasFehlt(
      entwurf({ triggers: [{ ...EMPTY_TRIGGER, entityId: 'melder' }] })
    );
    expect(raus).toEqual(['Dann («Gerät schalten»): ein Gerät ankreuzen']);
  });

  it('bemängelt das Fehlen jedes Schritts weiterhin als Fehlen', () => {
    const raus = wasFehlt(
      entwurf({ triggers: [{ ...EMPTY_TRIGGER, entityId: 'melder' }], steps: [] })
    );
    expect(raus).toEqual(['Dann: einen Schritt, der etwas tut']);
  });

  it('nennt bei mehreren Schritten die Nummer', () => {
    const raus = wasFehlt(
      entwurf({
        triggers: [{ ...EMPTY_TRIGGER, entityId: 'melder' }],
        steps: [{ ...EMPTY_STEP }, { ...EMPTY_STEP, kind: 'scene' }],
      })
    );
    expect(raus).toEqual([
      'Dann, Schritt 1 («Gerät schalten»): ein Gerät ankreuzen',
      'Dann, Schritt 2 («Szene»): eine Szene wählen',
    ]);
  });

  it('ist zufrieden, sobald Auslöser und Schritt stehen', () => {
    const gut = entwurf({
      triggers: [{ ...EMPTY_TRIGGER, entityId: 'melder' }],
      steps: [schalten('licht')],
    });
    expect(wasFehlt(gut)).toEqual([]);
    expect(istSpeicherbar(gut)).toBe(true);
  });

  it('verlangt keinen Namen', () => {
    // Ein namenloser Ablauf schaltet trotzdem richtig; der Hub trägt
    // «Ohne Namen» ein.
    const ohne = entwurf({
      alias: '',
      triggers: [{ ...EMPTY_TRIGGER, entityId: 'melder' }],
      steps: [schalten('licht')],
    });
    expect(istSpeicherbar(ohne)).toBe(true);
  });

  it('verlangt bei Uhrzeit-Auslösern kein Gerät', () => {
    const uhr = entwurf({
      triggers: [{ ...EMPTY_TRIGGER, kind: 'time', at: '07:00' }],
      steps: [schalten('licht')],
    });
    expect(wasFehlt(uhr)).toEqual([]);
  });

  it('bemängelt eine fehlende Uhrzeit', () => {
    const uhr = entwurf({
      triggers: [{ ...EMPTY_TRIGGER, kind: 'time', at: '  ' }],
      steps: [schalten('licht')],
    });
    expect(wasFehlt(uhr)).toEqual(['Wenn: eine Uhrzeit eintragen']);
  });

  it('verlangt beim Sonnenstand weder Gerät noch Uhrzeit', () => {
    const sonne = entwurf({
      triggers: [{ ...EMPTY_TRIGGER, kind: 'sun' }],
      steps: [schalten('licht')],
    });
    expect(wasFehlt(sonne)).toEqual([]);
  });

  it('nummeriert, sobald es mehrere Auslöser gibt', () => {
    const zwei = entwurf({
      triggers: [{ ...EMPTY_TRIGGER, entityId: 'melder' }, { ...EMPTY_TRIGGER }],
      steps: [schalten('licht')],
    });
    expect(wasFehlt(zwei)).toEqual(['Auslöser 2: ein Gerät wählen']);
  });
});

describe('Klappen-Stände', () => {
  const entwurf = (patch: Partial<Draft> = {}): Draft => ({ ...EMPTY, ...patch });

  it('lässt die Bedingung leer, wo keine steht', () => {
    expect(bedingungStand(entwurf())).toBe('');
  });

  it('nennt Tag und Nacht beim Namen', () => {
    expect(bedingungStand(entwurf({ conditionKind: 'sun', conditionSun: 'down' }))).toBe(
      'nur wenn dunkel'
    );
  });

  it('zählt Gerätebedingungen und Gruppen', () => {
    const stand = bedingungStand(
      entwurf({
        conditionKind: 'time',
        stateConditions: [
          { entity_id: 'a', op: 'is' as const, value: 'on' },
          { entity_id: 'b', op: 'is' as const, value: 'off' },
        ],
        weekdays: [1, 2],
      })
    );
    expect(stand).toBe('Zeitfenster · 2 Geräte · Wochentage');
  });

  it('schweigt zum Normalfall «läuft»', () => {
    expect(angabenStand(entwurf())).toBe('');
    expect(angabenStand(entwurf({ enabled: false }))).toBe('aus');
    expect(angabenStand(entwurf({ category: 'Beleuchtung' }))).toBe('Beleuchtung');
    expect(angabenStand(entwurf({ category: 'Licht', enabled: false }))).toBe(
      'Licht · aus'
    );
  });

  it('behandelt eine leere Kategorie wie keine', () => {
    expect(angabenStand(entwurf({ category: '   ' }))).toBe('');
  });

  it('zählt die Schritte im Sonst-Zweig', () => {
    expect(sonstStand(entwurf())).toBe('');
    expect(sonstStand(entwurf({ elseSteps: [{ ...EMPTY_STEP }] }))).toBe('1 Schritt');
    expect(
      sonstStand(entwurf({ elseSteps: [{ ...EMPTY_STEP }, { ...EMPTY_STEP }] }))
    ).toBe('2 Schritte');
  });
});

describe('namensVorschlag', () => {
  const geraete = [
    { id: 'melder', name: 'Bewegung Flur', kind: 'binary_sensor', commands: [], state: {} },
    { id: 'licht', name: 'Licht Wohnzimmer', kind: 'light', commands: [], state: {} },
  ] as unknown as Entity[];

  const entwurf = (patch: Partial<Draft> = {}): Draft => ({
    ...EMPTY,
    triggers: [{ ...EMPTY_TRIGGER, entityId: 'melder' }],
    steps: [
      {
        ...EMPTY_STEP,
        kind: 'command',
        commandActions: [{ entity_id: 'licht', command: 'turn_on' }],
      },
    ],
    ...patch,
  });

  it('setzt zusammen, was der Ablauf tut', () => {
    expect(namensVorschlag(entwurf(), geraete)).toBe('Licht Wohnzimmer bei Bewegung Flur');
  });

  it('nennt die Uhrzeit', () => {
    const uhr = entwurf({ triggers: [{ ...EMPTY_TRIGGER, kind: 'time', at: '07:00' }] });
    expect(namensVorschlag(uhr, geraete)).toBe('Licht Wohnzimmer um 07:00');
  });

  it('nennt den Sonnenstand', () => {
    const sonne = entwurf({
      triggers: [{ ...EMPTY_TRIGGER, kind: 'sun', sunEvent: 'sunset' }],
    });
    expect(namensVorschlag(sonne, geraete)).toBe('Licht Wohnzimmer bei Sonnenuntergang');
  });

  it('bleibt leer, solange ein Ende fehlt', () => {
    // Lieber «Ohne Namen» als ein halber Satz.
    expect(namensVorschlag(entwurf({ triggers: [{ ...EMPTY_TRIGGER }] }), geraete)).toBe('');
    expect(namensVorschlag(entwurf({ steps: [{ ...EMPTY_STEP }] }), geraete)).toBe('');
  });

  it('bleibt leer, wenn das Gerät nicht mehr da ist', () => {
    expect(namensVorschlag(entwurf(), [])).toBe('');
  });

  it('benennt eine Durchsage beim Wort', () => {
    const sagen = entwurf({
      steps: [{ ...EMPTY_STEP, kind: 'broadcast', broadcastText: 'Essen ist fertig!' }],
    });
    expect(namensVorschlag(sagen, geraete)).toBe('Durchsage bei Bewegung Flur');
  });
});

describe('Wirkte der Ablauf?', () => {
  const lauf = (effect: Run['effect']): Run => ({
    automation_id: 'a',
    alias: 'Licht bei Bewegung',
    at: 1_700_000_000,
    executed: true,
    skipped: [],
    effect,
  });

  test('was gewirkt hat, steht nicht daneben – sonst übersieht man die eine Zeile', () => {
    expect(wirkungText(lauf({ urteil: 'gewirkt', geprueft: 2, nicht: [] }))).toBeNull();
  });

  test('ein Lauf ohne Nachschau meldet nichts', () => {
    expect(wirkungText(lauf(null))).toBeNull();
    expect(wirkungText(lauf(undefined))).toBeNull();
  });

  test('wirkungslos nennt die Geräte, die nicht folgten', () => {
    expect(
      wirkungText(lauf({ urteil: 'wirkungslos', geprueft: 1, nicht: ['Licht Küche'] }))
    ).toBe('wirkte nicht: Licht Küche');
  });

  test('halb gewirkt sagt, welches Gerät fehlt', () => {
    expect(
      wirkungText(lauf({ urteil: 'teilweise', geprueft: 2, nicht: ['Stehlampe'] }))
    ).toBe('wirkte nur halb – ohne Stehlampe');
  });

  test('die zugeklappte Zeile trägt es mit – dort sucht man danach', () => {
    const runs = [lauf({ urteil: 'wirkungslos', geprueft: 1, nicht: ['Licht Küche'] })];
    expect(lastRunText(runs, 'a')).toContain('wirkte nicht: Licht Küche');
    expect(lastRunText(runs, 'a')).toContain('ausgeführt');
  });
});

describe('Anwesenheit melden', () => {
  const schritt = (teil: Partial<StepDraft>): StepDraft => ({
    ...EMPTY_STEP,
    kind: 'presence',
    ...teil,
  });

  it('speichert die Kennung der Person und die Richtung', () => {
    expect(
      stepToActions(schritt({ presenceZone: 'levin', presenceEvent: 'enter' }))
    ).toEqual([{ type: 'presence', zone: 'levin', event: 'enter' }]);
  });

  it('lässt einen Schritt ohne Person weg', () => {
    // Gespeichert wäre er ein Schritt, der beim Laufen nichts findet.
    expect(stepToActions(schritt({ presenceZone: '' }))).toEqual([]);
  });

  it('liest sich beim Bearbeiten wieder als Anwesenheit', () => {
    const zurueck = actionsToSteps([
      { type: 'presence', zone: 'levin', event: 'leave' },
    ]);
    expect(zurueck[0].kind).toBe('presence');
    expect(zurueck[0].presenceZone).toBe('levin');
    expect(zurueck[0].presenceEvent).toBe('leave');
  });

  it('fällt bei unbekannter Richtung auf «kommt an» zurück', () => {
    // Ein Ankommen richtet schlimmstenfalls nichts an; ein geratenes
    // «weg» schaltete das Haus ab, während jemand darin sitzt.
    expect(actionsToSteps([{ type: 'presence', zone: 'levin' }])[0].presenceEvent).toBe(
      'enter'
    );
  });
});

describe('Nachtruhe eines Ablaufs', () => {
  it('fragt nur, wo der Ablauf auch etwas sagt', () => {
    // Eine Einstellung, die nichts bewirkt, macht die Seite länger und
    // die Sache unklarer.
    expect(meldetEtwas([{ kind: 'command' }])).toBe(false);
    expect(meldetEtwas([{ kind: 'command' }, { kind: 'notify' }])).toBe(true);
    expect(meldetEtwas([{ kind: 'broadcast' }])).toBe(true);
  });

  it('nimmt den Schalter aus dem gespeicherten Ablauf mit', () => {
    // Ohne ihn stünde der Editor beim nächsten Öffnen auf «melden wie
    // sonst» - und ein Speichern nähme dem Ablauf still die Nachtruhe.
    const auto = {
      id: 'a',
      alias: 'Geschirrspüler',
      triggers: [],
      conditions: [],
      actions: [],
      editable: true,
      quiet_night: true,
    };
    expect(toDraft(auto).nachtsStill).toBe(true);
    expect(toDraft({ ...auto, quiet_night: undefined }).nachtsStill).toBe(false);
  });

  it('eigene Nachtruhe-Stunden statt der Vorgabe (Punkt 379)', () => {
    const auto = {
      id: 'a', alias: 'Früh', triggers: [], conditions: [], actions: [],
      editable: true, quiet_night: true, quiet_from: 5, quiet_to: 7,
    };
    const draft = toDraft(auto);
    expect(draft.nachtsVon).toBe(5);
    expect(draft.nachtsBis).toBe(7);
    // Ohne Angabe: die Vorgabe, nicht 0.
    expect(toDraft({ ...auto, quiet_from: undefined, quiet_to: undefined }).nachtsVon).toBeNull();
  });
});

describe('Wenn/Sonst und Wiederholen als Schritte (Punkt 251)', () => {
  const wennSchritt = (patch: Partial<StepDraft>): StepDraft => ({
    ...EMPTY_STEP,
    kind: 'if',
    ifConditions: [{ entity_id: 'hm.lux', op: 'below', value: '20' }],
    ifThen: [
      {
        ...EMPTY_STEP,
        kind: 'command',
        commandActions: [{ entity_id: 'hue.flur', command: 'turn_on' }],
      },
    ],
    ...patch,
  });

  it('speichert einen wenn-Schritt mit dann und sonst', () => {
    const actions = stepToActions(
      wennSchritt({
        ifElse: [{ ...EMPTY_STEP, kind: 'broadcast', broadcastText: 'hell genug' }],
      })
    );
    expect(actions).toEqual([
      {
        type: 'if',
        conditions: [{ type: 'state', entity_id: 'hm.lux', below: 20 }],
        match: 'all',
        then: [{ type: 'command', entity_id: 'hue.flur', command: 'turn_on' }],
        else: [{ type: 'broadcast', text: 'hell genug' }],
      },
    ]);
  });

  it('lässt den leeren sonst-Zweig weg', () => {
    const [action] = stepToActions(wennSchritt({}));
    expect(action.else).toBeUndefined();
  });

  it('ergibt ohne Bedingung oder ohne Zweig keine Aktion', () => {
    // Ohne Bedingung hiesse der Schritt beim Hub «gilt immer», ohne
    // Zweig wäre er eine leere Klammer - beides bleibt Entwurf.
    expect(stepToActions(wennSchritt({ ifConditions: [] }))).toEqual([]);
    expect(stepToActions(wennSchritt({ ifThen: [] }))).toEqual([]);
  });

  it('kommt aus der gespeicherten Form unversehrt zurück', () => {
    const gespeichert = [
      {
        type: 'if',
        conditions: [
          { type: 'state', entity_id: 'hm.lux', below: 20 },
          // Ein Zeitfenster kann der Editor nicht als Zeile zeigen -
          // es muss den Weg über ifExtra überleben.
          { type: 'time', after: '22:00' },
        ],
        match: 'any',
        then: [{ type: 'command', entity_id: 'hue.flur', command: 'turn_on' }],
      },
    ];
    const schritte = actionsToSteps(gespeichert);
    expect(schritte[0].kind).toBe('if');
    expect(schritte[0].ifMatch).toBe('any');
    expect(schritte[0].ifConditions).toEqual([
      { entity_id: 'hm.lux', op: 'below', value: '20' },
    ]);
    expect(schritte[0].ifExtra).toEqual([{ type: 'time', after: '22:00' }]);
    // Und wieder zurück - samt der Bedingung aus der Konfiguration.
    expect(stepToActions(schritte[0])).toEqual([
      {
        type: 'if',
        conditions: [
          { type: 'state', entity_id: 'hm.lux', below: 20 },
          { type: 'time', after: '22:00' },
        ],
        match: 'any',
        then: [{ type: 'command', entity_id: 'hue.flur', command: 'turn_on' }],
      },
    ]);
  });

  it('speichert wiederholen mit Anzahl und deckelt bei 50', () => {
    const schritt: StepDraft = {
      ...EMPTY_STEP,
      kind: 'repeat',
      repeatCount: '200',
      repeatSteps: [
        {
          ...EMPTY_STEP,
          kind: 'command',
          commandActions: [{ entity_id: 'hue.flur', command: 'toggle' }],
        },
      ],
    };
    expect(stepToActions(schritt)).toEqual([
      {
        type: 'repeat',
        count: 50,
        actions: [{ type: 'command', entity_id: 'hue.flur', command: 'toggle' }],
      },
    ]);
  });

  it('speichert wiederholen mit solange-Bedingung und max', () => {
    const schritt: StepDraft = {
      ...EMPTY_STEP,
      kind: 'repeat',
      repeatArt: 'while',
      repeatWhile: [{ entity_id: 'hm.fenster', op: 'is', value: 'on' }],
      repeatMax: '10',
      repeatSteps: [
        { ...EMPTY_STEP, kind: 'broadcast', broadcastText: 'Fenster offen' },
      ],
    };
    expect(stepToActions(schritt)).toEqual([
      {
        type: 'repeat',
        while: [{ type: 'state', entity_id: 'hm.fenster', equals: 'on' }],
        actions: [{ type: 'broadcast', text: 'Fenster offen' }],
        max: 10,
      },
    ]);
    // Und zurück in den Entwurf.
    const [zurueck] = actionsToSteps(stepToActions(schritt));
    expect(zurueck.repeatArt).toBe('while');
    expect(zurueck.repeatMax).toBe('10');
    expect(zurueck.repeatSteps[0].broadcastText).toBe('Fenster offen');
  });

  it('sagt am Schritt, was ihm fehlt', () => {
    const draft: Draft = {
      ...EMPTY,
      triggers: [{ ...EMPTY_TRIGGER, kind: 'time', at: '07:00' }],
      steps: [wennSchritt({ ifConditions: [], ifExtra: [] })],
    };
    expect(wasFehlt(draft).join(' ')).toContain('eine Bedingung anlegen');
    const solange: Draft = {
      ...draft,
      steps: [
        {
          ...EMPTY_STEP,
          kind: 'repeat',
          repeatArt: 'while',
          repeatSteps: [
            {
              ...EMPTY_STEP,
              kind: 'command',
              commandActions: [{ entity_id: 'hue.flur', command: 'turn_on' }],
            },
          ],
        },
      ],
    };
    expect(wasFehlt(solange).join(' ')).toContain('Solange-Bedingung');
  });

  it('sieht Nachricht und Wartezeit auch in den Zweigen', () => {
    // Die Nachtruhe-Frage muss die Nachricht im sonst-Zweig sehen -
    // ein flaches some griffe zu kurz.
    const steps = [
      wennSchritt({
        ifElse: [{ ...EMPTY_STEP, kind: 'notify', title: 'x', body: 'y' }],
      }),
    ];
    expect(meldetEtwas(steps)).toBe(true);
    const wiederholt = [
      {
        ...EMPTY_STEP,
        kind: 'repeat' as const,
        repeatSteps: [{ ...EMPTY_STEP, kind: 'delay' as const }],
      },
    ];
    expect(hatWartezeit(wiederholt)).toBe(true);
  });

  it('kopiert einen wenn-Schritt tief, nicht geteilt', () => {
    const original = wennSchritt({});
    const kopie = kopieSchritt(original);
    kopie.ifThen[0].commandActions[0].entity_id = 'hue.kueche';
    expect(original.ifThen[0].commandActions[0].entity_id).toBe('hue.flur');
  });

  it('beschreibt die neuen Schritte in der Listenzeile', () => {
    const zeile = zeileFuer(
      {
        id: 'a1',
        alias: 'Test',
        triggers: [{ type: 'time', at: '07:00' }],
        conditions: [],
        actions: [
          {
            type: 'if',
            conditions: [{ type: 'sun', state: 'down' }],
            then: [{ type: 'command', entity_id: 'x', command: 'turn_on' }],
            else: [{ type: 'notify' }],
          },
        ],
        editable: true,
      },
      []
    );
    expect(zeile).toContain('verzweigt (1 dann / 1 sonst)');
  });
});

describe('Die neuen Auslöser im Entwurf (Punkt 252)', () => {
  it('speichert Person, Richtung und Zone', () => {
    expect(
      triggerToConfig({
        ...EMPTY_TRIGGER,
        kind: 'presence',
        presencePerson: 'livia',
        presenceEvent: 'leaves',
        ortId: 'schule',
      })
    ).toEqual({ type: 'presence', person: 'livia', event: 'leaves', zone: 'schule' });
    // Das Zuhause ist die Vorgabe des Hubs und bleibt weg.
    expect(
      triggerToConfig({
        ...EMPTY_TRIGGER,
        kind: 'presence',
        presencePerson: 'livia',
        presenceEvent: 'arrives',
      })
    ).toEqual({ type: 'presence', person: 'livia', event: 'arrives' });
  });

  it('liest einen gespeicherten presence-Auslöser zurück', () => {
    const entwurf = triggerFromConfig({
      type: 'presence',
      person: 'livia',
      event: 'leave',
      zone: 'schule',
    });
    expect(entwurf.kind).toBe('presence');
    expect(entwurf.presencePerson).toBe('livia');
    expect(entwurf.presenceEvent).toBe('leaves');
    expect(entwurf.ortId).toBe('schule');
  });

  it('speichert die Wetterwarnung ohne die Vorgaben des Hubs', () => {
    expect(
      triggerToConfig({ ...EMPTY_TRIGGER, kind: 'weather_warning', entityId: '' })
    ).toEqual({ type: 'weather_warning' });
    expect(
      triggerToConfig({
        ...EMPTY_TRIGGER,
        kind: 'weather_warning',
        minSeverity: 'Severe',
        entityId: 'meteoalarm.switzerland',
      })
    ).toEqual({
      type: 'weather_warning',
      min_severity: 'Severe',
      entity_id: 'meteoalarm.switzerland',
    });
  });

  it('liest eine gespeicherte Wetterwarnung zurück', () => {
    const entwurf = triggerFromConfig({
      type: 'weather_warning',
      min_severity: 'Moderate',
    });
    expect(entwurf.kind).toBe('weather_warning');
    expect(entwurf.minSeverity).toBe('Moderate');
  });

  it('verlangt beim presence-Auslöser eine Person', () => {
    const draft: Draft = {
      ...EMPTY,
      triggers: [{ ...EMPTY_TRIGGER, kind: 'presence' }],
      steps: [
        {
          ...EMPTY_STEP,
          kind: 'command',
          commandActions: [{ entity_id: 'hue.flur', command: 'turn_on' }],
        },
      ],
    };
    expect(wasFehlt(draft)).toEqual(['Wenn: eine Person wählen']);
  });

  it('zeigt die neuen Auslöser als Satz in der Listenzeile', () => {
    const zeile = zeileFuer(
      {
        id: 'a1',
        alias: 'x',
        triggers: [{ type: 'presence', person: 'livia', event: 'arrives' }],
        conditions: [],
        actions: [{ type: 'notify' }],
        editable: true,
      },
      []
    );
    expect(zeile).toContain('wenn Livia kommt heim');
    const warnung = zeileFuer(
      {
        id: 'a2',
        alias: 'x',
        triggers: [{ type: 'weather_warning', min_severity: 'Severe' }],
        conditions: [],
        actions: [{ type: 'notify' }],
        editable: true,
      },
      []
    );
    expect(warnung).toContain('wenn eine neue Wetterwarnung eintrifft (ab «schwer»)');
  });

  it('gibt den neuen Auslösern eigene Symbole', () => {
    expect(
      triggerIcon({
        id: 'a',
        alias: '',
        triggers: [{ type: 'presence', person: 'livia', event: 'arrives' }],
        conditions: [],
        actions: [],
        editable: true,
      })
    ).toBe('person-outline');
    expect(
      triggerIcon({
        id: 'a',
        alias: '',
        triggers: [{ type: 'weather_warning' }],
        conditions: [],
        actions: [],
        editable: true,
      })
    ).toBe('thunderstorm-outline');
  });
});

describe('Platzhalter aus der Geräteauswahl (Punkt 251)', () => {
  it('bietet Zustand und nur echte Messwerte an', () => {
    const sensor = {
      id: 'hm.melder',
      name: 'Melder Flur',
      kind: 'binary_sensor',
      state: { state: 'off', illumination: 12, battery: 80 },
      commands: [],
    } as unknown as Entity;
    expect(geraetePlatzhalter(sensor)).toEqual([
      { key: '{hm.melder}', label: 'Zustand' },
      { key: '{hm.melder.illumination}', label: 'Helligkeit (Lux)' },
      { key: '{hm.melder.battery}', label: 'Batterie (%)' },
    ]);
  });

  it('bleibt ohne Gerät leer', () => {
    expect(geraetePlatzhalter(undefined)).toEqual([]);
  });
});


describe('schaltetSpaeterAus', () => {
  const licht = (kind: string, extra: Record<string, unknown> = {}) => ({
    ...EMPTY_STEP,
    kind,
    ...extra,
  });

  it('sieht die Wartezeit mit einem «ausschalten» dahinter', () => {
    const steps = [
      licht('command', {
        commandActions: [{ entity_id: 'hue.a', command: 'turn_on' }],
      }),
      licht('delay', { delaySeconds: '1800' }),
      licht('command', {
        commandActions: [{ entity_id: 'hue.a', command: 'turn_off' }],
      }),
    ];
    expect(schaltetSpaeterAus(steps)).toBe(true);
  });

  it('sieht auch den Nachlauf am Licht-Schritt selbst', () => {
    const steps = [
      licht('command', {
        commandActions: [{ entity_id: 'hue.a', command: 'turn_on', offAfter: 240 }],
      }),
    ];
    expect(schaltetSpaeterAus(steps)).toBe(true);
  });

  it('schweigt, wenn nichts von selbst wieder ausgeht', () => {
    // Warten allein genügt nicht: Ohne «ausschalten» dahinter gibt es
    // keine Frist, die man anzeigen könnte.
    const steps = [
      licht('delay', { delaySeconds: '600' }),
      licht('notify', { title: 'Fertig', body: '' }),
    ];
    expect(schaltetSpaeterAus(steps)).toBe(false);
    expect(schaltetSpaeterAus([])).toBe(false);
  });
});

describe('Auslöser «Nach Stromausfall»', () => {
  it('braucht weder Gerät noch Uhrzeit', () => {
    // Er hat genau einen Fall: Der Hub ist nach einem Stromausfall
    // hochgefahren. Ein Gerätefeld daran wäre ein leeres Versprechen.
    const config = triggerToConfig({ ...EMPTY_TRIGGER, kind: 'power_restore' });
    expect(config).toEqual({ type: 'power_restore' });
  });

  it('nimmt die Wartezeit mit, wenn eine gewählt wurde', () => {
    // Wie lange es dauert, bis Switch, Accesspoint und Bridge stehen,
    // ist von Haus zu Haus verschieden - deshalb steht die Zahl im
    // Ablauf und nicht im Hub.
    const config = triggerToConfig({
      ...EMPTY_TRIGGER,
      kind: 'power_restore',
      restoreDelay: '120',
    });
    expect(config.delay).toBe(120);
  });

  it('liest sich unverändert zurück', () => {
    const gespeichert = triggerToConfig({
      ...EMPTY_TRIGGER,
      kind: 'power_restore',
      restoreDelay: '300',
    });
    const zurueck = triggerFromConfig(gespeichert);
    expect(zurueck.kind).toBe('power_restore');
    expect(zurueck.restoreDelay).toBe('300');
    expect(triggerToConfig(zurueck)).toEqual(gespeichert);
  });
});

describe('Helligkeit nach der Uhr', () => {
  const licht = (over = {}) => ({
    ...EMPTY_STEP,
    kind: 'command' as const,
    commandActions: [
      { entity_id: 'hue.flur', command: 'set_brightness', brightness: 50, ...over },
    ],
  });

  it('schreibt «tageszeit» statt einer Zahl', () => {
    // Der Weg für die Räume ohne Helligkeitsfühler - also für die
    // meisten (hub/core/light.py, brightness_from_time).
    const [action] = stepToActions(licht({ nachTageszeit: true }));
    expect(action.type).toBe('light');
    expect(action.brightness).toBe('tageszeit');
  });

  it('liest ihn auch wieder ein', () => {
    const [schritt] = actionsToSteps([
      { type: 'light', entity_id: 'hue.stube', brightness: 'tageszeit' },
    ]);
    expect(schritt.commandActions[0]).toMatchObject({
      command: 'set_brightness',
      nachTageszeit: true,
    });
    expect(schritt.commandActions[0].adaptive).toBeUndefined();
  });

  it('zählt als Licht-Feinheit', () => {
    // Sonst würde daraus beim Speichern ein blosses «einschalten».
    expect(istLichtFein({ command: 'set_brightness', nachTageszeit: true })).toBe(true);
  });
});

describe('stundeAusText (Punkt 379)', () => {
  it('liest 0-23, sonst null', () => {
    expect(stundeAusText('5')).toBe(5);
    expect(stundeAusText('05')).toBe(5);
    expect(stundeAusText('0')).toBe(0);
    expect(stundeAusText('23')).toBe(23);
    expect(stundeAusText('24')).toBeNull();
    expect(stundeAusText('')).toBeNull();
    expect(stundeAusText('  ')).toBeNull();
    expect(stundeAusText('abends')).toBeNull();
    expect(stundeAusText('-1')).toBeNull();
  });
});

describe('Zeitraum-Auslöser', () => {
  it('speichert von/bis als window und liest beides zurück', () => {
    const config = triggerToConfig({ ...EMPTY_TRIGGER, kind: 'window', at: '07:00', until: '09:00' });
    expect(config).toEqual({ type: 'window', after: '07:00', before: '09:00' });
    const zurueck = triggerFromConfig(config);
    expect(zurueck.kind).toBe('window');
    expect(zurueck.at).toBe('07:00');
    expect(zurueck.until).toBe('09:00');
  });
});

describe('Schritt «Ablauf starten»', () => {
  it('überlebt Öffnen und Speichern', () => {
    // Der Hub konnte den Schritt längst - der Editor warf ihn beim
    // Öffnen still weg, und «Speichern» löschte ihn damit.
    const steps = actionsToSteps([{ type: 'automation', automation_id: 'alles_aus' }]);
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('automation');
    expect(stepToActions(steps[0])).toEqual([{ type: 'automation', automation_id: 'alles_aus' }]);
  });

  it('ergibt ohne gewählten Ablauf keine Aktion', () => {
    expect(stepToActions({ ...EMPTY_STEP, kind: 'automation' })).toEqual([]);
  });
});

describe('Kontext-Bedingungen', () => {
  it('baut Person, Erreichbarkeit, Warnung und Termin', () => {
    expect(
      kontextConditionToConfig({ art: 'presence', ziel: 'Livia', wert: 'home', nicht: false })
    ).toEqual({ type: 'presence', person: 'Livia' });
    expect(
      kontextConditionToConfig({ art: 'presence', ziel: 'Livia', wert: 'schule', nicht: true })
    ).toEqual({ type: 'presence', person: 'Livia', zone: 'schule', state: 'absent' });
    expect(
      kontextConditionToConfig({ art: 'availability', ziel: 'x.y', wert: '', nicht: true })
    ).toEqual({ type: 'availability', entity_id: 'x.y', available: false });
    expect(
      kontextConditionToConfig({ art: 'weather_warning', ziel: '', wert: 'Severe', nicht: false })
    ).toEqual({ type: 'weather_warning', min_severity: 'Severe' });
    expect(
      kontextConditionToConfig({ art: 'calendar', ziel: '', wert: ' Homeoffice ', nicht: true })
    ).toEqual({ type: 'calendar', contains: 'Homeoffice', active: false });
  });

  it('kommt beim Öffnen unverändert zurück', () => {
    for (const entry of [
      { art: 'presence' as const, ziel: 'Livia', wert: 'home', nicht: false },
      { art: 'availability' as const, ziel: 'x.y', wert: '', nicht: true },
      { art: 'weather_warning' as const, ziel: 'm.ch', wert: 'Severe', nicht: false },
      { art: 'calendar' as const, ziel: '', wert: 'Ferien', nicht: true },
    ]) {
      expect(kontextConditionFromConfig(kontextConditionToConfig(entry))).toEqual(entry);
    }
  });

  it('steht im Entwurf statt in den unbekannten Bedingungen', () => {
    const draft = toDraft({
      id: 'a',
      alias: 'A',
      triggers: [],
      conditions: [{ type: 'presence', person: 'Livia' }],
      actions: [],
    } as never);
    expect(draft.kontextConditions).toEqual([
      { art: 'presence', ziel: 'Livia', wert: 'home', nicht: false },
    ]);
    expect(draft.extraConditions).toEqual([]);
    expect(buildConditions(draft)).toEqual([{ type: 'presence', person: 'Livia' }]);
  });

  it('lässt eine Person ohne Namen weg', () => {
    expect(
      buildConditions({
        ...EMPTY,
        kontextConditions: [{ art: 'presence', ziel: '', wert: 'home', nicht: false }],
      })
    ).toEqual([]);
  });
});
