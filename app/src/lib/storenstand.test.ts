import { herkunftText, positionText, storenstand } from './storenstand';

describe('Was auf der Storen-Kachel steht', () => {
  it('nimmt die Zahl, wenn es eine gibt', () => {
    expect(storenstand({ position: 0 })).toEqual({
      position: 0,
      text: 'Geschlossen',
      angenommen: false,
    });
    expect(storenstand({ position: 100 }).text).toBe('Offen');
    expect(storenstand({ position: 40 }).text).toBe('40% offen');
  });

  it('fängt Zahlen ausserhalb der Skala ein', () => {
    expect(storenstand({ position: 140 }).position).toBe(100);
    expect(storenstand({ position: -5 }).position).toBe(0);
  });

  it('nimmt das Wort, wenn die Zahl fehlt', () => {
    expect(storenstand({ state: 'closed' }).text).toBe('Geschlossen');
    expect(storenstand({ state: 'open' }).text).toBe('Offen');
    expect(storenstand({ state: 'partial' }).text).toBe('Halb offen');
  });

  /**
   * Der gemeldete Fehler: «Die Storen haben den Status offen, obwohl
   * sie geschlossen sind.» Vorher wurde alles Unbekannte zu 100.
   */
  it('gibt zu, wenn es nichts weiss – statt «Offen» zu behaupten', () => {
    expect(storenstand({ state: 'unknown' })).toEqual({
      position: null,
      text: 'Stand unbekannt',
      angenommen: false,
    });
    expect(storenstand({})).toEqual({
      position: null,
      text: 'Stand unbekannt',
      angenommen: false,
    });
  });

  it('sagt dazu, wenn die Angabe nur der letzte Befehl ist', () => {
    const stand = storenstand({ position: 0, state: 'closed', angenommen: true });
    expect(stand.angenommen).toBe(true);
    expect(herkunftText(stand)).toMatch(/Angenommen/);
  });

  it('sagt bei einer meldenden Store gar nichts dazu', () => {
    expect(herkunftText(storenstand({ position: 0 }))).toBeNull();
  });

  it('erklärt das Unbekannte, statt es unkommentiert stehen zu lassen', () => {
    expect(herkunftText(storenstand({}))).toMatch(/meldet ihren Stand nicht/);
  });

  it('positionText für sich', () => {
    expect(positionText(0)).toBe('Geschlossen');
    expect(positionText(1)).toBe('Geschlossen');
    expect(positionText(99)).toBe('Offen');
    expect(positionText(55)).toBe('55% offen');
  });
});
