import { aktiveVorgabe, vorgaben } from './storenvorgaben';

const ALLES = ['open', 'close', 'stop', 'set_position', 'set_tilt'];

describe('vorgaben', () => {
  it('eine Lamellenstore kann alle vier Stellungen', () => {
    expect(vorgaben(ALLES).map((v) => v.key)).toEqual(['auf', 'halb', 'schatten', 'zu']);
  });

  it('Beschattung heisst mit Lamellen: runter und dann kippen', () => {
    const schatten = vorgaben(ALLES).find((v) => v.key === 'schatten');
    expect(schatten?.befehle).toEqual([
      { command: 'close' },
      { command: 'set_tilt', data: { tilt: 50 } },
    ]);
  });

  it('ohne Lamellen ist Beschattung eine Hoehe', () => {
    const ohne = vorgaben(['open', 'close', 'set_position']);
    expect(ohne.find((v) => v.key === 'schatten')?.befehle).toEqual([
      { command: 'set_position', data: { position: 25 } },
    ]);
  });

  it('ein Rollo am Funkschalter bekommt nur auf und zu', () => {
    // Ein Knopf «Halb», der nichts täte, wäre schlimmer als keiner.
    expect(vorgaben(['open', 'close', 'stop']).map((v) => v.key)).toEqual(['auf', 'zu']);
  });
});

describe('aktiveVorgabe', () => {
  it('erkennt die Stellungen, mit etwas Spielraum', () => {
    expect(aktiveVorgabe(100, 100, true)).toBe('auf');
    expect(aktiveVorgabe(96, 100, true)).toBe('auf');
    expect(aktiveVorgabe(50, 0, true)).toBe('halb');
    expect(aktiveVorgabe(0, 0, true)).toBe('zu');
  });

  it('unten mit offenen Lamellen ist Beschattung, nicht zu', () => {
    // Dieselbe Höhe, zwei verschiedene Zimmer.
    expect(aktiveVorgabe(0, 50, true)).toBe('schatten');
    expect(aktiveVorgabe(0, 0, true)).toBe('zu');
  });

  it('ohne Lamellen ist Beschattung eine eigene Hoehe', () => {
    expect(aktiveVorgabe(25, null, false)).toBe('schatten');
    expect(aktiveVorgabe(0, null, false)).toBe('zu');
  });

  it('dazwischen leuchtet nichts', () => {
    // Wer «Halb» hervorgehoben sieht, glaubt es - also lieber nichts.
    expect(aktiveVorgabe(70, 0, true)).toBeNull();
    expect(aktiveVorgabe(null, null, true)).toBeNull();
  });
});
