import { grillkurven, hatVerlauf } from './grillverlauf';

const zeile = (minute: number, state: Record<string, unknown>) => ({
  recorded_at: new Date(Date.UTC(2026, 8, 12, 16, minute)).toISOString(),
  state,
});

describe('grillkurven', () => {
  it('macht aus dem Zustandsverlauf je Grösse eine Reihe', () => {
    // Punkt 566: Garraum, Sollwert und Fühler aus denselben Zeilen.
    const kurven = grillkurven([
      zeile(2, { temperature: 108, target: 110, probe_2: 40 }),
      zeile(0, { temperature: 90, target: 110, probe_2: 36 }),
      zeile(1, { temperature: 100, target: 110 }),
    ]);
    expect(kurven.temperatur.map((p) => p.value)).toEqual([90, 100, 108]);
    expect(kurven.ziel.map((p) => p.value)).toEqual([110, 110, 110]);
    // Der Fühler war zwischendurch ausgesteckt - die Reihe hat dort
    // eine Lücke, keinen Nullpunkt.
    expect(kurven.fuehler['2'].map((p) => p.value)).toEqual([36, 40]);
    expect(kurven.fuehler['1']).toBeUndefined();
  });

  it('übersteht Zeilen ohne Zustand oder mit Unsinn', () => {
    const kurven = grillkurven([
      { recorded_at: 'gestern' },
      zeile(0, { temperature: 'warm', probe_3: '61' }),
    ]);
    expect(kurven.temperatur).toEqual([]);
    expect(kurven.fuehler['3'].map((p) => p.value)).toEqual([61]);
    expect(grillkurven(undefined).temperatur).toEqual([]);
  });

  it('weiss, wann es für eine Kurve reicht', () => {
    expect(hatVerlauf(grillkurven([zeile(0, { temperature: 90 })]))).toBe(false);
    expect(hatVerlauf(grillkurven([zeile(0, { probe_2: 30 }), zeile(1, { probe_2: 31 })]))).toBe(
      true
    );
  });
});
