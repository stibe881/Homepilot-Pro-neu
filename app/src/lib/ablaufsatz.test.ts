/**
 * Der mitlaufende Satz im Ablauf-Editor.
 *
 * Er ist die billigste Fehlerprüfung: Wer «und» meinte und «oder» gebaut
 * hat, liest es hier – deshalb prüft der Test genau diese Wörter.
 */
import { Entity, Scene } from '../api/types';
import { ablaufSatz } from './ablaufsatz';

const entities = [
  { id: 'hm.bewegung', name: 'Bewegung Flur' },
  { id: 'hue.flur', name: 'Licht Flur' },
  { id: 'hm.fenster', name: 'Fenster Küche' },
] as Entity[];
const scenes = [{ id: 'kino', name: 'Kino' }] as Scene[];

describe('ablaufSatz', () => {
  it('baut den Satz mit Gerätenamen, nicht Kennungen', () => {
    const satz = ablaufSatz(
      {
        triggers: [{ type: 'state', entity_id: 'hm.bewegung', to: 'on' }],
        conditions: [{ type: 'sun', state: 'down' }],
        actions: [
          { type: 'command', entity_id: 'hue.flur', command: 'turn_on' },
          { type: 'delay', seconds: 240 },
          { type: 'command', entity_id: 'hue.flur', command: 'turn_off' },
        ],
        otherwise: [],
        match: 'all',
      },
      entities,
      scenes
    );
    expect(satz).toBe(
      'Wenn Bewegung Flur → on, dann Licht Flur ein, 4 Min warten, Licht Flur aus – nur wenn dunkel.'
    );
  });

  it('unterscheidet «und» und «oder» – der Grund für die Zeile', () => {
    const basis = {
      triggers: [{ type: 'state', entity_id: 'hm.bewegung', to: 'on' }],
      conditions: [
        { type: 'sun', state: 'down' },
        { type: 'state', entity_id: 'hm.fenster', equals: 'off' },
      ],
      actions: [{ type: 'command', entity_id: 'hue.flur', command: 'turn_on' }],
      otherwise: [],
    };
    expect(ablaufSatz({ ...basis, match: 'all' }, entities, scenes)).toContain(' und ');
    expect(ablaufSatz({ ...basis, match: 'any' }, entities, scenes)).toContain(' oder ');
  });

  it('nennt Szenen beim Namen und den Sonst-Zweig beim Wort', () => {
    const satz = ablaufSatz(
      {
        triggers: [{ type: 'sun', event: 'sunset', offset: -30 }],
        conditions: [],
        actions: [{ type: 'scene', scene: 'kino' }],
        otherwise: [{ type: 'command', entity_id: 'hue.flur', command: 'turn_off' }],
        match: 'all',
      },
      entities,
      scenes
    );
    expect(satz).toBe(
      'Wenn 30 Min vor Sonnenuntergang, dann Szene «Kino»; sonst Licht Flur aus.'
    );
  });

  it('sagt beim Verstummen, wer verstummt', () => {
    const satz = ablaufSatz(
      {
        triggers: [
          { type: 'availability', entity_id: 'hm.bewegung', to: false, for: 3600 },
        ],
        conditions: [],
        actions: [{ type: 'broadcast', text: 'x' }],
        otherwise: [],
        match: 'all',
      },
      entities,
      scenes
    );
    expect(satz).toBe('Wenn Bewegung Flur verstummt seit 60 Min, dann Durchsage.');
  });

  it('setzt Bedingungsgruppen in Klammern – die Verknüpfung muss lesbar sein', () => {
    const satz = ablaufSatz(
      {
        triggers: [{ type: 'state', entity_id: 'hm.bewegung', to: 'on' }],
        conditions: [
          {
            type: 'group',
            match: 'any',
            conditions: [
              { entity_id: 'hue.flur', equals: 'on' },
              { entity_id: 'hm.fenster', equals: 'open' },
            ],
          },
          { type: 'sun', state: 'down' },
        ],
        actions: [{ type: 'command', entity_id: 'hue.flur', command: 'turn_on' }],
        otherwise: [],
        match: 'all',
      },
      entities,
      scenes
    );
    expect(satz).toContain(
      'nur wenn (Licht Flur ist on oder Fenster Küche ist open) und dunkel'
    );
  });

  it('schweigt, solange der Entwurf leer ist', () => {
    expect(
      ablaufSatz(
        { triggers: [], conditions: [], actions: [], otherwise: [], match: 'all' },
        entities,
        scenes
      )
    ).toBe('');
  });
});

describe('Der Wert gehört in den Satz', () => {
  const box = {
    id: 'cast.bad',
    kind: 'media_player',
    name: 'Nest Badezimmer',
    integration: 'google_cast',
    state: {},
    commands: ['play', 'pause', 'set_volume'],
  } as unknown as Entity;

  it('sagt, wie laut – nicht bloss «Lautstärke»', () => {
    const satz = ablaufSatz(
      {
        triggers: [{ type: 'time', at: '09:30' }],
        conditions: [],
        actions: [
          { type: 'command', entity_id: 'cast.bad', command: 'set_volume', data: { volume: 20 } },
        ],
        otherwise: [],
        match: 'all',
      },
      [box],
      []
    );
    expect(satz).toContain('Nest Badezimmer Lautstärke 20 %');
  });

  it('nennt die Playlist beim Namen', () => {
    const satz = ablaufSatz(
      {
        triggers: [{ type: 'time', at: '07:00' }],
        conditions: [],
        actions: [
          {
            type: 'command',
            entity_id: 'cast.bad',
            command: 'play_playlist',
            data: { name: 'Frühstück' },
          },
        ],
        otherwise: [],
        match: 'all',
      },
      [box],
      []
    );
    expect(satz).toContain('Playlist «Frühstück»');
  });
});
