import { Entity } from '../api/types';
import { STILL_STUNDEN, sorgen, sorgenSatz, tageUeberfaellig } from './sorgen';

const JETZT = new Date('2026-08-27T20:00:00Z').getTime();
const STUNDE = 3_600_000;

const geraet = (over: Partial<Entity> & { id: string }): Entity => ({
  kind: 'binary_sensor',
  name: over.id,
  integration: 'demo',
  state: {},
  commands: [],
  available: true,
  room: 'Flur',
  favorite: false,
  last_seen: JETZT / 1000,
  ...over,
} as Entity);

test('ein nicht erreichbares Gerät steht oben und sagt, seit wann', () => {
  const liste = sorgen({
    entities: [
      geraet({ id: 'a', name: 'Türkontakt', available: false, last_seen: (JETZT - 3 * STUNDE) / 1000 }),
    ],
    jetzt: JETZT,
  });
  expect(liste).toHaveLength(1);
  expect(liste[0].art).toBe('offline');
  expect(liste[0].detail).toContain('zuletzt vor 3 Stunden');
});

test('ein Melder, der seit Tagen schweigt, fällt auf – das merkt sonst niemand', () => {
  const liste = sorgen({
    entities: [
      geraet({ id: 'a', name: 'Bewegung Flur', last_seen: (JETZT - (STILL_STUNDEN + 5) * STUNDE) / 1000 }),
    ],
    jetzt: JETZT,
  });
  expect(liste.map((s) => s.art)).toEqual(['still']);
});

test('eine Lampe darf tagelang still sein', () => {
  const liste = sorgen({
    entities: [
      geraet({ id: 'a', kind: 'light', name: 'Stehlampe', last_seen: (JETZT - 300 * STUNDE) / 1000 }),
    ],
    jetzt: JETZT,
  });
  expect(liste).toEqual([]);
});

test('eine schwache Batterie kommt aufs Blatt, eine volle nicht', () => {
  const liste = sorgen({
    entities: [
      geraet({ id: 'a', name: 'Rauchmelder', state: { battery: 12 } }),
      geraet({ id: 'b', name: 'Fenster', state: { battery: 90 } }),
    ],
    jetzt: JETZT,
  });
  expect(liste.map((s) => s.name)).toEqual(['Rauchmelder']);
  expect(liste[0].detail).toBe('Batterie bei 12%');
});

test('eine quittierte Batteriewarnung steht nicht wieder da', () => {
  const liste = sorgen({
    entities: [geraet({ id: 'a', name: 'Rauchmelder', state: { battery: 12 } })],
    vermerke: [{ entity_id: 'a', muted_until: (JETZT + STUNDE) / 1000 }],
    jetzt: JETZT,
  });
  expect(liste).toEqual([]);
});

test('eine überfällige Wartung sagt, seit wann', () => {
  const liste = sorgen({
    entities: [],
    wartungen: [
      { id: 'w1', text: 'Wasserfilter wechseln', due: '2026-08-20' },
      { id: 'w2', text: 'Kaminfeger', due: '2026-12-01' },
    ],
    jetzt: JETZT,
  });
  expect(liste.map((s) => s.name)).toEqual(['Wasserfilter wechseln']);
  expect(liste[0].detail).toBe('seit 7 Tagen fällig');
});

test('das Dringende steht vor dem Wartbaren', () => {
  const liste = sorgen({
    entities: [
      geraet({ id: 'b', name: 'Rauchmelder', state: { battery: 20 } }),
      geraet({ id: 'a', name: 'Türkontakt', available: false }),
    ],
    wartungen: [{ id: 'w1', text: 'Filter', due: '2026-08-26' }],
    jetzt: JETZT,
  });
  expect(liste.map((s) => s.art)).toEqual(['offline', 'batterie', 'wartung']);
});

test('ohne Sorgen sagt die Zeile das auch', () => {
  expect(sorgenSatz([])).toBe('Alles in Ordnung');
});

test('die Zeile im Menü nennt Anzahl und Arten', () => {
  const liste = sorgen({
    entities: [
      geraet({ id: 'a', name: 'Türkontakt', available: false }),
      geraet({ id: 'b', name: 'Rauchmelder', state: { battery: 5 } }),
    ],
    jetzt: JETZT,
  });
  expect(sorgenSatz(liste)).toBe('2 Sachen: nicht erreichbar, Batterie');
});

test('eine Frist in der Zukunft ist nicht überfällig', () => {
  expect(tageUeberfaellig('2026-08-30', JETZT)).toBeLessThan(0);
  expect(tageUeberfaellig(null, JETZT)).toBe(0);
});
