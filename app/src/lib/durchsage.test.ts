import {
  HOECHSTENS_EIGENE,
  HOECHSTENS_TEXTE,
  STANDARDTEXTE,
  ZIEL_ALLE,
  bestaetigung,
  boxen,
  eigeneSaetze,
  gueltigesZiel,
  merken,
  satzAendern,
  satzHinzufuegen,
  satzLoeschen,
  sprecherFuer,
  vorschlaege,
  zielText,
  zieleFuer,
} from './durchsage';

const geraet = (
  id: string,
  name: string,
  commands: string[] = ['play_url'],
  available = true
) => ({ id, name, commands, available });

describe('vorschlaege', () => {
  it('liefert ohne Eigenes die mitgelieferten Sätze', () => {
    expect(vorschlaege({})).toEqual([...STANDARDTEXTE]);
  });

  it('stellt Eigenes voran: erst der letzte, dann die Liste', () => {
    const liste = vorschlaege({ letzter: 'Znüni!', texte: ['Bad ist frei'] });
    expect(liste.slice(0, 2)).toEqual(['Znüni!', 'Bad ist frei']);
  });

  it('zeigt einen Satz nicht zweimal, auch nicht anders geschrieben', () => {
    const liste = vorschlaege({ letzter: 'essen ist FERTIG!' });
    const treffer = liste.filter((t) => t.toLowerCase() === 'essen ist fertig!');
    expect(treffer).toHaveLength(1);
    expect(liste[0]).toBe('essen ist FERTIG!');
  });

  it('zeigt die eigenen immer alle - die mitgelieferten weichen', () => {
    // Wer zwölf eigene Sätze pflegt, will sie alle sehen; gedeckelt
    // wird das Auffüllen, nicht die eigene Liste.
    const viele = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const liste = vorschlaege({ texte: viele });
    expect(liste.slice(0, viele.length)).toEqual(viele);
    expect(liste).toHaveLength(Math.max(HOECHSTENS_TEXTE, viele.length));
  });

  it('wirft leere Einträge weg', () => {
    expect(vorschlaege({ letzter: '   ', texte: [''] })).toEqual([...STANDARDTEXTE]);
  });
});

describe('eigeneSaetze', () => {
  it('führt den letzten getippten vor der gepflegten Liste', () => {
    expect(eigeneSaetze({ letzter: 'B', texte: ['A'] })).toEqual(['B', 'A']);
  });

  it('doppelt nicht, wenn der letzte schon in der Liste steht', () => {
    expect(eigeneSaetze({ letzter: 'a', texte: ['A'] })).toEqual(['a']);
  });
});

describe('merken', () => {
  it('merkt sich den zuletzt getippten Satz - genau einen', () => {
    // Vorher sammelten sich vier automatisch gemerkte an, die niemand
    // wieder loswurde: nicht bearbeitbar, nicht löschbar.
    expect(merken({}, 'Paket ist da')).toBe('Paket ist da');
  });

  it('merkt sich keinen mitgelieferten Satz', () => {
    expect(merken({}, 'Essen ist fertig!')).toBeNull();
  });

  it('merkt sich keinen, der schon in der eigenen Liste steht', () => {
    expect(merken({ texte: ['Paket ist da'] }, 'paket ist DA')).toBeNull();
  });

  it('merkt sich nichts Leeres', () => {
    expect(merken({}, '   ')).toBeNull();
  });

  it('schneidet Ränder ab', () => {
    expect(merken({}, '  Paket ist da  ')).toBe('Paket ist da');
  });
});

describe('eigene Liste pflegen', () => {
  it('hinzufügen hängt hinten an, ohne zu doppeln', () => {
    expect(satzHinzufuegen(['A'], 'B')).toEqual(['A', 'B']);
    expect(satzHinzufuegen(['A'], 'a')).toEqual(['A']);
    expect(satzHinzufuegen(undefined, '  Neu  ')).toEqual(['Neu']);
    expect(satzHinzufuegen(['A'], '  ')).toEqual(['A']);
  });

  it('die Liste hat einen Deckel', () => {
    const voll = Array.from({ length: HOECHSTENS_EIGENE }, (_, i) => `Satz ${i}`);
    expect(satzHinzufuegen(voll, 'Einer zu viel')).toHaveLength(HOECHSTENS_EIGENE);
  });

  it('bearbeiten ersetzt an Ort und Stelle', () => {
    expect(satzAendern(['A', 'B', 'C'], 'B', 'Neu')).toEqual(['A', 'Neu', 'C']);
  });

  it('bearbeiten mit Leerem ändert nichts - löschen ist der Papierkorb', () => {
    expect(satzAendern(['A', 'B'], 'B', '  ')).toEqual(['A', 'B']);
  });

  it('löschen entfernt genau den Satz, egal wie geschrieben', () => {
    expect(satzLoeschen(['A', 'B'], 'b')).toEqual(['A']);
    expect(satzLoeschen(undefined, 'x')).toEqual([]);
  });
});

describe('boxen', () => {
  it('nimmt nur, was eine Tondatei abspielen kann', () => {
    const liste = boxen([
      geraet('a', 'Küche'),
      geraet('b', 'Licht Flur', ['turn_on']),
    ]);
    expect(liste.map((b) => b.id)).toEqual(['a']);
  });

  it('lässt abgehängte Boxen weg', () => {
    const liste = boxen([geraet('a', 'Küche', ['play_url'], false)]);
    expect(liste).toEqual([]);
  });

  it('sortiert nach Namen statt nach Integrationsreihenfolge', () => {
    const liste = boxen([
      geraet('c', 'Wohnung'),
      geraet('a', 'Büro'),
      geraet('b', 'Nest Gäste WC'),
    ]);
    expect(liste.map((b) => b.name)).toEqual(['Büro', 'Nest Gäste WC', 'Wohnung']);
  });
});

describe('zieleFuer', () => {
  it('stellt «Alle Boxen» voran', () => {
    const liste = zieleFuer([{ id: 'a', name: 'Küche' }]);
    expect(liste[0]).toEqual({ id: ZIEL_ALLE, name: 'Alle Boxen' });
    expect(liste).toHaveLength(2);
  });
});

describe('zielText', () => {
  const alle = [{ id: 'a', name: 'Küche' }];

  it('nennt die gewählte Box', () => {
    expect(zielText('a', alle)).toBe('Küche');
  });

  it('sagt «Alle Boxen», wo nichts gewählt ist', () => {
    expect(zielText('', alle)).toBe('Alle Boxen');
    expect(zielText(ZIEL_ALLE, alle)).toBe('Alle Boxen');
  });

  it('fällt bei einer verschwundenen Box auf «alle» zurück', () => {
    expect(zielText('weg', alle)).toBe('Alle Boxen');
  });
});

describe('gueltigesZiel', () => {
  const alle = [{ id: 'a', name: 'Küche' }];

  it('behält ein Ziel, das es noch gibt', () => {
    expect(gueltigesZiel('a', alle)).toBe('a');
  });

  it('vergisst eine Box, die aus dem Netz verschwunden ist', () => {
    expect(gueltigesZiel('weg', alle)).toBe(ZIEL_ALLE);
  });

  it('verträgt ein fehlendes Ziel', () => {
    expect(gueltigesZiel(undefined, alle)).toBe(ZIEL_ALLE);
  });
});

describe('sprecherFuer', () => {
  it('schickt bei «alle» eine leere Liste – so meint es der Hub', () => {
    expect(sprecherFuer(ZIEL_ALLE)).toEqual([]);
  });

  it('schickt sonst genau die eine Box', () => {
    expect(sprecherFuer('a')).toEqual(['a']);
  });
});

describe('bestaetigung', () => {
  it('nennt die eine Box beim Namen', () => {
    expect(bestaetigung({ sent: ['Küche'] })).toBe('Läuft auf Küche');
  });

  it('zählt bei mehreren', () => {
    expect(bestaetigung({ sent: ['Küche', 'Büro'] })).toBe('Läuft auf 2 Boxen');
  });

  it('verschweigt nicht, was nicht ankam', () => {
    expect(bestaetigung({ sent: ['Küche'], errors: ['Büro'] })).toBe(
      'Läuft auf Küche · nicht erreicht: Büro'
    );
  });

  it('sagt es, wenn gar nichts lief', () => {
    expect(bestaetigung({})).toBe('Keine Box erreicht');
  });
});
