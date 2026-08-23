import { Entity } from '../api/types';
import { FRISCH_SEKUNDEN, letztesEreignis, meldetGerade, nachBewegung } from './kameraordnung';

const jetzt = new Date(2026, 7, 23, 20, 0).getTime();
const vor = (sekunden: number) => new Date(jetzt - sekunden * 1000).toISOString();

const kamera = (id: string, state: Record<string, unknown> = {}, available = true): Entity =>
  ({
    id,
    kind: 'camera',
    name: id,
    integration: 'unifi_protect',
    state: { state: 'online', ...state },
    commands: [],
    available,
  }) as Entity;

describe('Kameras nach Bewegung sortieren', () => {
  it('holt nach oben, was gerade meldet', () => {
    const liste = [
      kamera('garten'),
      kamera('eingang', { motion: 'on' }),
      kamera('garage'),
    ];
    expect(nachBewegung(liste, jetzt).map((k) => k.id)).toEqual([
      'eingang',
      'garten',
      'garage',
    ]);
  });

  it('zählt Klingeln und erkannte Personen genauso', () => {
    expect(meldetGerade(kamera('x', { detected_person: 'on' }))).toBe(true);
    expect(meldetGerade(kamera('x', { ring: 'on' }))).toBe(true);
    expect(meldetGerade(kamera('x', { motion: 'off', detected_person: 'off' }))).toBe(false);
  });

  it('sortiert das eben Gewesene nach Frische', () => {
    const liste = [
      kamera('alt', { last_motion: vor(120) }),
      kamera('ruhig'),
      kamera('neu', { last_motion: vor(20) }),
    ];
    expect(nachBewegung(liste, jetzt).map((k) => k.id)).toEqual(['neu', 'alt', 'ruhig']);
  });

  it('lässt vergangene Ereignisse wieder los', () => {
    // Sonst bliebe die Reihenfolge den ganzen Abend verdreht.
    const liste = [
      kamera('vorhin', { last_motion: vor(FRISCH_SEKUNDEN + 60) }),
      kamera('ruhig'),
    ];
    expect(nachBewegung(liste, jetzt).map((k) => k.id)).toEqual(['vorhin', 'ruhig']);
  });

  it('schiebt nicht erreichbare Kameras ans Ende', () => {
    // Ein schwarzes Rechteck oben ist die unbrauchbarste Kachel.
    const liste = [
      kamera('weg', { last_motion: vor(10) }, false),
      kamera('ruhig'),
    ];
    expect(nachBewegung(liste, jetzt).map((k) => k.id)).toEqual(['ruhig', 'weg']);
  });

  it('lässt die bisherige Reihenfolge stehen, wenn nichts los ist', () => {
    // Wer seine Kacheln gezogen hat, findet sie wieder.
    const liste = [kamera('c'), kamera('a'), kamera('b')];
    expect(nachBewegung(liste, jetzt).map((k) => k.id)).toEqual(['c', 'a', 'b']);
  });

  it('nimmt jeden Ereignis-Stempel, nicht nur Bewegung', () => {
    expect(letztesEreignis(kamera('x', { last_baby_cry: vor(5) }))).toBeGreaterThan(0);
    expect(letztesEreignis(kamera('x'))).toBe(0);
    expect(letztesEreignis(kamera('x', { last_motion: 'kaputt' }))).toBe(0);
  });
});
