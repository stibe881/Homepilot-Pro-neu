import { tvLogo } from './tvlogo';

describe('tvLogo', () => {
  it('kennt jede Vorgabe-App des Android-TV', () => {
    // Die Liste aus hub/integrations/androidtv.py (DEFAULT_APPS): Genau
    // diese Namen stehen auf der Fernbedienung im Wohnzimmer.
    for (const name of [
      'Plex',
      'Zattoo',
      'YouTube',
      'Netflix',
      'Disney+',
      'Prime Video',
      'Joyn',
    ]) {
      expect(tvLogo(name)).not.toBeNull();
    }
  });

  it('Netflix ist das rote N', () => {
    expect(tvLogo('Netflix')).toEqual({ icon: 'netflix', farbe: '#E50914' });
  });

  it('Zattoo hat keine Glyphe und trägt darum einen Schriftzug', () => {
    expect(tvLogo('Zattoo')).toEqual({ schriftzug: 'Z', farbe: '#000000' });
  });

  it('liest über Schreibweise und Ränder hinweg', () => {
    expect(tvLogo('  netflix ')).toEqual(tvLogo('Netflix'));
    expect(tvLogo('PRIME  VIDEO')).toEqual(tvLogo('Prime Video'));
  });

  it('gibt Unbekanntem kein Logo statt eines erfundenen', () => {
    // «Plus7» und «Kodi-Fork XY» aus einer config.yaml sollen als Wort
    // erscheinen, nicht als falsches Markenzeichen.
    expect(tvLogo('Plus7')).toBeNull();
    expect(tvLogo('')).toBeNull();
  });
});
