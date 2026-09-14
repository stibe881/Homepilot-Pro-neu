import { WidgetButton } from './widgetButtons';
import {
  SYMBOLWAHL,
  ionicon,
  mitStil,
  stilAnwenden,
  stilLoeschen,
  stilSetzen,
} from './widgetstil';

const knopf: WidgetButton = {
  key: 'entity:nuki.wohnung',
  title: 'Smart Lock Pro',
  symbol: 'key.fill',
  url: 'homepilot://entity/nuki.wohnung',
};

describe('stilAnwenden', () => {
  it('nimmt den eigenen Namen und das eigene Symbol', () => {
    // Der gemeldete Fall: «Smart Lock Pro» neben «Haustüre», beide mit
    // demselben Schlüssel - und keine Auskunft, welches die Wohnungstüre
    // ist.
    const eigen = stilAnwenden(knopf, { name: 'Wohnung', symbol: 'house.fill' });
    expect(eigen.title).toBe('Wohnung');
    expect(eigen.symbol).toBe('house.fill');
  });

  it('lässt ungesetztes beim Gerät', () => {
    expect(stilAnwenden(knopf, { name: 'Wohnung' }).symbol).toBe('key.fill');
    expect(stilAnwenden(knopf, { symbol: 'house.fill' }).title).toBe('Smart Lock Pro');
    expect(stilAnwenden(knopf, undefined)).toBe(knopf);
    expect(stilAnwenden(knopf, {})).toBe(knopf);
  });

  it('kürzt den eigenen Namen wie jeden anderen', () => {
    // Im Widget ist die Zeile schmal - ein Name, der dort abgeschnitten
    // wird, hilft niemandem mehr als einer, der von Anfang an passt.
    expect(stilAnwenden(knopf, { name: 'Wohnungstüre unten links' }).title).toBe(
      'Wohnungstüre…'
    );
  });

  it('behandelt Leerzeichen wie nichts', () => {
    expect(stilAnwenden(knopf, { name: '   ' }).title).toBe('Smart Lock Pro');
  });
});

describe('mitStil', () => {
  it('legt die Stile über die ganze Liste', () => {
    const zweiter: WidgetButton = { ...knopf, key: 'scene:kino', title: 'Kino' };
    const liste = mitStil([knopf, zweiter], {
      'scene:kino': { symbol: 'film.fill' },
    });
    expect(liste[0]).toBe(knopf);
    expect(liste[1].symbol).toBe('film.fill');
  });

  it('kommt ohne Stile aus', () => {
    const liste = [knopf];
    expect(mitStil(liste, undefined)).toBe(liste);
  });
});

describe('stilSetzen', () => {
  it('merkt sich, was gesetzt wurde', () => {
    expect(stilSetzen({}, 'scene:kino', { name: 'Film' })).toEqual({
      'scene:kino': { name: 'Film' },
    });
  });

  it('ergänzt, statt das andere zu verlieren', () => {
    const stile = stilSetzen({ 'scene:kino': { name: 'Film' } }, 'scene:kino', {
      symbol: 'film.fill',
    });
    expect(stile['scene:kino']).toEqual({ name: 'Film', symbol: 'film.fill' });
  });

  it('räumt den Eintrag weg, wenn nichts Eigenes bleibt', () => {
    // Sonst sammelte die Einstellung leere Hüllen von Geräten, die es
    // längst nicht mehr gibt.
    const stile = stilSetzen({ 'scene:kino': { name: 'Film' } }, 'scene:kino', {
      name: '',
    });
    expect(stile).toEqual({});
  });

  it('lässt die anderen Knöpfe in Ruhe', () => {
    const stile = stilSetzen({ 'scene:kino': { name: 'Film' } }, 'door', {
      name: 'Wohnung',
    });
    expect(stile['scene:kino']).toEqual({ name: 'Film' });
  });
});

describe('stilLoeschen', () => {
  it('nimmt alles Eigene zurück', () => {
    expect(stilLoeschen({ door: { name: 'Wohnung' } }, 'door')).toEqual({});
    expect(stilLoeschen(undefined, 'door')).toEqual({});
  });
});

describe('ionicon', () => {
  it('kennt jedes Symbol aus der Wahl', () => {
    for (const eintrag of SYMBOLWAHL) {
      expect(ionicon(eintrag.sf)).toBe(eintrag.ionicon);
    }
  });

  it('findet auch für die Symbole der Gerätearten eines', () => {
    // resolveButton vergibt mehr Symbole, als zur Wahl stehen - ein
    // Knopf ohne Bild sähe in der Liste aus wie ein Fehler.
    expect(ionicon('lightbulb.fill')).toBe('bulb');
    expect(ionicon('lock.shield.fill')).toBe('key');
    expect(ionicon('square.grid.2x2.fill')).toBe('ellipse-outline');
  });
});
