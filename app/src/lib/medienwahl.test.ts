/**
 * Wer gehört in den Musikplayer der Startseite?
 *
 * Für den Hub sind Fernseher und Box beides «media_player». Landet der
 * Fernseher in der Boxenwahl, bekommt man statt Musik eine Fernbedienung
 * ohne Bild – und bei stillem Haus kann er sogar die gezeigte Karte sein.
 */
import type { Entity } from '../api/types';
import {
  hatEigeneAuswahl,
  isTelevision,
  istMusikbox,
  musikboxenImRaum,
  pickPlayer,
  quellenSymbol,
} from './geraeteart';

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

  it('lässt auch den Cast-Fernseher draussen, der wie eine Box aussieht', () => {
    // Er kennt weder Steuerkreuz noch App-Start – nur er selbst weiss,
    // dass ein Bild an ihm hängt. Genau daran hing der Fehler: Er stand
    // in der Boxenwahl der Startseite.
    const castTv = medien({
      id: 'google_cast.stube_tv',
      commands: ['play', 'pause', 'set_volume', 'play_url'],
      state: { has_screen: true },
    });
    expect(isTelevision(castTv)).toBe(true);
    expect(istMusikbox(castTv)).toBe(false);
  });

  it('hält eine Box, die sich ausdrücklich als solche meldet', () => {
    const box = medien({ commands: ['play', 'play_url'], state: { has_screen: false } });
    expect(isTelevision(box)).toBe(false);
    expect(istMusikbox(box)).toBe(true);
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

  it('nimmt den laufenden Fernseher nicht als Musikkarte', () => {
    // «Auch nicht, wenn sie etwas abspielen»: Läuft abends ein Film,
    // war der Fernseher bisher die Karte in der rechten Spalte – mit
    // Play/Pause für den Film statt eines Players für Musik.
    const castTv = medien({
      id: 'google_cast.stube_tv',
      commands: ['play', 'pause', 'set_volume', 'play_url'],
      state: { state: 'playing', has_screen: true },
    });
    expect(pickPlayer([castTv])).toBeUndefined();
    expect(pickPlayer([castTv, box])?.id).toBe('cast.kueche');
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

describe('Quellen im Player', () => {
  const spotify = medien({ id: 'spotify.me', commands: ['play', 'play_playlist'] });
  const radio = medien({ id: 'tunein.radio', commands: ['play', 'play_radio'] });
  const box = medien({ id: 'cast.kueche', commands: ['play', 'play_url'] });

  it('trennt Quellen von Boxen', () => {
    // Zwei verschiedene Fragen: *was* spielt und *wo* es spielt. Sie
    // steckten in einer Liste, und die Quelle war deshalb weder benannt
    // noch ohne Aufklappen zu sehen.
    expect(hatEigeneAuswahl(spotify)).toBe(true);
    expect(hatEigeneAuswahl(radio)).toBe(true);
    expect(hatEigeneAuswahl(box)).toBe(false);
  });

  it('gibt jeder Quelle ihr Sinnbild', () => {
    // Zwei Chips mit blossem Namen sähen aus wie zwei Boxen.
    expect(quellenSymbol(radio)).toBe('radio');
    expect(quellenSymbol(spotify)).toBe('musical-notes');
    expect(quellenSymbol(box)).toBe('volume-medium-outline');
  });
});

