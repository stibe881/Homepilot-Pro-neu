import { kartenZiel, ortFuer, passt, schluessel } from './ladenkarte';

const ORTE = [
  { name: 'Ochsner Sport Sursee', latitude: 47.17, longitude: 8.11 },
  { name: 'Migros', latitude: null, longitude: null },
];

describe('passt', () => {
  it('führt Filiale und Kette zusammen', () => {
    // Wer eine Kette meint, meint sie überall - dieselbe Regel wie im
    // Hub (core/gutscheinort.py).
    expect(passt('Ochsner Sport', 'Ochsner Sport Sursee')).toBe(true);
    expect(passt('Ochsner Sport Sursee', 'Ochsner Sport')).toBe(true);
  });

  it('lässt Gross- und Kleinschreibung und Rechtsformen weg', () => {
    expect(passt('MIGROS', 'migros')).toBe(true);
    expect(passt('Meier AG', 'Meier')).toBe(true);
  });

  it('lässt zwei Läden zwei Läden sein', () => {
    expect(passt('Coop', 'Migros')).toBe(false);
  });

  it('lässt leere Namen zu nichts passen', () => {
    // Sonst hinge an einem Gutschein ohne Laden jeder Ort im Haus.
    expect(passt('', 'Migros')).toBe(false);
    expect(passt('Migros', null)).toBe(false);
  });
});

describe('schluessel', () => {
  it('wirft doppelte Zwischenräume weg', () => {
    expect(schluessel('  Coop   (Filiale) ')).toBe('coop');
  });
});

describe('ortFuer', () => {
  it('findet den angelegten Ort', () => {
    expect(ortFuer('Ochsner Sport', ORTE)?.name).toBe('Ochsner Sport Sursee');
  });

  it('gibt null, wo keiner angelegt ist', () => {
    expect(ortFuer('Ochsner Sport', [])).toBeNull();
  });
});

describe('kartenZiel', () => {
  it('nimmt die Koordinaten, wo es welche gibt', () => {
    // Sie führen an die Tür und nicht an die Hauptfiliale in Zürich,
    // die zufällig denselben Namen trägt.
    expect(kartenZiel('Ochsner Sport', ORTE)).toBe('47.17,8.11');
  });

  it('nimmt sonst den Namen', () => {
    // Die Kartenapp findet «Ochsner Sport Sursee» besser als wir.
    expect(kartenZiel('Ochsner Sport', [])).toBe('Ochsner Sport');
    expect(kartenZiel('Migros', ORTE)).toBe('Migros');
  });

  it('gibt null ohne Laden', () => {
    // Dann steht kein Knopf da, statt einer, der eine leere Karte
    // öffnet.
    expect(kartenZiel('', ORTE)).toBeNull();
    expect(kartenZiel(null)).toBeNull();
  });
});
