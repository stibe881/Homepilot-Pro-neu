import { WEG, bereichsRichtung } from './bereichwischen';
import { nachbarBereich } from './bereiche';

describe('bereichsRichtung', () => {
  it('nach links heisst weiter, nach rechts zurück', () => {
    expect(bereichsRichtung(-WEG, 0)).toBe(1);
    expect(bereichsRichtung(WEG, 5)).toBe(-1);
  });

  it('zu kurz oder zu schräg ist kein Wechsel', () => {
    expect(bereichsRichtung(-WEG + 1, 0)).toBeNull();
    expect(bereichsRichtung(-100, 60)).toBeNull();
    expect(bereichsRichtung(Number.NaN, 0)).toBeNull();
  });
});

describe('nachbarBereich', () => {
  const leiste = ['start', 'home', 'light'] as const;
  it('folgt der Leiste und endet am Rand', () => {
    expect(nachbarBereich([...leiste], 'start', 1)).toBe('home');
    expect(nachbarBereich([...leiste], 'home', -1)).toBe('start');
    expect(nachbarBereich([...leiste], 'light', 1)).toBeNull();
    expect(nachbarBereich([...leiste], 'devices', 1)).toBeNull();
  });
});
