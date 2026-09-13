/** Nach Stromausfall: wie vorher, aus oder an (Punkt 630). */
import { Entity } from '../api/types';
import {
  einschaltWort,
  kannEinschalten,
  lampenNachStromausfall,
  stromausfallSatz,
} from './einschaltverhalten';

const lampe = (teile: Partial<Entity> & { id: string }): Entity =>
  ({
    kind: 'light',
    name: teile.id,
    integration: 'hue',
    state: { state: 'off' },
    commands: ['turn_on', 'turn_off', 'set_power_on'],
    available: true,
    ...teile,
  }) as Entity;

describe('einschaltWort', () => {
  it('spricht die drei Wörter und sagt, wenn der Hub nichts weiss', () => {
    expect(einschaltWort('previous')).toBe('wie vorher');
    expect(einschaltWort('off')).toBe('aus');
    expect(einschaltWort('on')).toBe('an');
    expect(einschaltWort('other')).toBe('anders eingestellt');
    expect(einschaltWort(undefined)).toBe('noch nicht gelesen');
  });
});

describe('lampenNachStromausfall', () => {
  it('trennt, was der Hub stellen kann, was umzustellen ist und was nicht geht', () => {
    const { stellbar, umzustellen, koennenNicht } = lampenNachStromausfall([
      lampe({ id: 'hue.a', state: { state: 'off', power_on: 'previous' } }),
      lampe({ id: 'hue.b', state: { state: 'off', power_on: 'on' } }),
      // Noch nicht gelesen: gilt als umzustellen - lieber einmal zu viel.
      lampe({ id: 'z2m.c' }),
      // Ohne den Befehl: Die Anbindung kann es nicht.
      lampe({ id: 'tuya.d', integration: 'tuya', commands: ['turn_on', 'turn_off'] }),
      // Steckdosen zählen nicht - der Kühlschrank soll wieder laufen.
      lampe({ id: 'hm.e', kind: 'switch', commands: ['turn_on', 'turn_off'] }),
      // Ein Spot in einer zusammengefassten Leuchte zählt nicht doppelt.
      lampe({ id: 'hue.f', combined_into: 'group.decke' }),
    ]);
    expect(stellbar.map((e) => e.id)).toEqual(['hue.a', 'hue.b', 'z2m.c']);
    expect(umzustellen.map((e) => e.id)).toEqual(['hue.b', 'z2m.c']);
    expect(koennenNicht.map((e) => e.id)).toEqual(['tuya.d']);
    expect(kannEinschalten(stellbar[0])).toBe(true);
  });
});

describe('stromausfallSatz', () => {
  it('beugt richtig und bleibt ehrlich', () => {
    expect(stromausfallSatz(0, 0)).toMatch(/Keine Lampe/);
    expect(stromausfallSatz(1, 0)).toBe(
      'Die eine Lampe bleibt nach einem Stromausfall, wie sie war.'
    );
    expect(stromausfallSatz(5, 0)).toBe(
      'Alle 5 Lampen bleiben nach einem Stromausfall, wie sie waren.'
    );
    expect(stromausfallSatz(5, 1)).toMatch(/^1 von 5 Lampen ginge/);
    expect(stromausfallSatz(5, 3)).toMatch(/^3 von 5 Lampen gingen/);
  });
});
