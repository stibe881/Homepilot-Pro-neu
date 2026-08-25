import type { Entity } from '../api/types';

import { ersterEntwurf, vorschlaege } from './weckerentwurf';

function player(teile: Partial<Entity>): Entity {
  return {
    id: 'x.y',
    name: 'Player',
    kind: 'media_player',
    integration: 'demo',
    available: true,
    commands: [],
    state: {},
    ...teile,
  } as Entity;
}

describe('ersterEntwurf', () => {
  it('nimmt Radio, wo es Radio gibt', () => {
    // Ein Wecker, der von einem fremden Dienst abhängt, schweigt genau
    // dann, wenn dieser Dienst gerade hakt.
    const entwurf = ersterEntwurf([
      player({ id: 'spotify.player', commands: ['play_playlist'] }),
      player({ id: 'tunein.radio', commands: ['play_radio'] }),
    ]);
    expect(entwurf.player).toBe('tunein.radio');
    expect(entwurf.kind).toBe('station');
  });

  it('nimmt Spotify, wo es kein Radio gibt', () => {
    const entwurf = ersterEntwurf([
      player({ id: 'spotify.player', commands: ['play_playlist'] }),
    ]);
    expect(entwurf.player).toBe('spotify.player');
    expect(entwurf.kind).toBe('playlist');
  });

  it('bleibt bedienbar, wenn gar nichts da ist', () => {
    const entwurf = ersterEntwurf([]);
    expect(entwurf.player).toBe('');
    expect(entwurf.days).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('vorschlaege', () => {
  it('holt die Namen aus dem Gerät selbst', () => {
    const radio = player({ state: { stations: ['SRF 3', 'Radio Pilatus'] } });
    expect(vorschlaege(radio, 'station')).toEqual(['SRF 3', 'Radio Pilatus']);
    // Die falsche Art fragt das falsche Feld ab - und bekommt nichts.
    expect(vorschlaege(radio, 'playlist')).toEqual([]);
  });

  it('verträgt ein Gerät ohne Listen', () => {
    expect(vorschlaege(undefined, 'station')).toEqual([]);
    expect(vorschlaege(player({ state: { stations: 'kaputt' } }), 'station')).toEqual([]);
  });
});
