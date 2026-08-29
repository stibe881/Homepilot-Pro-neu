import { zielArt, zielMitArt, zielWert } from './entwurf';

describe('Das Ziel einer Nachricht', () => {
  it('teilt Art und Wert', () => {
    expect(zielArt('raum:Küche')).toBe('raum');
    expect(zielWert('raum:Küche')).toBe('Küche');
  });

  it('kommt mit Arten ohne Wert zurecht', () => {
    expect(zielArt('sorgen')).toBe('sorgen');
    expect(zielWert('sorgen')).toBe('');
  });

  it('lässt einen Raumnamen mit Doppelpunkt heil', () => {
    expect(zielWert('raum:Keller: hinten')).toBe('Keller: hinten');
  });

  it('behält den Wert, wenn dieselbe Art nochmal gewählt wird', () => {
    // Sonst verliert ein Fehlgriff die halbe Eingabe.
    expect(zielMitArt('raum:Küche', 'raum')).toBe('raum:Küche');
  });

  it('wirft den Wert weg, wenn die Art wechselt', () => {
    expect(zielMitArt('raum:Küche', 'geraet')).toBe('geraet:');
  });

  it('macht aus Arten ohne Wert keinen leeren Doppelpunkt', () => {
    expect(zielMitArt('raum:Küche', 'start')).toBe('start');
    expect(zielMitArt('', 'sorgen')).toBe('sorgen');
  });

  it('leer bleibt leer', () => {
    expect(zielMitArt('raum:Küche', '')).toBe('');
    expect(zielArt('')).toBe('');
  });
});
