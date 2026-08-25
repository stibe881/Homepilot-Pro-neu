import { mayOpenDirectly } from './tuerbestaetigung';

describe('mayOpenDirectly', () => {
  it('lässt die Türe nur direkt auf, wenn es ausdrücklich so steht', () => {
    expect(mayOpenDirectly('open_door', false)).toBe(true);
    expect(mayOpenDirectly('unlatch', false)).toBe(true);
  });

  it('fragt, solange nichts eingestellt ist', () => {
    // Die Vorgabe ist das bisherige Verhalten: Wer nichts einstellt,
    // merkt von der Einstellung nichts. Eine verlorene Einstellung darf
    // die Türe nicht aufmachen.
    expect(mayOpenDirectly('open_door')).toBe(false);
    expect(mayOpenDirectly('unlatch', true)).toBe(false);
  });

  it('gilt nur fürs Öffnen', () => {
    // Aufschliessen ist nicht öffnen - und wo sonst eine Rückfrage
    // steht (Klingel-Bildschirm, gesperrte Kachel), bleibt sie stehen.
    for (const wert of [undefined, true, false]) {
      expect(mayOpenDirectly('unlock', wert)).toBe(false);
      expect(mayOpenDirectly('lock', wert)).toBe(false);
      expect(mayOpenDirectly('turn_on', wert)).toBe(false);
    }
  });
});
