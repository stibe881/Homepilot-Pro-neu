import { VERSUCHE_MS, tokenmeldungen } from './livetoken';

describe('tokenmeldungen', () => {
  it('meldet das Start-Token bei der Anmeldung an', () => {
    expect(
      tokenmeldungen([{ ereignis: 'onStartToken', token: 'abc', typ: 'haus' }])
    ).toEqual([
      { pfad: '/api/liveactivity/register', daten: { token: 'abc', typ: 'haus' } },
    ]);
  });

  it('meldet das Aktivitäts-Token samt Kartenart', () => {
    // Ohne die Art trifft der Hub die falsche Zeile - und die Karte,
    // die er beenden will, behält kein Token.
    expect(
      tokenmeldungen([
        { ereignis: 'onActivityToken', token: 'def', typ: 'haus', art: 'tv:androidtv.tv' },
      ])
    ).toEqual([
      {
        pfad: '/api/liveactivity/activity',
        daten: { token: 'def', art: 'tv:androidtv.tv' },
      },
    ]);
  });

  it('nimmt für die Türkarte den alten Standard', () => {
    // Sie kennt keine Art; der Hub erkennt sie genau daran.
    expect(tokenmeldungen([{ ereignis: 'onActivityToken', token: 'x' }])[0].daten).toEqual(
      { token: 'x', art: '' }
    );
    expect(tokenmeldungen([{ ereignis: 'onStartToken', token: 'x' }])[0].daten).toEqual({
      token: 'x',
      typ: 'tuer',
    });
  });

  it('lässt weg, was kein Token trägt', () => {
    // Eine leere Meldung träte beim Hub an die Stelle einer richtigen.
    expect(
      tokenmeldungen([
        { ereignis: 'onStartToken', token: '' },
        { ereignis: 'onStartToken' },
        { token: 'ohne Ereignis' },
      ])
    ).toEqual([]);
  });

  it('behält die Reihenfolge', () => {
    const meldungen = tokenmeldungen([
      { ereignis: 'onStartToken', token: 'eins' },
      { ereignis: 'onActivityToken', token: 'zwei' },
    ]);
    expect(meldungen.map((m) => m.daten.token)).toEqual(['eins', 'zwei']);
  });
});

describe('VERSUCHE_MS', () => {
  it('fängt sofort an und gibt nach einer halben Minute auf', () => {
    // Länger gibt iOS der kurz geweckten App ohnehin nicht.
    expect(VERSUCHE_MS[0]).toBe(0);
    expect(VERSUCHE_MS.reduce((a, b) => a + b, 0)).toBeLessThan(30_000);
  });
});
