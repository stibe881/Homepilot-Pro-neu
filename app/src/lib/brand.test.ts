import { Melder, melderZeile, sortiert, zustandText } from './brand';

const melder = (teil: Partial<Melder>): Melder => ({
  entity_id: 'z.a',
  name: 'Rauchmelder',
  kind: 'binary_sensor',
  alarm: false,
  active: true,
  available: true,
  ...teil,
});

describe('zustandText', () => {
  it('sagt, was gilt', () => {
    expect(zustandText({ state: 'ausgeloest' }).ton).toBe('gefahr');
    expect(zustandText({ state: 'quittiert', acknowledged_by: 'Livia' }).text).toContain('von Livia');
    expect(zustandText({ state: 'bereit', melder: 3 }).text).toBe('Bereit – 3 Melder wachen');
    expect(zustandText({ state: 'bereit', melder: 1 }).text).toBe('Bereit – 1 Melder wacht');
    expect(zustandText({ state: 'unbesetzt' }).ton).toBe('ruhig');
  });
});

describe('melderZeile', () => {
  const jetzt = 1_000_000;
  it('stellt den Alarm über alles', () => {
    expect(melderZeile(melder({ alarm: true, low_battery: true }), jetzt)).toBe('Meldet Rauch!');
    expect(melderZeile(melder({ active: false }), jetzt)).toBe('Abgeschaltet – zählt nicht');
  });
  it('gibt einer Kamera keine Prüfung', () => {
    expect(melderZeile(melder({ kind: 'camera' }), jetzt)).toBe('Hört einen piependen Melder');
    expect(melderZeile(melder({ kind: 'camera', available: false }), jetzt)).toBe(
      'Kamera meldet sich nicht'
    );
  });
  it('nennt Batterie und Prüfung', () => {
    expect(melderZeile(melder({ battery: 88.4 }), jetzt)).toBe('Batterie 88 % · nie geprüft');
    expect(melderZeile(melder({ low_battery: true, last_test: jetzt - 3 * 86400 }), jetzt)).toBe(
      'Batterie schwach · geprüft vor 3 Tagen'
    );
    expect(
      melderZeile(melder({ available: false, last_test: jetzt - 200 * 86400, test_overdue: true }), jetzt)
    ).toBe('meldet sich nicht · Prüfung überfällig (vor 200 Tagen)');
    expect(melderZeile(melder({ last_test: jetzt }), jetzt)).toBe('heute geprüft');
  });
});

describe('sortiert', () => {
  it('alarmierende zuerst, abgeschaltete zuletzt', () => {
    const liste = sortiert([
      melder({ entity_id: 'c', name: 'C', active: false }),
      melder({ entity_id: 'b', name: 'B', low_battery: true }),
      melder({ entity_id: 'a', name: 'A', alarm: true }),
      melder({ entity_id: 'd', name: 'D', last_test: 1 }),
    ]);
    expect(liste.map((m) => m.entity_id)).toEqual(['a', 'b', 'd', 'c']);
  });
});
