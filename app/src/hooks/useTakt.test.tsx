/**
 * Der Takt, der im Hintergrund schweigt.
 *
 * Genau die zwei Eigenschaften, für die es den Hook gibt: Im Hintergrund
 * hört er auf zu schlagen, und beim Zurückkommen schlägt er sofort einmal.
 */
import React from 'react';
import { AppState } from 'react-native';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { useTakt } from './useTakt';

function Probe({ tick }: { tick: () => void }) {
  useTakt(tick, 1000);
  return null;
}

describe('useTakt', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('schlägt im Takt, schweigt im Hintergrund und holt beim Aufwachen nach', () => {
    // Den AppState-Horcher abfangen, um Vorder-/Hintergrund zu spielen.
    let horcher: ((next: string) => void) | null = null;
    const sub = { remove: jest.fn() };
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _typ: string,
      handler: (next: string) => void
    ) => {
      horcher = handler;
      return sub;
    }) as unknown as typeof AppState.addEventListener);

    const tick = jest.fn();
    let baum!: ReactTestRenderer;
    act(() => {
      baum = renderer.create(<Probe tick={tick} />);
    });

    act(() => jest.advanceTimersByTime(3000));
    expect(tick).toHaveBeenCalledTimes(3);

    // In den Hintergrund: der Takt schweigt.
    act(() => horcher!('background'));
    act(() => jest.advanceTimersByTime(5000));
    expect(tick).toHaveBeenCalledTimes(3);

    // Zurück: sofort einmal, dann wieder im Takt.
    act(() => horcher!('active'));
    expect(tick).toHaveBeenCalledTimes(4);
    act(() => jest.advanceTimersByTime(2000));
    expect(tick).toHaveBeenCalledTimes(6);

    // Beim Aushängen bleibt nichts zurück.
    act(() => baum.unmount());
    expect(sub.remove).toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(5000));
    expect(tick).toHaveBeenCalledTimes(6);
  });
});
