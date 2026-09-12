import { format } from './teile';

describe('format', () => {
  it('rundet Zahlen auf eine Nachkommastelle', () => {
    expect(format(21.47)).toBe('21.5');
    expect(format(21)).toBe('21');
  });

  it('macht aus dem Platzhalter des Hubs einen Strich', () => {
    // Der Hub setzt `unknown`, bis ein frisch angelerntes Gerät sich
    // zum ersten Mal meldet. Auf der Kachel stand das in grossen
    // Buchstaben - vier Klimafühler lang sah das aus wie ein Defekt.
    expect(format('unknown')).toBe('–');
    expect(format('unavailable')).toBe('–');
    expect(format(null)).toBe('–');
    expect(format('')).toBe('–');
  });

  it('lässt einen echten Fehlerwert stehen', () => {
    // Der ist die Wahrheit und man kann danach suchen.
    expect(format('error')).toBe('error');
    expect(format('offline')).toBe('offline');
  });
});
