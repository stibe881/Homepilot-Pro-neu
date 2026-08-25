/**
 * Die Batterienliste und ihr «bis morgen».
 *
 * Der Fall dahinter: «Die Meldung ‹Batterie schwach› kommt immer und
 * immer wieder.» Der Hub meldet jetzt einmal je Gerät und lässt sich
 * quittieren – die App muss dafür wissen, was quittiert ist und bis wann.
 */
import type { Entity } from '../api/types';
import { batteryRows, stummBis } from './batterien';

const geraet = (teile: Partial<Entity>): Entity =>
  ({
    id: 'hm.melder',
    kind: 'binary_sensor',
    name: 'Melder',
    integration: 'hm',
    state: {},
    commands: [],
    available: true,
    ...teile,
  }) as Entity;

describe('batteryRows', () => {
  it('nimmt nur Geräte mit Batterie und stellt die dringendsten nach vorn', () => {
    // «Schwach» ohne Prozentwert steht ganz oben: Das Gerät sagt nur
    // noch «bald leer», danach ist es still.
    const rows = batteryRows([
      geraet({ id: 'a', name: 'Voll', state: { battery: 90 } }),
      geraet({ id: 'b', name: 'Ohne Batterie', state: {} }),
      geraet({ id: 'c', name: 'Knapp', state: { battery: 12 } }),
      geraet({ id: 'd', name: 'Schwach', state: { low_battery: true } }),
    ]);
    expect(rows.map((row) => row.entity.id)).toEqual(['d', 'c', 'a']);
    expect(rows[0].percent).toBeNull();
    expect(rows[0].low).toBe(true);
  });

  it('lässt unsinnige Prozentwerte weg statt sie anzuzeigen', () => {
    expect(batteryRows([geraet({ state: { battery: 240 } })])).toEqual([]);
    // Ein Gerät, das Text statt einer Zahl meldet, gibt es – und eine
    // Zeile «voll %» wäre schlimmer als keine Zeile.
    expect(
      batteryRows([geraet({ state: { battery: 'voll' as unknown as number } })])
    ).toEqual([]);
  });
});

describe('stummBis', () => {
  const jetzt = 1_700_000_000_000; // Millisekunden, wie Date.now()

  it('meldet ein laufendes «bis morgen»', () => {
    const bis = jetzt / 1000 + 3600;
    expect(stummBis([{ entity_id: 'hm.melder', muted_until: bis }], 'hm.melder', jetzt)).toBe(
      bis
    );
  });

  it('lässt ein abgelaufenes «bis morgen» fallen', () => {
    // Morgen früh ist die Warnung wieder scharf – der Knopf soll dann
    // nicht weiter «still» behaupten.
    const bis = jetzt / 1000 - 60;
    expect(
      stummBis([{ entity_id: 'hm.melder', muted_until: bis }], 'hm.melder', jetzt)
    ).toBeNull();
  });

  it('kommt ohne Vermerk zurecht', () => {
    expect(stummBis([], 'hm.melder', jetzt)).toBeNull();
    expect(
      stummBis([{ entity_id: 'anderes', muted_until: jetzt / 1000 + 60 }], 'hm.melder', jetzt)
    ).toBeNull();
    expect(
      stummBis([{ entity_id: 'hm.melder', muted_until: null }], 'hm.melder', jetzt)
    ).toBeNull();
  });
});
