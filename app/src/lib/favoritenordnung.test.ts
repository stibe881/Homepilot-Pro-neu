import { DURCHSAGE_ID, favoritenOrdnen } from './favoritenordnung';

const k = (id: string) => ({ id });

describe('Favoriten ordnen', () => {
  it('folgt der gespeicherten Reihenfolge', () => {
    const kacheln = [k('a'), k('b'), k('c')];
    expect(favoritenOrdnen(kacheln, ['c', 'a', 'b']).map((x) => x.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  /**
   * Neu Gesterntes soll die gewachsene Reihung nicht durcheinander-
   * bringen – es hängt sich hinten an.
   */
  it('hängt Unbekanntes hinten an, in ursprünglicher Ordnung', () => {
    const kacheln = [k('neu1'), k('a'), k('neu2')];
    expect(favoritenOrdnen(kacheln, ['a']).map((x) => x.id)).toEqual([
      'a',
      'neu1',
      'neu2',
    ]);
  });

  it('übergeht Kennungen ohne Kachel – ein entsterntes Gerät lässt keine Lücke', () => {
    expect(favoritenOrdnen([k('a'), k('b')], ['weg', 'b', 'a']).map((x) => x.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('ohne Reihenfolge bleibt alles, wie es kam', () => {
    const kacheln = [k('a'), k('b')];
    expect(favoritenOrdnen(kacheln, null).map((x) => x.id)).toEqual(['a', 'b']);
    expect(favoritenOrdnen(kacheln, []).map((x) => x.id)).toEqual(['a', 'b']);
  });

  /**
   * Der gemeldete Fall: «Durchsagen kann man nicht sortieren bei den
   * Favoriten.» Sie ist jetzt eine Kachel wie jede andere.
   */
  it('sortiert die Durchsage mit', () => {
    const kacheln = [k('licht.a'), k(DURCHSAGE_ID), k('licht.b')];
    expect(
      favoritenOrdnen(kacheln, [DURCHSAGE_ID, 'licht.b', 'licht.a']).map((x) => x.id)
    ).toEqual([DURCHSAGE_ID, 'licht.b', 'licht.a']);
  });

  it('lässt sie ohne eigene Reihenfolge hinten stehen', () => {
    // Von Haus aus zuletzt: Die Favoriten sind persönlich gewählt, die
    // Durchsage steht immer da.
    const kacheln = [k('licht.a'), k('licht.b'), k(DURCHSAGE_ID)];
    expect(favoritenOrdnen(kacheln, ['licht.b', 'licht.a']).map((x) => x.id)).toEqual([
      'licht.b',
      'licht.a',
      DURCHSAGE_ID,
    ]);
  });

  it('die Kennung kann mit keiner Entität kollidieren', () => {
    // Entitätskennungen heissen «integration.objekt» und haben nie
    // einen Doppelpunkt.
    expect(DURCHSAGE_ID).toContain(':');
  });
});
