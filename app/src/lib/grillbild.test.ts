import { bildName, grillBauart, grillFoto, grillKurzinfo } from './grillbild';

describe('grillBauart', () => {
  it('erkennt den stehenden Räucherschrank am PBV', () => {
    // Punkt 559: der Räucherschrank im Haus ist ein PBV4PS2.
    expect(grillBauart('PBV4PS2')).toBe('schrank');
    expect(grillBauart(' pbv3p1 ')).toBe('schrank');
  });

  it('zeichnet alles andere als liegenden Grill - auch ohne Modell', () => {
    expect(grillBauart('PB1150PS2')).toBe('fass');
    expect(grillBauart(undefined)).toBe('fass');
    expect(grillBauart('')).toBe('fass');
  });

  it('benennt das Bild fürs Vorlesen', () => {
    expect(bildName('schrank')).toBe('Bild: Räucherschrank');
    expect(bildName('fass')).toBe('Bild: Pelletgrill');
  });
});

describe('grillKurzinfo', () => {
  it('sagt Temperatur und Ziel, wenn der Grill läuft', () => {
    expect(
      grillKurzinfo({ state: 'running', temperature: 108.4, target: 110, unit: '°C' })
    ).toEqual({ gross: '108 °C', klein: 'Ziel 110 °C' });
  });

  it('sagt nur «Aus», wenn er kalt ist - ein Ziel ohne Feuer ist keine Auskunft', () => {
    expect(grillKurzinfo({ state: 'off', temperature: 21, target: 110 })).toEqual({
      gross: 'Aus',
      klein: null,
    });
  });

  it('kommt ohne Messwert aus', () => {
    expect(grillKurzinfo({ state: 'running', target: 225, unit: '°F' })).toEqual({
      gross: 'Läuft',
      klein: 'Ziel 225 °F',
    });
  });
});

describe('grillFoto', () => {
  it('kennt das Foto des Smokers im Haus', () => {
    // Punkt 564: das freigestellte Foto des PB1150PS2.
    expect(grillFoto('PB1150PS2')).toBe('pb1150ps2');
    expect(grillFoto(' pb1150ps2 ')).toBe('pb1150ps2');
  });

  it('bleibt ohne Foto bei der Zeichnung', () => {
    expect(grillFoto('PBV4PS2')).toBeNull();
    expect(grillFoto(undefined)).toBeNull();
  });
});
