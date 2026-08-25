import type { Entity } from '../api/types';

import { einzelBoxen, hausSatz, laufendeMusik, zustandName } from './hausmusik';

function box(teile: Partial<Entity>): Entity {
  return {
    id: 'cast.a',
    name: 'Küche',
    kind: 'media_player',
    integration: 'google_cast',
    available: true,
    commands: ['play', 'pause', 'set_volume'],
    state: { state: 'playing' },
    ...teile,
  } as Entity;
}

describe('zustandName', () => {
  it('unterscheidet, was der Hub unterscheidet', () => {
    expect(zustandName('playing')).toBe('Spielt');
    // Lädt ist nicht pausiert - der richtige Knopf ist Pause, nicht Play.
    expect(zustandName('buffering')).toBe('Lädt');
    expect(zustandName('paused')).toBe('Pausiert');
    expect(zustandName('idle')).toBe('Wartet');
    expect(zustandName('standby')).toBe('Nichts an');
    expect(zustandName(undefined)).toBe('Unbekannt');
  });
});

describe('laufendeMusik', () => {
  it('nimmt nur, was wirklich läuft', () => {
    const zeilen = laufendeMusik([
      box({ id: 'a', name: 'Küche', state: { state: 'playing', track: 'Shivers' } }),
      box({ id: 'b', name: 'Bad', state: { state: 'paused', track: 'X' } }),
      box({ id: 'c', name: 'Büro', state: { state: 'buffering' } }),
      box({ id: 'd', name: 'Weg', available: false, state: { state: 'playing' } }),
      box({ id: 'e', name: 'Lampe', kind: 'light' }),
    ]);
    expect(zeilen.map((z) => z.name)).toEqual(['Büro', 'Küche']);
    expect(zeilen[0].laedt).toBe(true);
  });

  it('nimmt auch eine Box ohne Titel mit', () => {
    // Eine Box, die spielt, ohne zu sagen was, ist immer noch eine, die
    // man leiser stellen will.
    const zeilen = laufendeMusik([box({ state: { state: 'playing' } })]);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0].track).toBe('');
  });
});

describe('hausSatz', () => {
  it('sagt auch, wenn nichts läuft', () => {
    expect(hausSatz([])).toBe('Es läuft nichts.');
  });

  it('nennt bei einer Box den Titel', () => {
    expect(hausSatz(laufendeMusik([box({ state: { state: 'playing', track: 'Shivers' } })]))).toBe(
      'Küche: Shivers',
    );
  });

  it('zählt bei mehreren', () => {
    const zeilen = laufendeMusik([
      box({ id: 'a', name: 'A' }),
      box({ id: 'b', name: 'B' }),
    ]);
    expect(hausSatz(zeilen)).toBe('Es läuft auf 2 Boxen.');
  });
});

describe('einzelBoxen', () => {
  it('lässt Gruppen, Fernseher und sich selbst weg', () => {
    const boxen = einzelBoxen(
      [
        box({ id: 'gruppe', name: 'Alle', state: { state: 'playing', is_group: true } }),
        box({ id: 'tv', name: 'TV', state: { state: 'playing', has_screen: true } }),
        box({ id: 'kueche', name: 'Küche' }),
        box({ id: 'bad', name: 'Bad' }),
        box({ id: 'stumm', name: 'Ohne Regler', commands: ['play'] }),
      ],
      'gruppe',
    );
    expect(boxen.map((b) => b.name)).toEqual(['Bad', 'Küche']);
  });
});
