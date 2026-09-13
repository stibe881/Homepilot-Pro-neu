/**
 * Der eine Weg zu «Bewegung reduzieren» (Fehler aus der Runde 579).
 *
 * Der Fall: Archiv 527 versprach, wer die Einstellung hat, bekomme den
 * Sprung statt der Überblendung. Der Zustandspunkt fragte nie nach, der
 * Lauftext auf eigenem Weg. Jetzt fragen alle hier - und der Hook merkt
 * es auch, wenn die Einstellung bei offener App umgelegt wird.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { useBewegungReduziert } from './useBewegungReduziert';

function Probe({ melde }: { melde: (ruhig: boolean) => void }) {
  melde(useBewegungReduziert());
  return null;
}

describe('useBewegungReduziert', () => {
  afterEach(() => jest.restoreAllMocks());

  it('meldet die Einstellung und hört auf ihre Änderung', async () => {
    let horcher: ((ruhig: boolean) => void) | null = null;
    const abmelden = jest.fn();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
      _ereignis: string,
      handler: (ruhig: boolean) => void
    ) => {
      horcher = handler;
      return { remove: abmelden };
    }) as unknown as typeof AccessibilityInfo.addEventListener);

    const gemeldet: boolean[] = [];
    let baum: ReactTestRenderer | undefined;
    await act(async () => {
      baum = renderer.create(<Probe melde={(ruhig) => gemeldet.push(ruhig)} />);
    });
    expect(gemeldet[gemeldet.length - 1]).toBe(true);

    await act(async () => {
      horcher?.(false);
    });
    expect(gemeldet[gemeldet.length - 1]).toBe(false);

    act(() => baum?.unmount());
    expect(abmelden).toHaveBeenCalled();
  });

  it('animiert normal, wenn sich die Einstellung nicht abfragen lässt', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockRejectedValue(new Error('web'));
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockReturnValue({ remove: () => {} } as ReturnType<typeof AccessibilityInfo.addEventListener>);
    const gemeldet: boolean[] = [];
    await act(async () => {
      renderer.create(<Probe melde={(ruhig) => gemeldet.push(ruhig)} />);
    });
    expect(gemeldet[gemeldet.length - 1]).toBe(false);
  });
});
