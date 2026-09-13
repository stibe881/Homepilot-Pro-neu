import { letzteOeffnung } from './schlossprotokoll';

// 13. September 2026, 15:42 Ortszeit - als Unix-Sekunden, wie der Hub sie schickt.
const at = new Date(2026, 8, 13, 15, 42).getTime() / 1000;
const jetzt = new Date(2026, 8, 13, 16, 0).getTime();

describe('letzteOeffnung', () => {
  it('sagt wer, womit und wann', () => {
    expect(
      letzteOeffnung({ state: 'unlocked', last_unlock: { by: 'Livia', via: 'Code', at } }, jetzt)
    ).toBe('Livia (Code) · 15:42');
  });

  it('stellt «Zuletzt» davor, wenn die Türe wieder zu ist', () => {
    // Sonst stünde «Livia (Code) · 15:42» unter «Abgeschlossen» wie ein Widerspruch.
    expect(
      letzteOeffnung({ state: 'locked', last_unlock: { by: 'Livia', via: 'Code', at } }, jetzt)
    ).toBe('Zuletzt: Livia (Code) · 15:42');
  });

  it('nennt das Datum, wenn es nicht heute war', () => {
    const uebermorgen = new Date(2026, 8, 15, 9, 0).getTime();
    expect(
      letzteOeffnung({ state: 'unlocked', last_unlock: { by: 'Livia', via: 'Code', at } }, uebermorgen)
    ).toBe('Livia (Code) · 13.9. 15:42');
  });

  it('kommt ohne Namen, Weg und Zeit aus', () => {
    expect(letzteOeffnung({ state: 'unlocked', last_unlock: { by: '', via: 'unbekannt' } }, jetzt)).toBe(
      'Jemand'
    );
  });

  it('schweigt, wenn der Hub nichts weiss', () => {
    // Ein älterer Hub oder ein Schloss ohne Protokoll: keine Zeile, kein Fehler.
    expect(letzteOeffnung({ state: 'unlocked' }, jetzt)).toBeNull();
    expect(letzteOeffnung({ state: 'unlocked', last_unlock: null }, jetzt)).toBeNull();
    expect(letzteOeffnung({ state: 'unlocked', last_unlock: 'Livia' }, jetzt)).toBeNull();
  });
});
