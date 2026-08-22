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
