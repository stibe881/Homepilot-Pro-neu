import { Entity } from '../api/types';
import {
  anzeigeMasse,
  bildAdresse,
  getroffenerPunkt,
  punktArt,
  punktEntfernen,
  punktSetzen,
  schaltbar,
  sichtbarePunkte,
  unplatzierte,
} from './grundriss';

const entity = (teil: Partial<Entity>): Entity =>
  ({
    id: 'x',
    kind: 'light',
    name: 'X',
    integration: 'demo',
    state: {},
    commands: [],
    available: true,
    ...teil,
  }) as Entity;

describe('bildAdresse', () => {
  it('hängt Hub-Adresse und Token an den Pfad', () => {
    expect(
      bildAdresse('/api/grundriss/bild?v=abc', { url: 'http://hub:8123/', token: 'ge&heim' })
    ).toBe('http://hub:8123/api/grundriss/bild?v=abc&token=ge%26heim');
  });

  it('liefert ohne Pfad oder ohne Hub nichts', () => {
    expect(bildAdresse(null, { url: 'http://hub', token: 't' })).toBeNull();
    expect(bildAdresse('/api/grundriss/bild', { url: '', token: 't' })).toBeNull();
    expect(bildAdresse('http://fremd/bild', { url: 'http://hub', token: 't' })).toBeNull();
  });
});

describe('anzeigeMasse', () => {
  it('nutzt die volle Breite, solange die Höhe reicht', () => {
    expect(anzeigeMasse(1000, 800, 2000, 1000)).toEqual({ width: 1000, height: 500 });
  });

  it('deckelt einen hochkant fotografierten Plan über die Höhe', () => {
    // 1000 breit hiesse 2000 hoch - stattdessen 800 hoch und schmaler.
    expect(anzeigeMasse(1000, 800, 1000, 2000)).toEqual({ width: 400, height: 800 });
  });

  it('bleibt bei fehlenden Massen bei null statt NaN', () => {
    expect(anzeigeMasse(0, 800, 100, 100)).toEqual({ width: 0, height: 0 });
    expect(anzeigeMasse(1000, 800, 0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe('punktArt', () => {
  it('kennt an, aus und nicht erreichbar', () => {
    expect(punktArt(entity({ state: { state: 'on' } }))).toBe('an');
    expect(punktArt(entity({ state: { state: 'off' } }))).toBe('aus');
    expect(punktArt(entity({ available: false, state: { state: 'on' } }))).toBe('weg');
  });

  it('zählt offen und entriegelt als an - eine offene Türe ist eine Meldung', () => {
    expect(punktArt(entity({ state: { state: 'open' } }))).toBe('an');
    expect(punktArt(entity({ state: { state: 'unlocked' } }))).toBe('an');
    expect(punktArt(entity({ state: { state: 21.5 } }))).toBe('aus');
  });
});

describe('schaltbar', () => {
  it('erkennt schaltbare Geräte an ihren Befehlen', () => {
    expect(schaltbar(['toggle', 'set_brightness'])).toBe(true);
    expect(schaltbar(['play', 'pause'])).toBe(false);
    expect(schaltbar([])).toBe(false);
  });
});

describe('getroffenerPunkt', () => {
  const punkte = [
    { entity_id: 'a', x: 0.2, y: 0.2 },
    { entity_id: 'b', x: 0.8, y: 0.8 },
  ];

  it('findet den nächsten Punkt innerhalb der Toleranz', () => {
    expect(getroffenerPunkt(punkte, 0.22, 0.19, 0.05)?.entity_id).toBe('a');
  });

  it('trifft nichts, wenn alle zu weit weg sind', () => {
    expect(getroffenerPunkt(punkte, 0.5, 0.5, 0.05)).toBeNull();
  });

  it('rechnet die Höhe mit dem Seitenverhältnis, sonst wäre die Trefferfläche ein Oval', () => {
    // Bild doppelt so hoch wie breit: 0.04 in y sind 0.08 in Bildbreiten.
    expect(getroffenerPunkt(punkte, 0.2, 0.24, 0.05, 2)).toBeNull();
    expect(getroffenerPunkt(punkte, 0.2, 0.24, 0.05, 1)?.entity_id).toBe('a');
  });
});

describe('punktSetzen und punktEntfernen', () => {
  it('ein Gerät steht nur einmal auf dem Plan', () => {
    let punkte = punktSetzen([], 'a', 0.1, 0.1);
    punkte = punktSetzen(punkte, 'a', 0.9, 0.9);
    expect(punkte).toEqual([{ entity_id: 'a', x: 0.9, y: 0.9 }]);
  });

  it('klemmt einen Tipp neben dem Rand in den Rand', () => {
    expect(punktSetzen([], 'a', -0.02, 1.03)[0]).toEqual({ entity_id: 'a', x: 0, y: 1 });
  });

  it('entfernt genau den einen Punkt', () => {
    const punkte = [
      { entity_id: 'a', x: 0.1, y: 0.1 },
      { entity_id: 'b', x: 0.2, y: 0.2 },
    ];
    expect(punktEntfernen(punkte, 'a')).toEqual([{ entity_id: 'b', x: 0.2, y: 0.2 }]);
  });
});

describe('unplatzierte', () => {
  it('sortiert nach Raum und Name - so sucht man ein Gerät', () => {
    const alle = [
      entity({ id: '1', name: 'Stehlampe', room: 'Wohnzimmer' }),
      entity({ id: '2', name: 'Deckenlicht', room: 'Flur' }),
      entity({ id: '3', name: 'Bewegungsmelder', room: 'Flur' }),
    ];
    expect(unplatzierte(alle, []).map((e) => e.id)).toEqual(['3', '2', '1']);
  });

  it('lässt platzierte und zusammengefasste Geräte weg', () => {
    const alle = [
      entity({ id: '1', name: 'A' }),
      entity({ id: '2', name: 'B', combined_into: 'leuchte.decke' }),
      entity({ id: '3', name: 'C' }),
    ];
    expect(unplatzierte(alle, [{ entity_id: '3', x: 0.5, y: 0.5 }]).map((e) => e.id)).toEqual([
      '1',
    ]);
  });
});

describe('sichtbarePunkte', () => {
  it('zeigt nur Punkte, deren Gerät der Hub noch kennt', () => {
    const punkte = [
      { entity_id: 'a', x: 0.1, y: 0.1 },
      { entity_id: 'ausgebaut', x: 0.2, y: 0.2 },
    ];
    const paare = sichtbarePunkte(punkte, [entity({ id: 'a' })]);
    expect(paare).toHaveLength(1);
    expect(paare[0].entity.id).toBe('a');
  });
});
