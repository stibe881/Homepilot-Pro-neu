/** Woher eine Lampe im Ablauf ihre Helligkeit nimmt. */
import { Entity } from '../api/types';
import {
  NACH_RAUM,
  NACH_TAGESZEIT,
  chipWahl,
  chipWert,
  helligkeitsOptionen,
  misstLux,
  quelleVon,
  raumHatLux,
} from './helligkeitsvorgabe';

const geraet = (patch: Partial<Entity>): Entity =>
  ({
    id: 'x',
    kind: 'sensor',
    name: 'X',
    integration: 'demo',
    state: {},
    commands: [],
    available: true,
    ...patch,
  }) as Entity;

describe('misstLux', () => {
  it('nimmt nur echte Messwerte', () => {
    expect(misstLux(geraet({ state: { illumination: 12 } }))).toBe(true);
    expect(misstLux(geraet({ state: { illumination: 0 } }))).toBe(true);
    expect(misstLux(geraet({ state: {} }))).toBe(false);
    expect(misstLux(geraet({ state: { illumination: 'hell' } }))).toBe(false);
  });
});

describe('raumHatLux', () => {
  const lampe = geraet({ id: 'hue.stube', kind: 'light', room: 'Stube' });

  it('fragt den Raum der Lampe', () => {
    const alle = [lampe, geraet({ id: 'm1', room: 'Stube', state: { illumination: 5 } })];
    expect(raumHatLux(alle, lampe)).toBe(true);
  });

  it('lässt einen Fühler zwei Zimmer weiter nicht gelten', () => {
    const alle = [lampe, geraet({ id: 'm1', room: 'Bad', state: { illumination: 5 } })];
    expect(raumHatLux(alle, lampe)).toBe(false);
  });

  it('sagt nein, wenn die Lampe gar keinen Raum hat', () => {
    expect(raumHatLux([], geraet({ id: 'hue.x', kind: 'light' }))).toBe(false);
  });
});

describe('quelleVon und chipWert', () => {
  it('erkennt alle drei Fälle', () => {
    expect(quelleVon({ adaptive: true })).toBe('raum');
    expect(quelleVon({ nachTageszeit: true })).toBe('tageszeit');
    expect(quelleVon({})).toBe('zahl');
    expect(chipWert({ adaptive: true })).toBe(NACH_RAUM);
    expect(chipWert({ nachTageszeit: true })).toBe(NACH_TAGESZEIT);
    expect(chipWert({ brightness: 25 })).toBe('25');
    expect(chipWert({})).toBe('50');
  });
});

describe('chipWahl', () => {
  it('lässt immer nur eine Quelle stehen', () => {
    // Sonst gewänne beim Speichern die alte Wahl gegen die neue Zahl.
    expect(chipWahl(NACH_RAUM)).toEqual({ adaptive: true, nachTageszeit: undefined });
    expect(chipWahl(NACH_TAGESZEIT)).toEqual({
      adaptive: undefined,
      nachTageszeit: true,
    });
    expect(chipWahl('75')).toEqual({
      adaptive: undefined,
      nachTageszeit: undefined,
      brightness: 75,
    });
  });
});

describe('helligkeitsOptionen', () => {
  it('bietet die Uhr immer an, den Raum nur mit Fühler', () => {
    const ohne = helligkeitsOptionen(false).map((o) => o.key);
    expect(ohne).not.toContain(NACH_RAUM);
    expect(ohne).toContain(NACH_TAGESZEIT);
    expect(helligkeitsOptionen(true).map((o) => o.key)).toContain(NACH_RAUM);
  });
});
