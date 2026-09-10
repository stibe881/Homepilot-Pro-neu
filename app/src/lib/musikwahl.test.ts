import { Entity } from '../api/types';
import { effektiverWunsch, gezeigteQuelle, wahlWirkung, wechselQuelle } from './musikwahl';

function box(id: string, name: string, extra: Partial<Entity> = {}): Entity {
  return {
    id,
    kind: 'media_player',
    name,
    integration: 'cast',
    state: { state: 'idle' },
    commands: ['play', 'pause'],
    available: true,
    ...extra,
  };
}

/** Spotify: kennt Playlisten und kann umziehen. */
const spotify = box('spotify.konto', 'Spotify', {
  integration: 'spotify',
  commands: ['play', 'pause', 'play_playlist', 'play_on'],
  state: { state: 'playing', devices: ['Küche', 'Büro'], device: 'Küche' },
});
const kueche = box('cast.kueche', 'Küche', { room: 'Küche' });
const buero = box('cast.buero', 'Büro', { room: 'Büro' });
const terrasse = box('cast.terrasse', 'Terrasse', { room: 'Terrasse' });

describe('gezeigteQuelle', () => {
  const players = [spotify, kueche, buero];

  it('nimmt die Vorwahl, solange nichts gewählt ist', () => {
    // Im Zimmer ist das dessen eigene Box - deswegen steht man dort.
    expect(gezeigteQuelle(players, null, buero, players)?.id).toBe('cast.buero');
  });

  it('lässt die Wahl von Hand stechen', () => {
    expect(gezeigteQuelle(players, 'spotify.konto', buero, players)?.id).toBe(
      'spotify.konto'
    );
  });

  it('fällt zurück, wenn es die gewählte Box nicht mehr gibt', () => {
    expect(gezeigteQuelle(players, 'cast.weg', buero, players)?.id).toBe('cast.buero');
  });

  it('nimmt ohne Vorwahl die naheliegende des Hauses', () => {
    // pickPlayer: was spielt und Playlisten kann.
    expect(gezeigteQuelle(players, null, null, players)?.id).toBe('spotify.konto');
  });
});

describe('wahlWirkung', () => {
  it('zieht die Musik um, wenn die Quelle die Box kennt', () => {
    const wirkung = wahlWirkung(spotify, buero);
    expect(wirkung).toEqual({
      art: 'umzug',
      quelle: 'spotify.konto',
      device: 'Büro',
      play: true,
      wunsch: 'Büro',
    });
  });

  it('wechselt bei einer fremden Box nur die Ansicht', () => {
    // Spotify kennt die Terrasse gerade nicht - dorthin umzuziehen
    // hiesse, eine Box zu behaupten, die es für die Quelle nicht gibt.
    expect(wahlWirkung(spotify, terrasse)).toEqual({
      art: 'ansicht',
      zeigt: 'cast.terrasse',
      wunsch: 'Terrasse',
    });
  });

  it('merkt sich die Box auch dann, wenn nicht umgezogen wird', () => {
    // Eine gewählte Box ist immer eine Ansage, wohin die Musik soll -
    // der Wunsch reist bis zum Startbefehl mit (lib/boxwahl.ts).
    expect(wahlWirkung(kueche, buero).wunsch).toBe('Büro');
  });

  it('lässt den Wunsch stehen, wenn eine Quelle gewählt wird', () => {
    // «Oben Büro gewählt, dann Radio getippt - es spielt auf der
    // Terrasse»: Genau daran hing das. Eine Quelle sagt nichts darüber,
    // wo gespielt werden soll.
    expect(wahlWirkung(kueche, spotify).wunsch).toBeNull();
  });
});

describe('effektiverWunsch', () => {
  const players = [spotify, kueche, buero];

  it('nimmt die Hausbox, solange niemand selbst gewählt hat', () => {
    expect(effektiverWunsch(null, 'Küche', players)).toBe('Küche');
  });

  it('lässt eine getroffene Wahl immer stechen', () => {
    expect(effektiverWunsch('Büro', 'Küche', players)).toBe('Büro');
  });

  it('gilt nicht für eine Hausbox, die es unter den Boxen nicht gibt', () => {
    expect(effektiverWunsch(null, 'Garage', players)).toBeNull();
  });

  it('bleibt ohne Hausbox leer', () => {
    expect(effektiverWunsch(null, null, players)).toBeNull();
    expect(effektiverWunsch(null, undefined, players)).toBeNull();
  });
});

describe('wechselQuelle', () => {
  it('liest, was die Entscheidung braucht', () => {
    expect(wechselQuelle(spotify)).toEqual({
      id: 'spotify.konto',
      kannUmziehen: true,
      devices: ['Küche', 'Büro'],
      spielt: true,
    });
  });

  it('kommt mit einer Box ohne Geräteliste aus', () => {
    expect(wechselQuelle(kueche)).toEqual({
      id: 'cast.kueche',
      kannUmziehen: false,
      devices: [],
      spielt: false,
    });
  });
});
