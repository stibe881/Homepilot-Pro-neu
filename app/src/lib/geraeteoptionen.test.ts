/** Einstellungen am Gerät - Nachlaufzeit, Empfindlichkeit, Abgleich (Punkt 631). */
import { Entity } from '../api/types';
import {
  GeraetOption,
  begrenzt,
  naechsterWert,
  optionenVon,
  schrittFuer,
  wertText,
  wertWort,
} from './geraeteoptionen';

const nachlauf: GeraetOption = {
  name: 'occupancy_timeout',
  label: 'Nachlaufzeit',
  type: 'numeric',
  min: 0,
  max: 65535,
  unit: 's',
  value: 90,
};
const abgleich: GeraetOption = {
  name: 'temperature_calibration',
  label: 'Temperatur-Abgleich',
  type: 'numeric',
  min: -10,
  max: 10,
  step: 0.1,
  unit: '°C',
  value: -0.7,
};

function geraet(commands: string[], options: unknown): Entity {
  return {
    id: 'zigbee2mqtt.melder_flur',
    kind: 'binary_sensor',
    name: 'Melder Flur',
    integration: 'zigbee2mqtt',
    state: { state: 'off', options },
    commands,
    available: true,
  };
}

describe('optionenVon', () => {
  it('liest die Liste nur, wenn das Gerät den Befehl kennt', () => {
    expect(optionenVon(geraet(['set_option'], [nachlauf])).map((o) => o.name)).toEqual([
      'occupancy_timeout',
    ]);
    // Ein alter Hub schickt die Liste nicht - dann gibt es nichts zu stellen.
    expect(optionenVon(geraet([], [nachlauf]))).toEqual([]);
    expect(optionenVon(geraet(['set_option'], undefined))).toEqual([]);
    expect(optionenVon(geraet(['set_option'], [{ name: 'x', type: 'kaputt' }]))).toEqual([]);
  });
});

describe('schritt und nächster Wert', () => {
  it('nimmt den Schritt des Geräts, sonst einen, der zum Bereich passt', () => {
    expect(schrittFuer(abgleich)).toBe(0.1);
    // Eine Nachlaufzeit bis 65535 in Einerschritten wäre ein Witz.
    expect(schrittFuer(nachlauf)).toBe(10);
    expect(schrittFuer({ ...nachlauf, min: 0, max: 100 })).toBe(1);
  });

  it('rundet auf den Schritt und bleibt im Bereich', () => {
    // Sonst steht nach zehn Tippern «0.30000000000000004 °C» da.
    expect(naechsterWert(abgleich, -1)).toBe(-0.8);
    expect(naechsterWert({ ...abgleich, value: 9.95 }, 1)).toBe(10);
    expect(naechsterWert({ ...nachlauf, value: 5 }, -1)).toBe(0);
    // Ohne gemeldeten Wert zählt es von null.
    expect(naechsterWert({ ...nachlauf, value: null }, 1)).toBe(10);
    expect(begrenzt(nachlauf, 999999)).toBe(65535);
    expect(begrenzt(abgleich, 0.123456)).toBe(0.1);
  });
});

describe('wertText', () => {
  it('spricht Deutsch und trägt die Einheit', () => {
    expect(wertText(nachlauf)).toBe('90 s');
    expect(wertText(abgleich)).toBe('−0.7 °C');
    expect(wertText({ ...nachlauf, value: null })).toBe('–');
    expect(
      wertText({ name: 'led_indication', label: 'LED', type: 'binary', value: false })
    ).toBe('aus');
    expect(
      wertText({
        name: 'motion_sensitivity',
        label: 'Empfindlichkeit',
        type: 'enum',
        values: ['low', 'medium', 'high'],
        value: 'high',
      })
    ).toBe('hoch');
    // Was die Liste nicht kennt, bleibt lesbar statt falsch.
    expect(wertWort('super_fast')).toBe('super fast');
  });
});
