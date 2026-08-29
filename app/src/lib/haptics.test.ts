import { darfSpueren, ZUSAMMEN_MS } from './haptics';

/**
 * Ein Tastendruck läuft durch zwei Stellen, die beide ein Spüren
 * auslösen wollen: die Taste selbst und das Absenden in `useHub`. Beide
 * haben für sich recht – zusammen fühlen sie sich matschig an und
 * verwischen den Unterschied zwischen feinem Ticken und schwerem Druck.
 */
describe('Zwei Impulse dicht hintereinander', () => {
  it('der erste kommt immer durch', () => {
    expect(darfSpueren(null, 1000)).toBe(true);
  });

  it('der zweite unmittelbar danach nicht', () => {
    expect(darfSpueren(1000, 1000)).toBe(false);
    expect(darfSpueren(1000, 1000 + ZUSAMMEN_MS - 1)).toBe(false);
  });

  /**
   * Wer wirklich zweimal drückt, soll es auch zweimal spüren – beim
   * Steuerkreuz drückt man in Serie durch ein Menü.
   */
  it('ein echter zweiter Druck schon', () => {
    expect(darfSpueren(1000, 1000 + ZUSAMMEN_MS)).toBe(true);
    expect(darfSpueren(1000, 1400)).toBe(true);
  });

  it('die Frist ist kurz genug für zügiges Drücken', () => {
    // 60 ms sind rund vier Bilder – schneller drückt niemand absichtlich.
    expect(ZUSAMMEN_MS).toBeLessThanOrEqual(100);
  });
});
