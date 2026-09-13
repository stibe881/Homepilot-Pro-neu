/** Wo kommt ein Gerät überall vor – Abläufe und Szenen. */
import { Scene } from '../api/types';
import {
  belegungZeile,
  druckWort,
  mitschalter,
  mitschalterSatz,
  tasterBelegung,
  verweisText,
  verweiseAuf,
} from './verweise';

const automations = [
  {
    id: 'a1',
    alias: 'Flurlicht',
    triggers: [{ type: 'state', entity_id: 'hm.bewegung', to: 'on' }],
    actions: [{ type: 'command', entity_id: 'hue.flur', command: 'turn_on' }],
  },
  {
    id: 'a2',
    alias: 'Sonst-Zweig',
    triggers: [{ type: 'time', at: '18:00' }],
    otherwise: [{ type: 'command', entity_id: 'hue.flur', command: 'turn_off' }],
  },
];
const scenes = [{ id: 's1', name: 'Kino', entity_ids: ['hue.flur'] }] as Scene[];

const taster = [
  {
    id: 'a3',
    alias: 'Wandtaster Eingang',
    triggers: [{ type: 'state', entity_id: 'hm.taster', to: 'short' }],
    actions: [{ type: 'toggle_all', entity_ids: ['hue.eingang', 'hue.gang'] }],
  },
];

describe('verweiseAuf', () => {
  it('findet das Gerät in Auslösern, Aktionen und dem Sonst-Zweig', () => {
    const { ablaeufe, szenen } = verweiseAuf('hue.flur', automations, scenes);
    expect(ablaeufe.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(szenen.map((s) => s.id)).toEqual(['s1']);
  });

  it('verwechselt Auslöser nicht mit Aktionen', () => {
    const { ablaeufe, szenen } = verweiseAuf('hm.bewegung', automations, scenes);
    expect(ablaeufe.map((a) => a.id)).toEqual(['a1']);
    expect(szenen).toEqual([]);
  });
});

describe('verweisText', () => {
  it('beugt richtig', () => {
    expect(verweisText(1, 0)).toBe('in 1 Ablauf');
    expect(verweisText(2, 1)).toBe('in 2 Abläufen und 1 Szene');
    expect(verweisText(0, 2)).toBe('in 2 Szenen');
    expect(verweisText(0, 0)).toBe('');
  });
});

describe('Geräte in einer Liste', () => {
  it('findet die Lampe auch in «gemeinsam umschalten»', () => {
    // Sonst fehlte sie in «in 2 Abläufen», und man sucht den Urheber
    // wieder von Hand.
    const { ablaeufe } = verweiseAuf('hue.gang', taster, []);
    expect(ablaeufe.map((a) => a.id)).toEqual(['a3']);
  });

  it('nimmt keine fremde Lampe mit', () => {
    expect(verweiseAuf('hue.kueche', taster, []).ablaeufe).toEqual([]);
  });
});

describe('mitschalter', () => {
  const ablauf = (id: string, alias: string, entityId: string) =>
    ({
      id,
      alias,
      triggers: [],
      conditions: [],
      actions: [{ type: 'command', entity_id: entityId, command: 'turn_on' }],
      otherwise: [],
    }) as unknown as Parameters<typeof mitschalter>[1][number];

  const alle = [
    ablauf('a1', 'Bewegung Flur', 'light.flur'),
    ablauf('a2', 'Alle weg', 'light.flur'),
    ablauf('a3', 'Kaffee', 'switch.kaffee'),
  ];

  it('findet, wer dieselben Geräte anfasst', () => {
    // Der Hub meldet Widersprüche erst hinterher, als Liste. Da steht
    // der neue Ablauf längst und schaltet nachts gegen einen anderen an.
    expect(mitschalter(['light.flur'], alle).map((a) => a.alias)).toEqual([
      'Bewegung Flur',
      'Alle weg',
    ]);
  });

  it('meldet den eigenen Ablauf nicht', () => {
    // Ohne das meldete sich jeder gespeicherte Ablauf selbst.
    expect(mitschalter(['light.flur'], alle, 'a1').map((a) => a.alias)).toEqual([
      'Alle weg',
    ]);
  });

  it('zählt nur, wer wirklich schaltet', () => {
    // Ein Ablauf, der die Lampe bloss abfragt, schaltet sie nicht -
    // «schaltet auch» wäre über ihn eine falsche Aussage.
    const nurAusloeser = {
      id: 'a4',
      alias: 'Nur Auslöser',
      triggers: [{ type: 'state', entity_id: 'light.flur', to: 'on' }],
      conditions: [{ type: 'state', entity_id: 'light.flur', equals: 'on' }],
      actions: [{ type: 'notify' }],
      otherwise: [],
    } as unknown as Parameters<typeof mitschalter>[1][number];
    expect(mitschalter(['light.flur'], [nurAusloeser])).toEqual([]);
  });

  it('schweigt ohne Gerät und ohne Treffer', () => {
    expect(mitschalter([], alle)).toEqual([]);
    expect(mitschalter(['light.keller'], alle)).toEqual([]);
  });
});

describe('mitschalterSatz', () => {
  it('nennt die Namen und zählt den Rest', () => {
    expect(mitschalterSatz(['Bewegung Flur'])).toContain('«Bewegung Flur»');
    expect(mitschalterSatz(['a', 'b', 'c', 'd'])).toContain('«a», «b», «c» und 1 weitere');
  });

  it('schweigt, wenn niemand mitschaltet', () => {
    expect(mitschalterSatz([])).toBe('');
  });
});

describe('tasterBelegung', () => {
  // Punkt 629: Wer vor dem Wandtaster steht, soll auf der Kachel lesen,
  // was welcher Druck tut - ohne die Abläufe aufzumachen.
  const ablaeufe = [
    {
      id: 'b1',
      alias: 'Alles aus',
      triggers: [{ type: 'state', entity_id: 'z2m.taster', to: 'hold' }],
      actions: [],
    },
    {
      id: 'b2',
      alias: 'Flur an',
      triggers: [{ type: 'state', entity_id: 'z2m.taster', to: 'single' }],
      actions: [],
    },
    {
      id: 'b3',
      alias: 'Ruht',
      enabled: false,
      triggers: [{ type: 'state', entity_id: 'z2m.taster', to: 'double' }],
      actions: [],
    },
    {
      id: 'b4',
      alias: 'Anderer Taster',
      triggers: [{ type: 'state', entity_id: 'z2m.anderer', to: 'single' }],
      actions: [],
    },
  ];

  it('nennt je Druck den Ablauf, in der Reihenfolge des Editors', () => {
    const belegung = tasterBelegung('z2m.taster', ablaeufe);
    expect(belegung.map((e) => [e.wort, e.ablauf.alias])).toEqual([
      ['einmal', 'Flur an'],
      ['halten', 'Alles aus'],
    ]);
    expect(belegungZeile(belegung)).toBe('einmal → Flur an · halten → Alles aus');
  });

  it('lässt ruhende Abläufe und fremde Taster weg', () => {
    const belegung = tasterBelegung('z2m.taster', ablaeufe);
    expect(belegung.some((e) => e.ablauf.id === 'b3')).toBe(false);
    expect(belegung.some((e) => e.ablauf.id === 'b4')).toBe(false);
    expect(tasterBelegung('z2m.niemand', ablaeufe)).toEqual([]);
  });

  it('kennt die Wörter von Zigbee und Homematic', () => {
    expect(druckWort('double')).toBe('doppelt');
    expect(druckWort('short')).toBe('kurz');
    expect(druckWort('long')).toBe('lang');
    expect(druckWort('brightness_move_up')).toBe('heller halten');
    // Was der Editor nicht kennt, bleibt, wie das Gerät es meldet.
    expect(druckWort('button_3_single')).toBe('button_3_single');
  });

  it('ein Auslöser ohne Druckart gilt für jeden Druck', () => {
    const belegung = tasterBelegung('hm.taster', [
      { id: 'c1', alias: 'Licht', triggers: [{ type: 'state', entity_id: 'hm.taster' }] },
    ]);
    expect(belegungZeile(belegung)).toBe('jeder Druck → Licht');
  });
});
