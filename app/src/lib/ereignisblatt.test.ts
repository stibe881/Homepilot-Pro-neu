/** Das Ereignisblatt: vier Listen, eine Zeitleiste. */

import { blattWuerdig, blattZeilen } from './ereignisblatt';

describe('blattZeilen', () => {
  it('verwebt alles chronologisch - aelteste zuerst', () => {
    const zeilen = blattZeilen({
      verlauf: [{ kind: 'triggered', text: 'Alarm ausgelöst: Türe', by: '', at: 100 }],
      events: [
        { entity_id: 'hm.tuer', state: 'open', at: 95, source: { label: 'Gerät' } },
      ],
      devices: { 'hm.tuer': { name: 'Haustüre', kind: 'binary_sensor', room: 'Flur' } },
      bilder: [{ id: 'k1', name: 'Flur', anlass: 'alarm', at: 102 }],
      clips: [{ id: 'c1', name: 'Flur', at: 104 }],
    });
    expect(zeilen.map((zeile) => zeile.art)).toEqual(['geraet', 'alarm', 'bild', 'clip']);
    expect(zeilen[0].titel).toBe('Haustüre');
    expect(zeilen[0].unter).toBe('open · Gerät');
    expect(zeilen[1].hervor).toBe(true);
    expect(zeilen[2].kennung).toBe('k1');
    expect(zeilen[3].clipId).toBe('c1');
  });

  it('ein geraet ohne namen behaelt seine kennung', () => {
    const zeilen = blattZeilen({
      events: [{ entity_id: 'weg.geraet', state: 'off', at: 1 }],
    });
    expect(zeilen[0].titel).toBe('weg.geraet');
    expect(zeilen[0].unter).toBe('off');
  });

  it('leere antwort heisst leeres blatt - kein raten', () => {
    expect(blattZeilen({})).toEqual([]);
  });
});

describe('blattWuerdig', () => {
  it('nur die eintraege, hinter denen ein ereignis steckt', () => {
    expect(blattWuerdig('triggered')).toBe(true);
    expect(blattWuerdig('motion')).toBe(true);
    expect(blattWuerdig('armed')).toBe(false);
  });
});
