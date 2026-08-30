/**
 * Eingebaute und eigene Vorlagen in einer Liste.
 *
 * Der Fall dahinter: Die Vorlagen kamen ausschliesslich aus dem
 * Gerätebestand - dazutun oder wegnehmen konnte man nichts. Wer eine
 * bearbeitet, will danach seine sehen und nicht beide.
 */
import { EMPTY } from './entwurf';
import {
  EigeneVorlage,
  Template,
  buildTemplates,
  gruppiereVorlagen,
  mischeVorlagen,
  vorlagenGruppe,
} from './vorlagen';
import { Entity } from '../../api/types';

const eingebaut = (label: string): Template => ({
  label,
  icon: 'flash-outline',
  draft: { ...EMPTY, alias: label },
});

const eigen = (label: string, id = 'vorlage_1'): EigeneVorlage => ({
  id,
  label,
  icon: 'bulb-outline',
  draft: { alias: label },
});

describe('mischeVorlagen', () => {
  it('stellt die eigenen nach vorn', () => {
    const liste = mischeVorlagen([eingebaut('Morgens saugen')], [eigen('Reduit')], []);
    expect(liste.map((zeile) => zeile.label)).toEqual(['Reduit', 'Morgens saugen']);
    expect(liste[0].eigen).toBe(true);
    expect(liste[1].eigen).toBe(false);
  });

  it('lässt Ausgeblendete weg', () => {
    const liste = mischeVorlagen(
      [eingebaut('Morgens saugen'), eingebaut('Storen zu')],
      [],
      ['Morgens saugen']
    );
    expect(liste.map((zeile) => zeile.label)).toEqual(['Storen zu']);
  });

  it('verdrängt die eingebaute, wenn eine eigene so heisst', () => {
    // Genau der Grund, aus dem jemand eine bearbeitet hat: Zwei fast
    // gleiche nebeneinander wären die schlechtere Antwort.
    const liste = mischeVorlagen(
      [eingebaut('Morgens saugen')],
      [eigen('morgens saugen')],
      []
    );
    expect(liste).toHaveLength(1);
    expect(liste[0].eigen).toBe(true);
  });

  it('gibt jeder Zeile einen eindeutigen Schlüssel', () => {
    const liste = mischeVorlagen(
      [eingebaut('A'), eingebaut('B')],
      [eigen('C', 'x'), eigen('D', 'y')],
      []
    );
    expect(new Set(liste.map((zeile) => zeile.key)).size).toBe(4);
  });

  it('verträgt leere Listen', () => {
    expect(mischeVorlagen([], [], [])).toEqual([]);
  });
});


// ── Der Erste kommt, der Letzte geht ─────────────────────────────────────
//
// Zwei Abläufe, nach denen jeder Haushalt fragt. Es gab sie nur
// zusammen mit einer Aktion - Alarm scharf, alles aus. Wer etwas
// anderes vorhatte, musste den Auslöser selbst finden und dabei raten,
// ob «jemand zuhause» nun «an» oder «aus» heisst.

const SAMMEL = {
  id: 'geofence.anyone_home',
  kind: 'binary_sensor',
  name: 'Jemand zuhause',
  integration: 'geofence',
  state: { state: 'on', device_class: 'presence', away: [] },
  commands: [],
  available: true,
} as unknown as Entity;

describe('Anwesenheits-Vorlagen', () => {
  it('bietet beide Anfänge an, auch ohne Alarm und ohne Licht', () => {
    const vorlagen = buildTemplates([SAMMEL], []);
    const labels = vorlagen.map((vorlage) => vorlage.label);
    expect(labels).toContain('Der Erste kommt heim');
    expect(labels).toContain('Der Letzte geht');
  });

  it('trifft beim Heimkommen den richtigen Zustand', () => {
    const vorlage = buildTemplates([SAMMEL], []).find(
      (eintrag) => eintrag.label === 'Der Erste kommt heim'
    );
    expect(vorlage?.draft.triggers).toEqual([
      expect.objectContaining({ entityId: 'geofence.anyone_home', toState: 'on' }),
    ]);
    // Ein leerer Schritt, mehr nicht: Der Auslöser ist das Schwierige,
    // die Aktion weiss nur der Haushalt selbst. Der Editor öffnet sich
    // also mit fertigem Auslöser und einer leeren Zeile zum Ausfüllen.
    expect(vorlage?.draft.steps).toHaveLength(1);
    expect(vorlage?.draft.steps?.[0].commandActions ?? []).toHaveLength(0);
    expect(vorlage?.draft.steps?.[0].sceneId ?? '').toBe('');
  });

  it('lässt dem Letzten zehn Minuten Zeit', () => {
    // Der Gang zum Briefkasten ist kein Auszug, und ein Telefon, das
    // kurz den Funk verliert, auch nicht.
    const vorlage = buildTemplates([SAMMEL], []).find(
      (eintrag) => eintrag.label === 'Der Letzte geht'
    );
    expect(vorlage?.draft.triggers).toEqual([
      expect.objectContaining({ toState: 'off', forMinutes: '10' }),
    ]);
  });

  it('bietet sie nicht an, wo es keine Anwesenheit gibt', () => {
    expect(buildTemplates([], [])).toEqual([]);
  });
});


// ── Sturmwarnung ─────────────────────────────────────────────────────────
//
// Die Vorlage hiess lange «Sturmschutz: Storen zu bei Warnung» und tat
// damit das Gegenteil dessen, was auf ihr stand: Eine geschlossene
// Aussenstore ist eine Fläche, in die der Wind greift.

const WARNER = {
  id: 'meteoalarm.switzerland',
  kind: 'alert',
  name: 'MeteoAlarm Schweiz',
  integration: 'meteoalarm',
  state: { state: 'ok', wind: 'off', headline: '' },
  commands: [],
  available: true,
} as unknown as Entity;

const STORE = {
  id: 'homematic.store_wohnzimmer',
  kind: 'cover',
  name: 'Store Wohnzimmer',
  integration: 'homematic',
  state: { state: 'open', position: 100 },
  commands: ['open', 'close', 'stop'],
  available: true,
} as unknown as Entity;

describe('Sturmwarnung', () => {
  const vorlage = () =>
    buildTemplates([WARNER, STORE], []).find(
      (eintrag) => eintrag.label === 'Sturmwarnung: Storen hoch'
    );

  it('fährt die Storen hoch statt zu', () => {
    expect(vorlage()?.draft.steps?.[0].commandActions).toEqual([
      { entity_id: 'homematic.store_wohnzimmer', command: 'open' },
    ]);
  });

  it('greift nur bei Wind, nicht bei jeder Warnung', () => {
    // Bei Hitze, Regen oder Glatteis ändert sich an den Storen nichts.
    expect(vorlage()?.draft.stateConditions).toEqual([
      {
        entity_id: 'meteoalarm.switzerland',
        op: 'is',
        value: 'on',
        attribute: 'wind',
      },
    ]);
  });

  it('meldet, wovor gewarnt wird - nicht bloss dass gewarnt wird', () => {
    const notify = vorlage()?.draft.steps?.[1];
    expect(notify?.kind).toBe('notify');
    // Der Warntext kommt vom Gerät. Abgeschrieben stünde in der
    // Nachricht für immer die Warnung von damals.
    expect(notify?.body).toContain('{meldung}');
  });

  it('bleibt weg, wo es keine Storen gibt', () => {
    expect(
      buildTemplates([WARNER], []).map((eintrag) => eintrag.label)
    ).not.toContain('Sturmwarnung: Storen hoch');
  });
});


// ── Wäsche und Klingel ───────────────────────────────────────────────────
//
// Zwei Abläufe, die dieselbe Einsicht teilen: Eine Meldung zur falschen
// Zeit ist eine, die man wegwischt.

const BOX = {
  id: 'cast.wohnzimmer',
  kind: 'media_player',
  name: 'Box Wohnzimmer',
  integration: 'google_cast',
  state: { state: 'idle' },
  commands: ['play_url', 'play', 'pause'],
  room: 'Wohnzimmer',
  available: true,
} as unknown as Entity;

const WASCHMASCHINE = {
  id: 'vzug.waschmaschine',
  kind: 'appliance',
  name: 'Waschmaschine',
  integration: 'vzug',
  state: { state: 'idle' },
  commands: [],
  room: 'Waschküche',
  available: true,
} as unknown as Entity;

const KLINGEL = {
  id: 'ring.haustuere',
  kind: 'camera',
  name: 'Haustüre',
  integration: 'ring',
  state: { state: 'on', ring: 'off' },
  commands: [],
  available: true,
} as unknown as Entity;

const FERNSEHER = {
  id: 'androidtv.wohnzimmer',
  kind: 'media_player',
  name: 'Fernseher',
  integration: 'androidtv',
  state: { state: 'playing' },
  commands: ['turn_on', 'turn_off', 'play', 'pause'],
  room: 'Wohnzimmer',
  available: true,
} as unknown as Entity;

const LAMPE = {
  id: 'hue.stehlampe',
  kind: 'light',
  name: 'Stehlampe',
  integration: 'hue',
  state: { state: 'off' },
  commands: ['turn_on', 'turn_off', 'set_brightness'],
  room: 'Wohnzimmer',
  available: true,
} as unknown as Entity;

describe('Wäsche meldet sich erst beim Heimkommen', () => {
  const vorlage = () =>
    buildTemplates([SAMMEL, WASCHMASCHINE, BOX], []).find(
      (eintrag) => eintrag.label === 'Wäsche meldet sich erst beim Heimkommen'
    );

  it('verschiebt die Meldung nur, wenn niemand da ist', () => {
    expect(vorlage()?.draft.stateConditions).toEqual([
      { entity_id: 'geofence.anyone_home', op: 'is', value: 'off' },
    ]);
  });

  it('wartet auf die Heimkehr und sagt es dann laut', () => {
    const [warten, durchsage] = vorlage()?.draft.steps ?? [];
    expect(warten.kind).toBe('wait_until');
    expect(warten.waitEntityId).toBe('geofence.anyone_home');
    expect(warten.waitValue).toBe('on');
    // Ein Arbeitstag, nicht die fünf Minuten der Vorgabe: Sonst wäre
    // der Ablauf abgelaufen, bevor überhaupt jemand losgefahren ist.
    expect(Number(warten.waitTimeout)).toBeGreaterThan(3600);
    expect(durchsage.kind).toBe('broadcast');
  });

  it('bleibt weg, wo keine Box sprechen kann', () => {
    const ohneBox = buildTemplates([SAMMEL, WASCHMASCHINE], []).map(
      (eintrag) => eintrag.label
    );
    expect(ohneBox).not.toContain('Wäsche meldet sich erst beim Heimkommen');
  });
});

describe('Es klingelt mitten im Film', () => {
  const vorlage = () =>
    buildTemplates([KLINGEL, FERNSEHER, LAMPE], []).find(
      (eintrag) => eintrag.label === 'Es klingelt mitten im Film'
    );

  it('greift nur, solange wirklich etwas läuft', () => {
    // Sonst ginge nachmittags das Licht an, bloss weil der Fernseher
    // im Bereitschaftsbetrieb steht.
    expect(vorlage()?.draft.stateConditions).toEqual([
      { entity_id: 'androidtv.wohnzimmer', op: 'is', value: 'playing' },
    ]);
  });

  it('hält das Bild an und macht das Licht halb', () => {
    const [anhalten, licht] = vorlage()?.draft.steps ?? [];
    expect(anhalten.commandActions).toEqual([
      { entity_id: 'androidtv.wohnzimmer', command: 'pause' },
    ]);
    expect(licht.commandActions).toEqual([
      { entity_id: 'hue.stehlampe', command: 'set_brightness', brightness: 50 },
    ]);
  });

  it('nimmt das Licht aus dem Zimmer des Fernsehers', () => {
    const kueche = { ...LAMPE, id: 'hue.kueche', room: 'Küche' } as unknown as Entity;
    const licht = buildTemplates([KLINGEL, FERNSEHER, kueche, LAMPE], []).find(
      (eintrag) => eintrag.label === 'Es klingelt mitten im Film'
    )?.draft.steps?.[1];
    expect(licht?.commandActions?.map((aktion) => aktion.entity_id)).toEqual([
      'hue.stehlampe',
    ]);
  });

  it('bleibt weg, wo es keine Klingel gibt', () => {
    expect(
      buildTemplates([FERNSEHER, LAMPE], []).map((eintrag) => eintrag.label)
    ).not.toContain('Es klingelt mitten im Film');
  });
});
describe('die Storen- und Wächter-Vorlagen (August 2026)', () => {
  const geraet = (teil: Partial<Entity>): Entity =>
    ({
      id: 'x',
      name: 'x',
      kind: 'switch',
      room: null,
      integration: 'demo',
      commands: [],
      state: {},
      ...teil,
    }) as Entity;

  const store = (id: string, name: string, tilt = false) =>
    geraet({
      id,
      name,
      kind: 'cover',
      commands: tilt ? ['open', 'close', 'set_tilt'] : ['open', 'close'],
    });
  const wetter = geraet({ id: 'weather.haus', name: 'Wetter', kind: 'weather', state: { temperature: 21 } });
  const warnung = geraet({ id: 'alert.haus', name: 'Warnungen', kind: 'alert', state: { count: 0 } });

  it('trennt beim Hitzeschutz Balkon und Terrasse von den übrigen', () => {
    const vorlage = buildTemplates(
      [store('c.kind', 'Kinderzimmer'), store('c.balkon', 'Balkon', true), wetter],
      []
    ).find((eintrag) => eintrag.label.startsWith('Hitzeschutz'));
    const aktionen = vorlage?.draft.steps?.[0].commandActions ?? [];
    expect(aktionen).toEqual([
      expect.objectContaining({ entity_id: 'c.kind', command: 'close' }),
      expect.objectContaining({ entity_id: 'c.balkon', command: 'set_tilt', tilt: 50 }),
    ]);
  });

  it('fährt bei einer Wetterwarnung alle Storen hoch - und sagt es', () => {
    // Hier standen einmal zwei fast gleiche Vorlagen nebeneinander, aus
    // zwei Zweigen: «Wetterwarnung: Lamellen in Schutzstellung» und
    // «Sturmwarnung: Storen hoch». Geblieben ist eine - und sie nimmt
    // alle Storen mit, nicht nur die mit Lamellen: Auch eine Rollstore
    // ist draussen eine Fläche im Wind.
    const vorlage = buildTemplates(
      [store('c.kind', 'Kinderzimmer'), store('c.balkon', 'Balkon', true), warnung],
      []
    ).find((eintrag) => eintrag.label.startsWith('Sturmwarnung'));
    expect(vorlage?.draft.steps?.[0].commandActions).toEqual([
      expect.objectContaining({ entity_id: 'c.kind', command: 'open' }),
      expect.objectContaining({ entity_id: 'c.balkon', command: 'open' }),
    ]);
    expect(vorlage?.draft.steps?.[1].kind).toBe('notify');
    // Und der Auslöser stammt aus der abgelösten Fassung: über die
    // Anzahl, damit eine zweite Warnung während einer laufenden nicht
    // stillschweigend durchfällt.
    expect(vorlage?.draft.triggers?.[0]).toEqual(
      expect.objectContaining({ attribute: 'count', thresholdOp: 'above' })
    );
    expect(vorlage?.draft.cooldownMinutes).toBe('360');
  });

  it('nimmt für die Heimkommen-Nachricht die Kinder-Zone', () => {
    const vorlage = buildTemplates(
      [
        geraet({ id: 'geofence.stefan', name: 'Stefan', kind: 'binary_sensor' }),
        geraet({ id: 'geofence.levin', name: 'Levin', kind: 'binary_sensor' }),
      ],
      []
    ).find((eintrag) => eintrag.label === 'Nachricht, wenn ein Kind heimkommt');
    expect(vorlage?.draft.triggers?.[0]).toEqual(
      expect.objectContaining({ kind: 'geofence', entityId: 'geofence.levin' })
    );
  });

  it('schaltet das Kameralicht nur nachts und mit Nachlauf', () => {
    const vorlage = buildTemplates(
      [
        geraet({ id: 'cam.grill', name: 'Grillplatz', kind: 'camera', integration: 'unifi_protect' }),
        geraet({ id: 'licht.garten', name: 'Gartenlicht', kind: 'light', commands: ['turn_on', 'turn_off'] }),
      ],
      []
    ).find((eintrag) => eintrag.label === 'Kameralicht bei Person in der Nacht');
    expect(vorlage?.draft.conditionAfter).toBe('22:00');
    expect(vorlage?.draft.steps?.[0].commandActions?.[0]).toEqual(
      expect.objectContaining({ entity_id: 'licht.garten', offAfter: 180 })
    );
  });

  it('bietet die Sonnen-Storen nur an, wo es Storen gibt', () => {
    const mit = buildTemplates([store('c.kind', 'Kinderzimmer')], []).map((v) => v.label);
    expect(mit).toContain('Storen mit der Sonne auf');
    expect(mit).toContain('Storen mit der Sonne zu');
    const ohne = buildTemplates([wetter], []).map((v) => v.label);
    expect(ohne).not.toContain('Storen mit der Sonne auf');
  });
});

describe('vorlagenGruppe', () => {
  it('ordnet am Namen zu - die Reihenfolge der Regeln zählt', () => {
    expect(vorlagenGruppe('Klingel-Ansage auf den Boxen')).toBe('Klingel & Kameras');
    expect(vorlagenGruppe('Kameralicht bei Person in der Nacht')).toBe('Klingel & Kameras');
    expect(vorlagenGruppe('Hitzeschutz: Storen bei Sommerhitze')).toBe('Storen & Wetter');
    // «Heimkommen» im Namen, aber ein Haushaltsthema.
    expect(vorlagenGruppe('Wäsche meldet sich erst beim Heimkommen')).toBe('Haushalt');
    expect(vorlagenGruppe('Scharf, wenn der Letzte geht')).toBe('Sicherheit');
    expect(vorlagenGruppe('Licht bei Bewegung, mit Nachlauf')).toBe('Licht');
    expect(vorlagenGruppe('Der Letzte geht')).toBe('Kommen & Gehen');
    expect(vorlagenGruppe('Irgendwas Neues')).toBe('Weitere');
  });
});

describe('gruppiereVorlagen', () => {
  it('stellt Eigene zuerst und hält die feste Reihenfolge', () => {
    const zeilen = mischeVorlagen(
      [eingebaut('Der Letzte geht'), eingebaut('Morgens saugen')],
      [eigen('Reduit')],
      []
    );
    const gruppen = gruppiereVorlagen(zeilen);
    expect(gruppen.map((gruppe) => gruppe.titel)).toEqual([
      'Eigene',
      'Kommen & Gehen',
      'Haushalt',
    ]);
    expect(gruppen[0].zeilen[0].label).toBe('Reduit');
  });
});

