/**
 * Zustandsübergänge (Punkt 292/443).
 *
 * Der Fall: Man tippt auf die Kachel, nichts scheint zu geschehen, und
 * man tippt ein zweites Mal - dann geht das Licht an und gleich wieder
 * aus.
 */
import {
  EIGEN_MS,
  EIGEN_FENSTER_MS,
  FREMD_MS,
  bewegtSich,
  dauerMs,
} from './uebergang';

describe('Wie lange ein Wechsel dauert', () => {
  const jetzt = 1_700_000_000_000;

  it('ist kurz, wenn ich gerade selbst getippt habe', () => {
    expect(dauerMs(jetzt - 200, jetzt)).toBe(EIGEN_MS);
  });

  it('ist länger, wenn es von selbst geschah', () => {
    expect(dauerMs(null, jetzt)).toBe(FREMD_MS);
    expect(dauerMs(jetzt - EIGEN_FENSTER_MS - 1, jetzt)).toBe(FREMD_MS);
  });

  it('zählt das langsame Gerät noch als eigenes Tippen', () => {
    // Homematic über Funk braucht auch mal 700 ms - sonst bewegte sich
    // dieselbe Kachel anders als die daneben.
    expect(dauerMs(jetzt - 700, jetzt)).toBe(EIGEN_MS);
  });
});

describe('Wann sich überhaupt etwas bewegt', () => {
  it('bleibt beim ersten Aufbau still', () => {
    // Sonst wären beim Öffnen dreissig Kacheln gleichzeitig in Bewegung.
    expect(bewegtSich(undefined, 'on')).toBe(false);
  });

  it('bleibt still, wenn sich nichts geändert hat', () => {
    expect(bewegtSich('on', 'on')).toBe(false);
  });

  it('bewegt sich beim echten Wechsel', () => {
    expect(bewegtSich('off', 'on')).toBe(true);
  });
});
