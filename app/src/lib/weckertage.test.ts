import { tageSatz } from './weckertage';

describe('tageSatz', () => {
  it('fasst die üblichen Muster zusammen', () => {
    // Sieben Tage aufzuzählen liest niemand.
    expect(tageSatz([0, 1, 2, 3, 4, 5, 6])).toBe('täglich');
    expect(tageSatz([0, 1, 2, 3, 4])).toBe('Mo–Fr');
    expect(tageSatz([5, 6])).toBe('am Wochenende');
  });

  it('zählt auf, wo es kein Muster gibt', () => {
    expect(tageSatz([1, 3])).toBe('Di, Do');
  });

  it('verträgt Doppelte und ungeordnete Eingaben', () => {
    expect(tageSatz([4, 0, 0])).toBe('Mo, Fr');
  });
});
