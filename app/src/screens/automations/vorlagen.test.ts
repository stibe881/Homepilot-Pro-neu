/**
 * Eingebaute und eigene Vorlagen in einer Liste.
 *
 * Der Fall dahinter: Die Vorlagen kamen ausschliesslich aus dem
 * Gerätebestand - dazutun oder wegnehmen konnte man nichts. Wer eine
 * bearbeitet, will danach seine sehen und nicht beide.
 */
import { EMPTY } from './entwurf';
import { EigeneVorlage, Template, buildTemplates, mischeVorlagen } from './vorlagen';
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

  it('fährt bei einer Wetterwarnung nur Lamellenstoren - und sagt es', () => {
    const vorlage = buildTemplates(
      [store('c.kind', 'Kinderzimmer'), store('c.balkon', 'Balkon', true), warnung],
      []
    ).find((eintrag) => eintrag.label.startsWith('Wetterwarnung'));
    expect(vorlage?.draft.steps?.[0].commandActions).toEqual([
      expect.objectContaining({ entity_id: 'c.balkon', command: 'open' }),
    ]);
    expect(vorlage?.draft.steps?.[1].kind).toBe('notify');
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

