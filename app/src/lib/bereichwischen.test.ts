import { WEG, bereichsRichtung, zimmerRichtung } from './bereichwischen';
import { bereichTint, bereichTon, nachbar, nachbarBereich } from './bereiche';
import { KANTE } from './zurueckwischen';

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

describe('zimmerRichtung', () => {
  it('lässt die Kante der Zurück-Geste', () => {
    // Punkt 583: Von der linken Kante nach rechts heisst im Zimmer
    // weiterhin «zurück zur Raumliste», nicht «voriges Zimmer».
    expect(zimmerRichtung(KANTE, WEG, 0)).toBeNull();
    expect(zimmerRichtung(KANTE, -WEG, 0)).toBeNull();
  });

  it('wechselt mitten auf der Seite das Zimmer', () => {
    expect(zimmerRichtung(200, -WEG, 0)).toBe(1);
    expect(zimmerRichtung(200, WEG, 5)).toBe(-1);
    expect(zimmerRichtung(200, -100, 60)).toBeNull();
  });
});

describe('nachbar', () => {
  it('führt durch die Raumliste und endet am letzten Zimmer', () => {
    // Der Abendgang aus Punkt 583: Wohnzimmer → Küche → Flur, ohne den
    // Umweg über die Raumliste.
    const zimmer = ['Wohnzimmer', 'Küche', 'Flur'];
    expect(nachbar(zimmer, 'Wohnzimmer', 1)).toBe('Küche');
    expect(nachbar(zimmer, 'Küche', 1)).toBe('Flur');
    expect(nachbar(zimmer, 'Flur', 1)).toBeNull();
    expect(nachbar(zimmer, 'Küche', -1)).toBe('Wohnzimmer');
    expect(nachbar(zimmer, 'Wohnzimmer', -1)).toBeNull();
  });

  it('kennt kein Zimmer, das nicht in der Liste steht', () => {
    expect(nachbar(['Küche'], 'Keller', 1)).toBeNull();
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

describe('bereichTon', () => {
  it('kennt die sieben Punkte der Leiste, sonst nichts', () => {
    expect(bereichTon('light')).toBe(42);
    expect(bereichTon('devices')).toBeNull();
    expect(bereichTint(42)).toBe('hsla(42, 55%, 50%, 0.28)');
    expect(bereichTint(null)).toBeNull();
  });
});
