/**
 * Die Warteschlange hinter der Musikkarte.
 */
import { hatWarteschlange, warteTitel, warteschlange } from './musikliste';

const LAEUFT = {
  track: 'Erster',
  artist: 'A',
  playlist: 'Sonntagmorgen',
  queue: [
    { track: 'Zweiter', artist: 'B', uri: 'spotify:track:2' },
    { track: 'Dritter', artist: null },
  ],
};

describe('warteschlange', () => {
  it('stellt den laufenden Titel voran und nummeriert den Rest', () => {
    // Eine Liste, die mitten im Album anfängt, lässt einen suchen, wo
    // man gerade ist.
    expect(warteschlange(LAEUFT).map((z) => [z.nummer, z.track])).toEqual([
      ['läuft', 'Erster'],
      ['1', 'Zweiter'],
      ['2', 'Dritter'],
    ]);
  });

  it('kennzeichnet genau einen als laufend', () => {
    expect(warteschlange(LAEUFT).filter((z) => z.laeuft)).toHaveLength(1);
  });

  it('lässt einen fehlenden Künstler leer statt «null» zu schreiben', () => {
    expect(warteschlange(LAEUFT)[2].artist).toBe('');
  });

  it('gibt demselben Titel an zwei Stellen verschiedene Schlüssel', () => {
    const doppelt = { track: 'X', queue: [{ track: 'Y' }, { track: 'Y' }] };
    const keys = warteschlange(doppelt).map((z) => z.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('überspringt Einträge ohne Titel', () => {
    expect(
      warteschlange({ track: 'X', queue: [{ track: '' }, { track: 'Y' }] })
    ).toHaveLength(2);
  });

  it('verträgt einen leeren Zustand', () => {
    expect(warteschlange(undefined)).toEqual([]);
    expect(warteschlange({})).toEqual([]);
    expect(warteschlange({ queue: 'kaputt' })).toEqual([]);
  });
});

describe('warteschlange: das Anspringen', () => {
  it('reicht die URI durch, damit ein Tipp etwas auslösen kann', () => {
    expect(warteschlange(LAEUFT)[1].uri).toBe('spotify:track:2');
  });

  it('lässt den laufenden Titel ohne Ziel', () => {
    // Ein Tipp darauf liesse ihn von vorn beginnen - das will niemand.
    expect(warteschlange(LAEUFT)[0].uri).toBeNull();
  });

  it('verträgt eine Warteschlange ohne URIs', () => {
    // Podcast-Folgen bringen keine mit, ältere Hub-Fassungen schickten
    // gar keine. Die Zeile bleibt lesbar, nur eben nicht antippbar.
    expect(warteschlange(LAEUFT)[2].uri).toBeNull();
  });
});

describe('warteTitel', () => {
  it('nennt die Playlist, wo der Hub sie kennt', () => {
    expect(warteTitel(LAEUFT)).toBe('Sonntagmorgen');
  });

  it('fragt sonst, was man sich gerade fragt', () => {
    expect(warteTitel({ track: 'X' })).toBe('Als Nächstes');
  });
});

describe('hatWarteschlange', () => {
  it('ist wahr, sobald etwas nachkommt', () => {
    expect(hatWarteschlange(LAEUFT)).toBe(true);
  });

  it('ist falsch, wenn nur der laufende Titel bekannt ist', () => {
    // Der steht schon auf der Karte – dafür lohnt kein Fenster.
    expect(hatWarteschlange({ track: 'Erster' })).toBe(false);
    expect(hatWarteschlange({})).toBe(false);
  });
});
