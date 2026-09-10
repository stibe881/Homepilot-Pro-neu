/**
 * `allesZu()` macht wirklich alles zu – gezählt, nicht nachgelesen.
 *
 * Die Stelle, an der man sich verlässlich vergisst: Vierzehn Blätter,
 * und beim Bereichswechsel wurden sie von Hand aufgezählt. Wer ein
 * fünfzehntes baut, trägt es dort ein – oder eben nicht, und dann
 * bleibt es beim Wechsel offen liegen und deckt die neue Seite zu.
 *
 * Dieser Test macht der Reihe nach jedes Blatt auf, ruft `allesZu()`
 * und prüft, dass keines mehr offen ist. Er findet damit auch das
 * fünfzehnte, ohne dass jemand ihn dafür ändern muss – denn er zählt
 * über `etwasOffen`, nicht über eine zweite Liste, die derselben
 * Vergesslichkeit unterläge.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';

import { Blaetter, useBlaetter } from './blaetter';

/**
 * Den Haken auspacken, ohne eine Bibliothek dafür.
 *
 * `renderHook` gibt es hier nicht; ein Bauteil, das nichts zeichnet und
 * seinen Stand herausreicht, tut dasselbe in fünf Zeilen - und
 * react-test-renderer ist ohnehin schon da (Lauftext.test.tsx).
 */
function auspacken(): () => Blaetter {
  let stand: Blaetter | null = null;
  function Probe() {
    stand = useBlaetter();
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return () => stand as Blaetter;
}

/** Ein Gerät, wie die Erinnerung es braucht - mehr fragt sie nicht ab. */
const geraet = { id: 'demo.licht' } as never;

describe('useBlaetter', () => {
  it('beginnt mit nichts Offenem', () => {
    const stand = auspacken();
    expect(stand().etwasOffen).toBe(false);
  });

  it('macht jedes einzelne Blatt wieder zu', () => {
    const oeffner: [string, (b: Blaetter) => void][] = [
      ['fullscreen', (b) => b.setFullscreen('demo.kamera')],
      ['historyFor', (b) => b.setHistoryFor('demo.licht')],
      ['bildFuer', (b) => b.setBildFuer('Küche')],
      ['erinnernAn', (b) => b.setErinnernAn(geraet)],
      ['raumMenue', (b) => b.setRaumMenue(true)],
      ['wechselOffen', (b) => b.setWechselOffen(true)],
      ['reorderOpen', (b) => b.setReorderOpen(true)],
      ['roomsReorderOpen', (b) => b.setRoomsReorderOpen(true)],
      ['batterienOffen', (b) => b.setBatterienOffen(true)],
      ['sorgenOffen', (b) => b.setSorgenOffen(true)],
      ['hilfeOffen', (b) => b.setHilfeOffen(true)],
      ['seitenhilfe', (b) => b.setSeitenhilfe(true)],
      ['wandOffen', (b) => b.setWandOffen(true)],
      ['searchOpen', (b) => b.setSearchOpen(true)],
    ];

    for (const [name, oeffnen] of oeffner) {
      const stand = auspacken();
      act(() => oeffnen(stand()));
      expect([name, stand().etwasOffen]).toEqual([name, true]);
      act(() => stand().allesZu());
      expect([name, stand().etwasOffen]).toEqual([name, false]);
    }
  });

  it('macht auch alle auf einmal zu', () => {
    const stand = auspacken();
    act(() => {
      stand().setFullscreen('demo.kamera');
      stand().setSorgenOffen(true);
      stand().setSearchOpen(true);
    });
    expect(stand().etwasOffen).toBe(true);
    act(() => stand().allesZu());
    expect(stand().etwasOffen).toBe(false);
    expect(stand().fullscreen).toBeNull();
    expect(stand().sorgenOffen).toBe(false);
    expect(stand().searchOpen).toBe(false);
  });
});
