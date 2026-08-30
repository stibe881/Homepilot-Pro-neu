import { Entity } from '../api/types';
import { fernbedienungMoeglich } from './fernsehkachel';
import { blaetterFuer, musiklisteMoeglich } from './blattgrund';

const box = (state: Record<string, unknown>, commands: string[] = []): Entity =>
  ({
    id: 'demo.speaker_kitchen',
    kind: 'media_player',
    name: 'Küche Lautsprecher',
    integration: 'demo',
    state,
    commands,
    available: true,
  }) as unknown as Entity;

describe('musiklisteMoeglich', () => {
  it('bleibt wahr, wenn die Musik aufhört', () => {
    // Der Fall, um den es geht: Wer die Warteschlange offen hat und das
    // letzte Stück endet, soll weiterblättern können – und nicht
    // plötzlich vor der Kachel stehen.
    expect(musiklisteMoeglich(box({ state: 'playing' }))).toBe(true);
    expect(musiklisteMoeglich(box({ state: 'idle' }))).toBe(true);
    expect(musiklisteMoeglich(box({ state: 'off' }))).toBe(true);
  });

  it('gilt nur für Mediengeräte', () => {
    const lampe = { ...box({ state: 'on' }), kind: 'light' } as unknown as Entity;
    expect(musiklisteMoeglich(lampe)).toBe(false);
  });
});

describe('blaetterFuer', () => {
  it('hält beide Blätter unabhängig vom gemeldeten Zustand bereit', () => {
    const an = box({ state: 'on' }, ['dpad_up']);
    const aus = box({ state: 'off' }, ['dpad_up']);
    expect(blaetterFuer(an, fernbedienungMoeglich(an))).toEqual({
      musikliste: true,
      fernbedienung: true,
    });
    // Dieselbe Antwort am dunklen Gerät: Das ist der ganze Punkt.
    expect(blaetterFuer(aus, fernbedienungMoeglich(aus))).toEqual({
      musikliste: true,
      fernbedienung: true,
    });
  });

  it('lässt weg, was das Gerät gar nicht kann', () => {
    const ohneKreuz = box({ state: 'on' }, ['play']);
    expect(blaetterFuer(ohneKreuz, fernbedienungMoeglich(ohneKreuz)).fernbedienung).toBe(
      false
    );
  });
});
