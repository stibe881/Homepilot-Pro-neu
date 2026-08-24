/**
 * Wer gehört in den Musikplayer der Startseite?
 *
 * Für den Hub sind Fernseher und Box beides «media_player». Landet der
 * Fernseher in der Boxenwahl, bekommt man statt Musik eine Fernbedienung
 * ohne Bild – und bei stillem Haus kann er sogar die gezeigte Karte sein.
 */
import type { Entity } from '../api/types';
import { istMusikbox, musikboxenImRaum, pickPlayer } from './geraeteart';

function medien(teile: Partial<Entity>): Entity {
  return {
    id: 'x.y',
    kind: 'media_player',
    name: 'Gerät',
    integration: 'demo',
    state: {},
    commands: [],
    available: true,
    ...teile,
  } as Entity;
}

describe('istMusikbox', () => {
  it('lässt den Fernseher draussen', () => {
    expect(istMusikbox(medien({ commands: ['play', 'launch_app'] }))).toBe(false);
    expect(istMusikbox(medien({ commands: ['play', 'dpad_up'] }))).toBe(false);
  });

  it('nimmt Box und Spotify', () => {
    expect(istMusikbox(medien({ commands: ['play', 'play_url'] }))).toBe(true);
    expect(istMusikbox(medien({ commands: ['play', 'play_playlist'] }))).toBe(true);
  });

  it('zählt ein Gerät ohne Befehlsliste als Box', () => {
    // Im Zweifel den Player behalten: Ein Ausrutscher darüber nähme ihn
    // sonst ganz von der Startseite.
    expect(istMusikbox(medien({ commands: undefined as never }))).toBe(true);
  });

  it('gilt nur für Medien-Geräte', () => {
    expect(istMusikbox(medien({ kind: 'light' }))).toBe(false);
  });
});

describe('pickPlayer', () => {
  const tv = medien({ id: 'tv.wohnzimmer', commands: ['play', 'launch_app'] });
  const box = medien({ id: 'cast.kueche', commands: ['play', 'play_url'] });
  const spotify = medien({
    id: 'spotify.me',
    commands: ['play', 'play_playlist'],
    state: { state: 'idle' },
  });

  it('nimmt, was gerade spielt', () => {
    const spielt = medien({ id: 'cast.bad', commands: ['play'], state: { state: 'playing' } });
    expect(pickPlayer([box, spielt])?.id).toBe('cast.bad');
  });

  it('bevorzugt Spotify, wenn beide dasselbe spielen', () => {
    // Nur dort gibt es Zufall, Wiederholen und den Sprung zurück.
    const beide = [
      medien({ id: 'cast.kueche', commands: ['play'], state: { state: 'playing' } }),
      medien({
        id: 'spotify.me',
        commands: ['play', 'play_playlist'],
        state: { state: 'playing' },
      }),
    ];
    expect(pickPlayer(beide)?.id).toBe('spotify.me');
  });

  it('nimmt bei Stille die Box mit Playlists', () => {
    expect(pickPlayer([box, spotify])?.id).toBe('spotify.me');
  });

  it('übergeht den Fernseher auch dann, wenn er das Einzige ist', () => {
    expect(pickPlayer([tv])).toBeUndefined();
  });

  it('kommt mit einem Haus ohne Medien zurecht', () => {
    expect(pickPlayer([])).toBeUndefined();
  });

  it('bevorzugt das Radio vor der Box, auf der es läuft', () => {
    // Radio spielt über eine Cast-Box – beide melden «playing». Nur auf
    // der Radio-Karte steht, welcher Sender läuft und wie man wechselt.
    const beide = [
      medien({ id: 'cast.kueche', commands: ['play', 'play_url'], state: { state: 'playing' } }),
      medien({
        id: 'tunein.radio',
        commands: ['play', 'play_radio'],
        state: { state: 'playing' },
      }),
    ];
    expect(pickPlayer(beide)?.id).toBe('tunein.radio');
  });

  it('nimmt bei Stille das Radio vor der blossen Box', () => {
    const radio = medien({
      id: 'tunein.radio',
      commands: ['play', 'play_radio'],
      state: { state: 'idle' },
    });
    expect(pickPlayer([box, radio])?.id).toBe('tunein.radio');
    // Spotify bleibt trotzdem vorn: Es war die Karte, die man kennt.
    expect(pickPlayer([box, radio, spotify])?.id).toBe('spotify.me');
  });
});

describe('musikboxenImRaum', () => {
  const wohnzimmer = medien({ id: 'cast.wohnzimmer', room: 'Wohnzimmer' });
  const kueche = medien({ id: 'cast.kueche', room: 'Küche' });
  const fernseher = medien({
    id: 'tv.wohnzimmer',
    room: 'Wohnzimmer',
    commands: ['play', 'launch_app'],
  });

  it('nimmt nur die Boxen des offenen Raums', () => {
    expect(
      musikboxenImRaum([wohnzimmer, kueche], 'Wohnzimmer').map((entity) => entity.id)
    ).toEqual(['cast.wohnzimmer']);
  });

  it('lässt den Fernseher des Raums draussen', () => {
    expect(musikboxenImRaum([wohnzimmer, fernseher], 'Wohnzimmer')).toHaveLength(1);
  });

  it('gibt ohne offenen Raum nichts zurück', () => {
    // «Alle» hat keine Raumbox - dort bleibt es bei der einen Karte.
    expect(musikboxenImRaum([wohnzimmer, kueche], null)).toEqual([]);
  });
});
