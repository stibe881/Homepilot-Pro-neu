/** Das Fundbüro: Wo liegt der Schlüssel? */

import { fundstuecke, vorZeit } from './fundbuero';

const JETZT = 1_000_000;

function tag(id: string, label: string, state: Record<string, unknown>) {
  return { id: `bletags.${id}`, label, kind: 'sensor', state };
}

describe('fundstuecke', () => {
  it('nimmt nur die anhaenger und sagt raum samt abstand', () => {
    const zeilen = fundstuecke(
      [
        tag('schluessel', 'Schlüsselbund', { state: 'Flur', room: 'Flur', distance: 1.5 }),
        { id: 'hue.licht', label: 'Licht', kind: 'light', state: {} },
      ],
      JETZT
    );
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0].zeile).toBe('Flur · 1.5 m');
    expect(zeilen[0].daheim).toBe(true);
  });

  it('weg heisst nicht spurlos - die letzte spur steht dabei', () => {
    const zeilen = fundstuecke(
      [
        tag('rucksack', 'Rucksack', {
          state: 'weg',
          room: null,
          last_room: 'Büro',
          last_seen_at: JETZT - 2 * 3600,
        }),
      ],
      JETZT
    );
    expect(zeilen[0].zeile).toBe('Weg - zuletzt: Büro, vor 2 Std');
    expect(zeilen[0].daheim).toBe(false);
  });

  it('was daheim ist steht zuoberst, der rest alphabetisch', () => {
    const zeilen = fundstuecke(
      [
        tag('b', 'Bello', { state: 'weg', room: null, last_room: 'Flur', last_seen_at: JETZT - 60 }),
        tag('a', 'Anhänger', { state: 'weg', room: null, last_room: 'Flur', last_seen_at: JETZT - 60 }),
        tag('k', 'Klaviatur', { state: 'Küche', room: 'Küche', distance: 0.8 }),
      ],
      JETZT
    );
    expect(zeilen.map((zeile) => zeile.name)).toEqual(['Klaviatur', 'Anhänger', 'Bello']);
  });

  it('ein nie gehoerter anhaenger sagt das - statt «weg» zu behaupten', () => {
    const zeilen = fundstuecke([tag('neu', 'Neu', { state: 'weg', room: null })], JETZT);
    expect(zeilen[0].zeile).toContain('Noch nie gehört');
  });
});

describe('vorZeit', () => {
  it('waehlt die einheit nach der groesse', () => {
    expect(vorZeit(30)).toBe('gerade eben');
    expect(vorZeit(10 * 60)).toBe('vor 10 Min');
    expect(vorZeit(5 * 3600)).toBe('vor 5 Std');
    expect(vorZeit(3 * 86400)).toBe('vor 3 Tagen');
  });
});
