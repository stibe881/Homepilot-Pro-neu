import { zonenkennung } from './zonenkennung';

describe('zonenkennung', () => {
  it('nimmt den Vornamen, klein geschrieben', () => {
    // So heissen die Zonen im Hub seit je.
    expect(zonenkennung('Bine')).toBe('bine');
    expect(zonenkennung('Stefan Gross')).toBe('stefan');
    expect(zonenkennung('  Livia  ')).toBe('livia');
  });

  it('rechnet dasselbe wie der Hub', () => {
    // Die Gegenprobe zu hub/tests/test_geofence.py - weicht eine Seite
    // ab, meldet das Telefon an eine Zone, die es nicht gibt.
    expect(zonenkennung('Björn')).toBe('bjoern');
    expect(zonenkennung('Müller')).toBe('mueller');
    expect(zonenkennung('Zoë')).toBe('zoe');
    expect(zonenkennung('Anne-Marie')).toBe('annemarie');
  });

  it('kommt mit Nichts zurecht', () => {
    expect(zonenkennung('')).toBe('');
    expect(zonenkennung(null)).toBe('');
    expect(zonenkennung(undefined)).toBe('');
    expect(zonenkennung('!!!')).toBe('');
  });
});
