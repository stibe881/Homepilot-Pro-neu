import { panelContent, showsRoomPlayer } from './seitenspalte';

const ALLES = {
  inRoom: false,
  weather: true,
  housePlayer: true,
  roomPlayer: true,
  alert: true,
};

describe('panelContent', () => {
  it('zeigt auf der Startseite alles, was da ist', () => {
    expect(panelContent(ALLES)).toEqual({
      weather: true,
      housePlayer: true,
      roomPlayer: true,
      alert: true,
      anything: true,
    });
  });

  it('lässt im Zimmer Wetter und Hausmusik weg', () => {
    // Wer «Küche» öffnet, will die Küche sehen - nicht das Wetter von
    // Zell und die Box, die im Wohnzimmer spielt.
    const imRaum = panelContent({ ...ALLES, inRoom: true });
    expect(imRaum.weather).toBe(false);
    expect(imRaum.housePlayer).toBe(false);
  });

  it('behält im Zimmer die Box dieses Raums', () => {
    expect(panelContent({ ...ALLES, inRoom: true }).roomPlayer).toBe(true);
  });

  it('behält die Wetterwarnung auch im Zimmer', () => {
    // Sie ist der Grund, aus dem es die Spalte gibt. Sie wegzuräumen,
    // weil man in einem Zimmer steht, hiesse sie genau dann zu
    // verstecken, wenn man hinschaut.
    expect(panelContent({ ...ALLES, inRoom: true }).alert).toBe(true);
  });

  it('meldet eine leere Spalte, statt Platz zu beanspruchen', () => {
    // Im Zimmer ohne eigene Box und ohne Warnung bleibt nichts übrig -
    // dann darf dort auch keine Fläche stehen.
    const leer = panelContent({
      inRoom: true,
      weather: true,
      housePlayer: true,
      roomPlayer: false,
      alert: false,
    });
    expect(leer.anything).toBe(false);
    expect(
      panelContent({
        ...ALLES,
        weather: false,
        housePlayer: false,
        roomPlayer: false,
        alert: false,
      }).anything
    ).toBe(false);
  });
});

describe('showsRoomPlayer', () => {
  it('zeigt die Raumbox, wenn sie eine andere ist als die des Hauses', () => {
    expect(
      showsRoomPlayer({
        inRoom: false,
        roomPlayerId: 'sonos.kueche',
        housePlayerId: 'spotify.player',
      })
    ).toBe(true);
  });

  it('zeigt dieselbe Box nicht zweimal, solange die Hauskarte dasteht', () => {
    expect(
      showsRoomPlayer({
        inRoom: false,
        roomPlayerId: 'sonos.kueche',
        housePlayerId: 'sonos.kueche',
      })
    ).toBe(false);
  });

  it('zeigt sie im Zimmer auch dann, wenn es dieselbe ist', () => {
    // Die Karte des Hauses ist dort weg - ohne diese Ausnahme
    // verschwände die Musik ausgerechnet im Zimmer, in dem sie spielt.
    expect(
      showsRoomPlayer({
        inRoom: true,
        roomPlayerId: 'sonos.kueche',
        housePlayerId: 'sonos.kueche',
      })
    ).toBe(true);
  });

  it('zeigt nichts, wo keine Box steht', () => {
    expect(showsRoomPlayer({ inRoom: true, roomPlayerId: null })).toBe(false);
    expect(showsRoomPlayer({ inRoom: false })).toBe(false);
  });
});
