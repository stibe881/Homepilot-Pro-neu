import { faelltAuf, standZeile } from './kachelstand';

describe('standZeile', () => {
  it('nennt den Raum auch dann, wenn keiner gesetzt ist', () => {
    // «Kein Raum» ist die Auskunft, wegen der man den Anpassen-Modus
    // überhaupt öffnet.
    expect(standZeile({})).toBe('Kein Raum');
  });

  it('schweigt zur fehlenden Gruppe', () => {
    // Sie stünde sonst auf jeder der vierzig Kacheln – und auf einer
    // halbbreiten wäre die Zeile schon nach dem Raum abgeschnitten.
    expect(standZeile({ room: 'Büro' })).toBe('Büro');
  });

  it('nennt sie beim Namen, wo sie stehen', () => {
    expect(standZeile({ room: 'Büro', group: 'Deckenlicht' })).toBe(
      'Büro · Deckenlicht'
    );
  });

  it('behandelt leere Zeichenketten wie fehlende', () => {
    expect(standZeile({ room: '  ', group: '' })).toBe('Kein Raum');
  });

  it('hängt nur an, was gesetzt ist', () => {
    expect(standZeile({ room: 'Büro', favorite: true, locked: true })).toBe(
      'Büro · Favorit · Rückfrage'
    );
  });

  it('schweigt zu allem, was aus ist', () => {
    const zeile = standZeile({
      room: 'Büro',
      group: 'A',
      favorite: false,
      hidden: false,
      locked: false,
      ungezaehlt: false,
    });
    expect(zeile).toBe('Büro · A');
  });

  it('nennt jede Abweichung in fester Reihenfolge', () => {
    expect(
      standZeile({ favorite: true, hidden: true, locked: true, ungezaehlt: true })
    ).toBe('Kein Raum · Favorit · versteckt · Rückfrage · zählt nicht');
  });
});

describe('faelltAuf', () => {
  it('ist ruhig, solange nur Raum und Gruppe stehen', () => {
    expect(faelltAuf({ room: 'Büro', group: 'A' })).toBe(false);
    expect(faelltAuf({})).toBe(false);
  });

  it('meldet jede gesetzte Eigenschaft', () => {
    expect(faelltAuf({ favorite: true })).toBe(true);
    expect(faelltAuf({ hidden: true })).toBe(true);
    expect(faelltAuf({ locked: true })).toBe(true);
    expect(faelltAuf({ ungezaehlt: true })).toBe(true);
  });
});
