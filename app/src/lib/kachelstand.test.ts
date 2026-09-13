import { absageSatz, faelltAuf, standZeile, unbestaetigtZeile, zurueckgesetzt } from './kachelstand';

// Punkt 580 der Werkbank: Nach «Das Gerät antwortet nicht» behauptete
// die Kachel weiter den Wunschzustand - eine Homematic-Lampe mit
// Funk-Timeout stand als «an» am Wandpanel, obwohl sie aus war.
describe('zurueckgesetzt', () => {
  const lampe = { id: 'hm.lampe', state: { state: 'on', brightness: 80 } };

  it('holt den Stand von vor dem Tippen zurück und kennzeichnet ihn', () => {
    const zurueck = zurueckgesetzt(lampe, { state: 'off', brightness: 0 });
    expect(zurueck.state).toEqual({ state: 'off', brightness: 0 });
    expect(zurueck.unbestaetigt).toBe(true);
    // Das Original bleibt, wie es war - der Hub-Stand wird nie verändert.
    expect(lampe.state.state).toBe('on');
  });

  it('kennzeichnet auch ohne bekannten Stand von vorher', () => {
    // Ein Befehl ohne Wunschzustand (etwa «Szene auslösen») hat nichts
    // zurückzudrehen - aber dass er scheiterte, soll man sehen.
    const zurueck = zurueckgesetzt(lampe, undefined);
    expect(zurueck.state).toEqual(lampe.state);
    expect(zurueck.unbestaetigt).toBe(true);
  });
});

describe('unbestaetigtZeile', () => {
  it('hängt die Marke an den Wert, wie «Stand 17:42» aus Punkt 271', () => {
    expect(unbestaetigtZeile('An')).toBe('An · unbestätigt');
    expect(unbestaetigtZeile('')).toBe('unbestätigt');
    expect(unbestaetigtZeile(null)).toBe('unbestätigt');
  });
});

describe('absageSatz', () => {
  it('nennt das Gerät - wer drei Kacheln getippt hat, weiss sonst nicht, welche', () => {
    expect(absageSatz('Licht Küche', null)).toBe('Licht Küche antwortet nicht');
    expect(absageSatz('Haustüre', 'Dafür fehlt dir die Berechtigung')).toBe(
      'Haustüre: Dafür fehlt dir die Berechtigung'
    );
  });

  it('bleibt ohne Namen lesbar', () => {
    expect(absageSatz(undefined, null)).toBe('Das Gerät antwortet nicht');
  });
});

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
