import { Entity, Scene } from '../api/types';

import {
  MAX_KARTEN,
  addableKarten,
  kartenSatz,
  resolveKarte,
  resolveKarten,
} from './widgetKarten';

const lampe = {
  id: 'hue.kueche',
  kind: 'light',
  name: 'Küchenlicht',
  integration: 'hue',
  state: { state: 'on' },
  commands: ['toggle', 'turn_on', 'turn_off'],
} as Entity;

const fuehler = {
  id: 'demo.temperatur',
  kind: 'sensor',
  name: 'Aussentemperatur',
  integration: 'demo',
  state: { state: 12.4, unit: '°C' },
  commands: [],
  available: true,
} as Entity;

const kamera = {
  id: 'protect.balkon',
  kind: 'camera',
  name: 'Balkon',
  integration: 'protect',
  state: {},
  commands: ['snapshot'],
} as Entity;

const szene = { id: 'kino', name: 'Kino' } as Scene;

describe('Eine Karte aus einem Schlüssel', () => {
  it('macht aus einem Licht eine schaltbare Karte', () => {
    const karte = resolveKarte('entity:hue.kueche', [], [lampe], true);
    expect(karte).toMatchObject({
      id: 'hue.kueche',
      kind: 'entity',
      title: 'Küchenlicht',
    });
    expect(karte?.actionPath).toBe('/api/entities/hue.kueche/command');
    expect(karte?.actionBody).toBe('{"command":"toggle"}');
  });

  it('gibt einem Fühler keine Schaltfläche', () => {
    // Eine Karte, die beim Antippen nichts tut, ist schlimmer als eine,
    // die nur anzeigt.
    const karte = resolveKarte('entity:demo.temperatur', [], [fuehler], true);
    expect(karte?.title).toBe('Aussentemperatur');
    expect(karte?.actionPath).toBeUndefined();
  });

  it('schaltet nicht, solange der Hausstand aus ist', () => {
    // Ohne Token im Widget kann es nichts aufrufen.
    const karte = resolveKarte('entity:hue.kueche', [], [lampe], false);
    expect(karte?.actionPath).toBeUndefined();
  });

  it('macht aus einer Szene eine Karte, die sie aufruft', () => {
    const karte = resolveKarte('scene:kino', [szene], [], true);
    expect(karte).toMatchObject({ kind: 'scene', title: 'Kino' });
    expect(karte?.actionPath).toBe('/api/scenes/kino/activate');
  });

  it('lässt Kameras, Kalender und Wetter aus', () => {
    expect(resolveKarte('entity:protect.balkon', [], [kamera], true)).toBeNull();
  });

  it('ergibt nichts für ein Gerät, das es nicht mehr gibt', () => {
    expect(resolveKarte('entity:weg', [], [lampe], true)).toBeNull();
  });

  it('kennt die Abkürzungen der Knopfleiste nicht', () => {
    // «Alles aus» hat keinen Zustand, den eine Karte zeigen könnte.
    expect(resolveKarte('alloff', [], [lampe], true)).toBeNull();
    expect(resolveKarte('door', [], [lampe], true)).toBeNull();
  });
});

describe('Die gespeicherte Liste', () => {
  it('wirft Doppeltes und Verschwundenes heraus', () => {
    const karten = resolveKarten(
      ['entity:hue.kueche', 'entity:hue.kueche', 'entity:weg'],
      [],
      [lampe],
      true
    );
    expect(karten.map((k) => k.key)).toEqual(['entity:hue.kueche']);
  });

  it('hört beim Höchstmass auf', () => {
    const viele = Array.from({ length: 20 }, (_, i) => ({
      ...lampe,
      id: `hue.l${i}`,
      name: `Licht ${i}`,
    })) as Entity[];
    const karten = resolveKarten(
      viele.map((e) => `entity:${e.id}`),
      [],
      viele,
      true
    );
    expect(karten).toHaveLength(MAX_KARTEN);
  });

  it('ohne Liste keine Karten', () => {
    // Anders als bei den Knöpfen gibt es hier keinen Startbestand: Ein
    // Widget, das niemand bestellt hat, soll auch nichts anbieten.
    expect(resolveKarten(undefined, [], [lampe], true)).toEqual([]);
  });
});

describe('Das Angebot', () => {
  it('zeigt Szenen und Geräte, aber nichts schon Gewähltes', () => {
    const angebot = addableKarten(['scene:kino'], [szene], [lampe, fuehler]);
    expect(angebot.map((k) => k.key)).toEqual([
      'entity:hue.kueche',
      'entity:demo.temperatur',
    ]);
  });

  it('lässt in einer Leuchte aufgegangene Lichter aus', () => {
    const spot = { ...lampe, id: 'hue.spot', combined_into: 'group.decke' } as Entity;
    const angebot = addableKarten([], [], [lampe, spot]);
    expect(angebot.map((k) => k.id)).toEqual(['hue.kueche']);
  });
});

describe('Der Satz über der Liste', () => {
  it('sagt bei null, wofür das gut ist', () => {
    expect(kartenSatz(0)).toContain('Gerät oder eine Szene');
  });

  it('sagt sonst, wo die Karten erscheinen: im HomePilot-Widget', () => {
    // Der behobene Irrweg: Der Satz schickte zum «Widget bearbeiten»
    // einer eigenen Widget-Art - dabei liegen die Karten jetzt dort,
    // wo das Widget schon ist.
    expect(kartenSatz(1)).toContain('Eine Karte steht');
    expect(kartenSatz(3)).toContain('3 Karten stehen');
    expect(kartenSatz(2)).toContain('im HomePilot-Widget');
  });
});
