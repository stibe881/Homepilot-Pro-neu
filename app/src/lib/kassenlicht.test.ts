import { zurueckstellen } from './kassenlicht';

describe('zurueckstellen', () => {
  it('stellt nur einen brauchbaren, dunkleren Wert zurück', () => {
    expect(zurueckstellen(0.3)).toBe(0.3);
    expect(zurueckstellen(0)).toBe(0);
    expect(zurueckstellen(1)).toBeNull();
    expect(zurueckstellen(-1)).toBeNull();
    expect(zurueckstellen(Number.NaN)).toBeNull();
    expect(zurueckstellen(null)).toBeNull();
    expect(zurueckstellen(undefined)).toBeNull();
  });
});
