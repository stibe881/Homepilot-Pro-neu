import type { Entity } from '../api/types';

import { namensVorschlag, nachVerpackung, offeneGeraete, offenSatz } from './einrichten';

const RAEUME = ['Küche', 'Bad', 'Wohnzimmer'];

function geraet(teile: Partial<Entity>): Entity {
  return {
    id: 'x.y',
    name: 'Gerät',
    kind: 'light',
    integration: 'demo',
    available: true,
    commands: [],
    state: {},
    room: 'Küche',
    ...teile,
  } as Entity;
}

describe('nachVerpackung', () => {
  it('erkennt einen Herstellernamen', () => {
    expect(nachVerpackung('Aqara Door and Window Sensor P2', RAEUME)).toBe(true);
  });

  it('lässt einen selbst vergebenen Namen in Ruhe', () => {
    // Kurz genug, oder er nennt ein Zimmer - beides spricht dafür, dass
    // ihn ein Mensch vergeben hat.
    expect(nachVerpackung('Fenster Bad', RAEUME)).toBe(false);
    expect(nachVerpackung('Küche Deckenlicht hinten links', RAEUME)).toBe(false);
  });
});

describe('offeneGeraete', () => {
  it('stellt die ohne Raum voran', () => {
    // Eine Kachel ohne Zimmer taucht in keiner Raumansicht auf, und
    // genau dort sucht man sie.
    const offen = offeneGeraete(
      [
        geraet({ id: 'a', name: 'Aqara Door and Window Sensor P2', room: 'Bad' }),
        geraet({ id: 'b', name: 'Neue Lampe', room: null }),
      ],
      RAEUME,
    );
    expect(offen.map((e) => e.entity.id)).toEqual(['b', 'a']);
    expect(offen[0].grund).toBe('raum');
    expect(offen[1].grund).toBe('name');
  });

  it('lässt Wetter und Alarm weg', () => {
    // Sie haben keinen Raum und brauchen keinen.
    const offen = offeneGeraete(
      [geraet({ kind: 'weather', room: null }), geraet({ kind: 'alarm', room: null })],
      RAEUME,
    );
    expect(offen).toEqual([]);
  });

  it('bleibt still, wenn alles eingerichtet ist', () => {
    expect(offeneGeraete([geraet({ name: 'Küche Licht' })], RAEUME)).toEqual([]);
  });
});

describe('offenSatz', () => {
  it('zählt beide Sorten getrennt', () => {
    const offen = offeneGeraete(
      [
        geraet({ id: 'a', room: null }),
        geraet({ id: 'b', room: null }),
        geraet({ id: 'c', name: 'Aqara Door and Window Sensor P2' }),
      ],
      RAEUME,
    );
    expect(offenSatz(offen)).toBe('2 ohne Raum, 1 mit dem Namen aus der Verpackung');
  });

  it('sagt nichts, wo nichts ist', () => {
    expect(offenSatz([])).toBe('');
  });
});

describe('namensVorschlag', () => {
  it('setzt Raum und Art zusammen', () => {
    expect(namensVorschlag('Küche', 'light')).toBe('Küche Licht');
    expect(namensVorschlag('Bad', 'cover')).toBe('Bad Store');
  });

  it('kommt ohne Raum und ohne bekannte Art zurecht', () => {
    expect(namensVorschlag(null, 'light')).toBe('Licht');
    expect(namensVorschlag('Büro', 'etwas_neues')).toBe('Büro');
  });
});
