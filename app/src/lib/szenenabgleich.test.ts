import { beruehrtSzene, szenenEntitaetenMenge } from './szenenabgleich';
import { Scene } from '../api/types';

function szene(id: string, entityIds: string[]): Scene {
  return {
    id,
    name: id,
    icon: 'sparkles-outline',
    actions: [],
    entity_ids: entityIds,
  } as Scene;
}

test('szenenEntitaetenMenge sammelt die Entitäten aller Szenen', () => {
  const menge = szenenEntitaetenMenge([
    szene('kino', ['hue.stube', 'tv.stube']),
    szene('schlafen', ['hue.schlafzimmer']),
  ]);
  expect(menge.has('hue.stube')).toBe(true);
  expect(menge.has('tv.stube')).toBe(true);
  expect(menge.has('hue.schlafzimmer')).toBe(true);
  expect(menge.has('hue.kueche')).toBe(false);
});

test('szenenEntitaetenMenge kommt ohne Szenen und ohne entity_ids klar', () => {
  expect(szenenEntitaetenMenge([]).size).toBe(0);
  expect(szenenEntitaetenMenge([szene('x', [])]).size).toBe(0);
});

test('beruehrtSzene meldet, ob eine der Entitäten zu einer Szene gehört', () => {
  const menge = szenenEntitaetenMenge([szene('kino', ['hue.stube', 'tv.stube'])]);
  // Der gemeldete Fall: Der Fernseher braucht länger als 1,2 Sekunden
  // zum Aufwachen und meldet sich erst später - genau dann muss die
  // App noch einmal beim Hub nachfragen.
  expect(beruehrtSzene(['tv.stube'], menge)).toBe(true);
  // Eine Temperaturmeldung aus einem anderen Zimmer betrifft keine
  // Szene - kein Grund, die Szenenliste neu zu laden.
  expect(beruehrtSzene(['sensor.aussen'], menge)).toBe(false);
  expect(beruehrtSzene([], menge)).toBe(false);
});
