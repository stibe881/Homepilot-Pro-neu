/**
 * Die vier Fragen der Geräteseite: nicht erreichbar, Batterie, ohne
 * Raum, ausgeblendet – und die Reihenfolgen dazu.
 */
import { Entity } from '../api/types';
import { passtFilter, sortiereGeraete } from './geraetefilter';

const geraet = (patch: Partial<Entity>): Entity =>
  ({
    id: 'x',
    kind: 'light',
    name: 'X',
    integration: 'demo',
    state: {},
    commands: [],
    available: true,
    ...patch,
  }) as Entity;

describe('passtFilter', () => {
  it('findet, was nicht mehr antwortet', () => {
    expect(passtFilter(geraet({ available: false }), 'offline', [])).toBe(true);
    expect(passtFilter(geraet({}), 'offline', [])).toBe(false);
  });

  it('zählt schwache und fast leere Batterien', () => {
    expect(passtFilter(geraet({ state: { low_battery: true } }), 'batterie', [])).toBe(true);
    expect(passtFilter(geraet({ state: { battery: 20 } }), 'batterie', [])).toBe(true);
    expect(passtFilter(geraet({ state: { battery: 80 } }), 'batterie', [])).toBe(false);
  });

  it('findet Heimatlose und Ausgeblendete', () => {
    expect(passtFilter(geraet({ room: undefined }), 'ohne-raum', [])).toBe(true);
    expect(passtFilter(geraet({ room: 'Küche' }), 'ohne-raum', [])).toBe(false);
    expect(passtFilter(geraet({ id: 'weg' }), 'ausgeblendet', ['weg'])).toBe(true);
  });
});

describe('sortiereGeraete', () => {
  const art = (entity: Entity) => (entity.kind === 'light' ? 'Licht' : 'Sensor');
  const liste = [
    geraet({ id: 'a', name: 'Zeta', room: 'Bad', last_seen: 300 }),
    geraet({ id: 'b', name: 'Alpha', room: 'Küche', kind: 'sensor', last_seen: 100 }),
    geraet({ id: 'c', name: 'Mitte', room: 'Bad', last_seen: undefined }),
  ];

  it('lässt «selbst» unangetastet – die gezogene Reihenfolge gilt', () => {
    expect(sortiereGeraete(liste, 'selbst', art).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('sortiert nach Raum, dann Name', () => {
    expect(sortiereGeraete(liste, 'raum', art).map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('stellt beim Stumm-Sortieren die nie Gesehenen ganz nach oben', () => {
    // Vor den Ferien will man die Liste «wer meldet sich am längsten
    // nicht» – wer *nie* gesehen wurde, ist der dringendste Fall.
    expect(sortiereGeraete(liste, 'gesehen', art).map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });
});
