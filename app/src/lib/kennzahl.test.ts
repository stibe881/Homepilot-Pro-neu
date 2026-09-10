import { angeklebt, zerlege } from './kennzahl';

describe('zerlege', () => {
  it('trennt Zahl und Einheit', () => {
    expect(zerlege('21.5 °C')).toEqual({ zahl: '21.5', einheit: '°C' });
    expect(zerlege('1240 W')).toEqual({ zahl: '1240', einheit: 'W' });
  });

  it('nimmt die Einheit auch ohne Zwischenraum', () => {
    expect(zerlege('63%')).toEqual({ zahl: '63', einheit: '%' });
  });

  it('lässt eine Uhrzeit ganz', () => {
    // «08:15» ist eine Zahl und keine Zahl mit Einheit - «08» gross und
    // «:15» klein wäre eine Uhr, die niemand mehr lesen kann.
    expect(zerlege('08:15')).toEqual({ zahl: '08:15', einheit: '' });
    expect(zerlege('1:02:33')).toEqual({ zahl: '1:02:33', einheit: '' });
  });

  it('nimmt das Komma so gut wie den Punkt', () => {
    expect(zerlege('21,5 °C').zahl).toBe('21,5');
  });

  it('nimmt Minuszeichen mit', () => {
    // Sonst stünde «-» klein neben einer grossen «3» - und aus minus
    // drei Grad würde optisch drei Grad.
    expect(zerlege('-3 °C')).toEqual({ zahl: '-3', einheit: '°C' });
  });

  it('reisst nichts auseinander, was keine Zahl ist', () => {
    // Lieber ein Wert ohne die feine Trennung als einer, bei dem
    // «Wohn» gross und «zimmer» klein dasteht.
    expect(zerlege('Wohnzimmer')).toEqual({ zahl: 'Wohnzimmer', einheit: '' });
    expect(zerlege('')).toEqual({ zahl: '', einheit: '' });
  });
});

describe('angeklebt', () => {
  it('klebt Prozent und Grad an, alles andere nicht', () => {
    // Duden: «63%», aber «21 °C».
    expect(angeklebt('%')).toBe(true);
    expect(angeklebt('°')).toBe(true);
    expect(angeklebt('°C')).toBe(false);
    expect(angeklebt('W')).toBe(false);
  });
});
