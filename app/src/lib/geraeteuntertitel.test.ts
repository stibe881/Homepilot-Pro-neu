import { Entity } from '../api/types';
import { geraeteUntertitel } from './geraeteart';

const geraet = (teil: Partial<Entity>): Entity =>
  ({
    id: 'x',
    name: 'x',
    kind: 'media_player',
    room: null,
    integration: 'demo',
    commands: [],
    state: {},
    ...teil,
  }) as Entity;

describe('geraeteUntertitel', () => {
  const castTv = geraet({
    id: 'cast.tv',
    name: 'Fernseher im Wohnzimmer',
    integration: 'google_cast',
    state: { is_tv: true, device_class: 'tv' },
  });
  const androidTv = geraet({
    id: 'atv.tv',
    name: 'Fernseher Wohnzimmer',
    integration: 'androidtv',
    state: { is_tv: true, device_class: 'tv' },
  });

  it('nennt bei Namensvettern die Herkunft - «im» zählt nicht', () => {
    const alle = [castTv, androidTv];
    expect(geraeteUntertitel(castTv, alle)).toContain('· Chromecast');
    expect(geraeteUntertitel(androidTv, alle)).toContain('· Android TV');
  });

  it('bleibt ohne Vetter bei der blossen Art', () => {
    expect(geraeteUntertitel(castTv, [castTv])).not.toContain('·');
  });
});
