jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { sichtbareBereiche } from './Rail';

describe('sichtbareBereiche', () => {
  it('behält die feste Reihenfolge ohne eigene Ordnung', () => {
    expect(sichtbareBereiche([], ['cameras', 'settings'])).toEqual([
      'start',
      'home',
      'light',
      'covers',
      'family',
    ]);
  });

  it('folgt der selbst gezogenen Reihenfolge (Punkt 670)', () => {
    expect(
      sichtbareBereiche([], ['cameras', 'settings'], ['family', 'start'])
    ).toEqual(['family', 'start', 'home', 'light', 'covers']);
  });

  it('hängt neu sichtbar gewordene Reiter hinten an, statt sie zu verstecken', () => {
    // Wer eine Kamera einrichtet, nachdem die Reihenfolge schon gezogen
    // wurde, soll den neuen Reiter nicht verlieren.
    expect(
      sichtbareBereiche([], ['settings'], ['light', 'start'])
    ).toEqual(['light', 'start', 'home', 'covers', 'cameras', 'family']);
  });

  it('übergeht Kennungen aus der Reihenfolge, die ausgeblendet oder unbekannt sind', () => {
    expect(
      sichtbareBereiche([], ['light', 'cameras', 'settings'], ['light', 'weg', 'covers', 'start'])
    ).toEqual(['covers', 'start', 'home', 'family']);
  });
});
