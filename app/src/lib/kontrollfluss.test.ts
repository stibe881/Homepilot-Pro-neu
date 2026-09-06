/**
 * «Wenn …», «Wiederholen» und die neuen Auslöser als Sätze und Grenzen.
 *
 * Die Tests prüfen genau die Stellen, an denen der Editor sonst etwas
 * verspräche, das der Hub nicht hält: die 50er-Grenze, das «leer heisst
 * immer» und die Wortwahl, die zum Ortsauslöser passen muss.
 */
import {
  REPEAT_LIMIT,
  begrenzteAnzahl,
  personWort,
  presenceSatz,
  warnstufeWort,
  wennKurz,
  wennSchrittSatz,
  wetterwarnungSatz,
  wiederholenKurz,
  wiederholenSatz,
} from './kontrollfluss';

describe('begrenzteAnzahl', () => {
  it('deckelt bei der harten Grenze des Hubs', () => {
    expect(begrenzteAnzahl(200, 3)).toBe(REPEAT_LIMIT);
    expect(begrenzteAnzahl(50, 3)).toBe(50);
    expect(begrenzteAnzahl(7, 3)).toBe(7);
  });

  it('macht aus Leerem und Unsinn die Vorgabe, nicht 0', () => {
    // 0 Durchgänge sähen im Editor fertig aus und täten nichts – der
    // stillste aller Fehler.
    expect(begrenzteAnzahl('', 3)).toBe(3);
    expect(begrenzteAnzahl(undefined, 10)).toBe(10);
    expect(begrenzteAnzahl('abc', 3)).toBe(3);
    expect(begrenzteAnzahl(0, 3)).toBe(3);
    expect(begrenzteAnzahl(-5, 3)).toBe(3);
  });
});

describe('presenceSatz', () => {
  it('spricht wie der Ortsauslöser', () => {
    expect(presenceSatz('livia', 'arrives')).toBe('Livia kommt heim');
    expect(presenceSatz('livia', 'leaves')).toBe('Livia geht weg');
    expect(presenceSatz('livia', 'arrives', 'schule')).toBe(
      'Livia kommt bei Schule an'
    );
    expect(presenceSatz('livia', 'leaves', 'schule_zell')).toBe(
      'Livia verlässt Schule Zell'
    );
  });

  it('versteht die Schreibweisen, die auch der Hub versteht', () => {
    expect(presenceSatz('geofence.livia', 'leave')).toBe('Livia geht weg');
    // Ein getippter Name bleibt, wie er ist.
    expect(presenceSatz('Livia Gross', 'arrives')).toBe('Livia Gross kommt heim');
  });

  it('lässt bei fehlender Person ein ehrliches Fragezeichen stehen', () => {
    expect(presenceSatz('', 'arrives')).toBe('? kommt heim');
  });
});

describe('wetterwarnungSatz', () => {
  it('nennt die Schwelle auf Deutsch', () => {
    expect(wetterwarnungSatz('Severe')).toBe(
      'eine neue Wetterwarnung eintrifft (ab «schwer»)'
    );
    expect(wetterwarnungSatz('')).toBe('eine neue Wetterwarnung eintrifft');
  });

  it('lässt eine unbekannte Stufe wörtlich stehen', () => {
    // Dieselbe Haltung wie bei den Platzhaltern: lesbar falsch schlägt
    // stumm weg.
    expect(warnstufeWort('Sturm')).toBe('Sturm');
  });
});

describe('wennSchrittSatz', () => {
  it('verknüpft nach match und hängt den sonst-Zweig an', () => {
    expect(
      wennSchrittSatz(['dunkel', 'jemand da'], 'any', ['Licht Flur ein'], [])
    ).toBe('wenn dunkel oder jemand da: Licht Flur ein');
    expect(
      wennSchrittSatz(['dunkel'], 'all', ['Licht ein'], ['Nachricht'])
    ).toBe('wenn dunkel: Licht ein; sonst Nachricht');
  });

  it('sagt «immer» und «nichts», statt Leeres zu verschweigen', () => {
    // Leer heisst beim Hub «gilt» – wer das liest, merkt, dass die
    // Bedingung noch fehlt.
    expect(wennSchrittSatz([], 'all', [], [])).toBe('wenn immer: nichts');
  });
});

describe('wiederholenSatz', () => {
  it('zählt die feste Anzahl', () => {
    expect(wiederholenSatz({ count: 3 }, ['Lampe ein', 'Lampe aus'])).toBe(
      '3× Lampe ein, Lampe aus'
    );
  });

  it('nennt bei solange immer die Obergrenze', () => {
    expect(
      wiederholenSatz({ while: ['Türe ist offen'], max: 10 }, ['Durchsage'])
    ).toBe('solange Türe ist offen: Durchsage (höchstens 10×)');
    // Ohne eigene max-Angabe gilt die harte Grenze des Hubs.
    expect(
      wiederholenSatz({ while: ['Türe ist offen'] }, ['Durchsage'])
    ).toBe(`solange Türe ist offen: Durchsage (höchstens ${REPEAT_LIMIT}×)`);
  });
});

describe('Listenzeile', () => {
  it('fasst die Zweige zusammen', () => {
    expect(wennKurz({ then: [{}, {}], else: [{}] })).toBe(
      'verzweigt (2 dann / 1 sonst)'
    );
    expect(wennKurz({ then: [{}] })).toBe('verzweigt (1 Schritt)');
    expect(wiederholenKurz({ count: 3 })).toBe('wiederholt 3×');
    expect(wiederholenKurz({ while: [] })).toBe('wiederholt nach Bedingung');
  });
});

describe('personWort', () => {
  it('macht aus Kennungen Namen', () => {
    expect(personWort('livia')).toBe('Livia');
    expect(personWort('geofence.stefan')).toBe('Stefan');
    expect(personWort('livia_gross')).toBe('Livia Gross');
  });
});
