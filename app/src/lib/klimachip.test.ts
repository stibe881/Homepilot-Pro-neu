import { Entity } from '../api/types';
import { klimaLabel, klimaSensor } from './klimachip';

const sensor = (over: Partial<Entity> & { id: string }): Entity =>
  ({
    kind: 'sensor',
    name: over.id,
    integration: 'x',
    state: {},
    commands: [],
    ...over,
  }) as Entity;

describe('Welcher Wert oben in der Kopfzeile steht', () => {
  it('nimmt nicht den Sendespeicher als Luftfeuchtigkeit', () => {
    // Genau das war der Fehler: Homematic legt je Funkschnittstelle
    // einen Sensor «Sendespeicher» an - Einheit Prozent. Stand er vorne,
    // zeigte der Tropfen die Auslastung des Funkmoduls.
    const entities = [
      sensor({ id: 'homematic.duty_cycle_ABC', name: 'Sendespeicher ABC', state: { state: 12, unit: '%' } }),
      sensor({ id: 'matter.feuchte', name: 'Feuchte Wohnzimmer', state: { state: 46, unit: '%' } }),
    ];
    expect(klimaSensor(entities, 'humidity')?.id).toBe('matter.feuchte');
  });

  it('lässt die Geräteart entscheiden, wenn es sie gibt', () => {
    const entities = [
      sensor({ id: 'x.irgendwas', state: { state: 30, unit: '%' } }),
      sensor({ id: 'x.echt', state: { state: 46, unit: '%', device_class: 'humidity' } }),
    ];
    expect(klimaSensor(entities, 'humidity')?.id).toBe('x.echt');
  });

  it('nimmt den Grill nicht als Zimmertemperatur', () => {
    const entities = [
      sensor({ id: 'pitboss.grill', name: 'Grill', state: { state: 180, unit: '°C' } }),
      sensor({ id: 'matter.temp', name: 'Temperatur Balkon', state: { state: 21.5, unit: '°C' } }),
    ];
    expect(klimaSensor(entities, 'temperature')?.id).toBe('matter.temp');
  });

  it('bevorzugt einen Wert ohne Raum – das ist meist der von draussen', () => {
    const entities = [
      sensor({ id: 'a', room: 'Bad', state: { state: 70, unit: '%' } }),
      sensor({ id: 'b', state: { state: 55, unit: '%' } }),
    ];
    expect(klimaSensor(entities, 'humidity')?.id).toBe('b');
  });

  it('schweigt, wenn es nichts Passendes gibt', () => {
    expect(klimaSensor([sensor({ id: 'a', state: { state: 5, unit: 'lx' } })], 'humidity')).toBeUndefined();
    // Ohne Zahl kein Wert: «–» hilft niemandem.
    expect(klimaSensor([sensor({ id: 'a', state: { unit: '%' } })], 'humidity')).toBeUndefined();
  });

  it('sagt vor, was die Zahl bedeutet und woher sie kommt', () => {
    const entity = sensor({ id: 'x', name: 'Feuchte', room: 'Wohnzimmer', state: { state: 46.4, unit: '%' } });
    expect(klimaLabel(entity, 'humidity')).toBe('Luftfeuchtigkeit Wohnzimmer, Feuchte: 46.4 Prozent');
  });
});
