import { panelContent } from './seitenspalte';

const ALLES = {
  inRoom: false,
  weather: true,
  housePlayer: true,
};

describe('panelContent', () => {
  it('zeigt auf der Startseite alles, was da ist', () => {
    expect(panelContent(ALLES)).toEqual({
      weather: true,
      housePlayer: true,
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

  it('lässt die Spalte im Zimmer ganz weg', () => {
    // Auch die Box des Zimmers stand hier einmal. Sie steht jetzt oben
    // im Raumkopf, als kompletter Medienplayer - damit bleibt für die
    // Spalte im Zimmer nichts übrig, und die Kacheln bekommen die
    // Breite.
    expect(panelContent({ ...ALLES, inRoom: true }).anything).toBe(false);
  });

  it('trägt keine Wetterwarnung mehr', () => {
    // Sie stand hier als grosse Karte «Wetterlage · 1 Warnungen» -
    // während dieselbe Warnung oben in der Kopfzeile rot blinkte.
    // Zweimal dasselbe auf einer Seite liest niemand zweimal.
    expect('alert' in panelContent(ALLES)).toBe(false);
  });

  it('meldet eine leere Spalte, statt Platz zu beanspruchen', () => {
    // Eine Spalte, die ihre 340 Punkte für nichts beansprucht, hatte
    // die Startseite schon einmal.
    expect(
      panelContent({ inRoom: false, weather: false, housePlayer: false }).anything
    ).toBe(false);
  });
});
