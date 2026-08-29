import {
  HOECHSTENS_EIGENE,
  STANDARDTEXTE,
  ZIEL_ALLE,
  bestaetigung,
  boxen,
  gueltigesZiel,
  nachDemSenden,
  saetze,
  satzAendern,
  satzHinzufuegen,
  satzLoeschen,
  sprecherFuer,
  standardZurueck,
  zielText,
  zieleFuer,
} from './durchsage';

const geraet = (
  id: string,
  name: string,
  commands: string[] = ['play_url'],
  available = true
) => ({ id, name, commands, available });

describe('saetze', () => {
  it('fängt mit den mitgelieferten an, solange niemand etwas geändert hat', () => {
    expect(saetze({})).toEqual([...STANDARDTEXTE]);
  });

  it('ist danach ganz die eigene Liste', () => {
    // Ein Startbestand, keine Grundausstattung: Wer die Liste anfasst,
    // bekommt sie ganz - auch wenn er alle mitgelieferten weggeworfen hat.
    expect(saetze({ texte: ['Bad ist frei'] })).toEqual(['Bad ist frei']);
  });

  it('bleibt leer, wenn jemand alles gelöscht hat', () => {
    // Zurückkommende Sätze wären dasselbe Ärgernis wie eine Kachel, die
    // man nicht ausgeblendet bekommt.
    expect(saetze({ texte: [] })).toEqual([]);
  });

  it('faltet den zuletzt getippten Satz vorne ein', () => {
    // Aus älteren Fassungen: Er lag in einem eigenen Feld und liess sich
    // nicht anfassen. Jetzt ist er eine Zeile wie jede andere.
    expect(saetze({ letzter: 'Znüni!', texte: ['Bad ist frei'] })).toEqual([
      'Znüni!',
      'Bad ist frei',
    ]);
  });

  it('zeigt einen Satz nicht zweimal, auch nicht anders geschrieben', () => {
    const liste = saetze({ letzter: 'essen ist FERTIG!' });
    const treffer = liste.filter((t) => t.toLowerCase() === 'essen ist fertig!');
    expect(treffer).toHaveLength(1);
    expect(liste[0]).toBe('essen ist FERTIG!');
  });

  it('wirft leere Einträge weg', () => {
    expect(saetze({ letzter: '   ', texte: [''] })).toEqual([]);
  });
});

describe('nachDemSenden', () => {
  it('nimmt einen selbst getippten Satz in die Liste auf', () => {
    // Vorher lag er in einem Feld, das genau einen Satz hielt und ihn
    // beim nächsten überschrieb - nicht löschbar, nur verdrängbar.
    const liste = nachDemSenden({ texte: ['A'] }, 'Paket ist da');
    expect(liste).toEqual(['A', 'Paket ist da']);
  });

  it('schreibt den Startbestand beim ersten Mal fest', () => {
    // Sonst bliebe die Liste flüchtig, und der neue Satz stünde allein
    // da, sobald jemand etwas anderes ändert.
    const liste = nachDemSenden({}, 'Essen ist fertig!');
    expect(liste).toEqual([...STANDARDTEXTE]);
  });

  it('tut nichts, wo es nichts zu tun gibt', () => {
    expect(nachDemSenden({ texte: ['A'] }, 'a')).toBeNull();
    expect(nachDemSenden({ texte: ['A'] }, '   ')).toBeNull();
  });

  it('schneidet Ränder ab', () => {
    expect(nachDemSenden({ texte: [] }, '  Paket ist da  ')).toEqual(['Paket ist da']);
  });
});

describe('standardZurueck', () => {
  it('holt zurück, was fehlt, und lässt Eigenes stehen', () => {
    const liste = standardZurueck({ texte: ['Bad ist frei'] });
    expect(liste[0]).toBe('Bad ist frei');
    for (const satz of STANDARDTEXTE) expect(liste).toContain(satz);
  });

  it('doppelt nichts, was schon dasteht', () => {
    const liste = standardZurueck({ texte: [...STANDARDTEXTE] });
    expect(liste).toEqual([...STANDARDTEXTE]);
  });
});

describe('eigene Liste pflegen', () => {
  it('hinzufügen hängt hinten an, ohne zu doppeln', () => {
    expect(satzHinzufuegen({ texte: ['A'] }, 'B')).toEqual(['A', 'B']);
    expect(satzHinzufuegen({ texte: ['A'] }, 'a')).toEqual(['A']);
    expect(satzHinzufuegen({ texte: [] }, '  Neu  ')).toEqual(['Neu']);
    expect(satzHinzufuegen({ texte: ['A'] }, '  ')).toEqual(['A']);
  });

  it('die Liste hat einen Deckel', () => {
    const voll = Array.from({ length: HOECHSTENS_EIGENE }, (_, i) => `Satz ${i}`);
    expect(satzHinzufuegen({ texte: voll }, 'Einer zu viel')).toHaveLength(
      HOECHSTENS_EIGENE
    );
  });

  it('bearbeiten ersetzt an Ort und Stelle', () => {
    expect(satzAendern({ texte: ['A', 'B', 'C'] }, 'B', 'Neu')).toEqual(['A', 'Neu', 'C']);
  });

  it('bearbeitet auch einen mitgelieferten Satz', () => {
    // Genau das ging nicht: Sie standen unveränderlich unter den eigenen.
    const liste = satzAendern({}, 'Gute Nacht!', 'Schlaf gut!');
    expect(liste).toContain('Schlaf gut!');
    expect(liste).not.toContain('Gute Nacht!');
    // Und der Rest steht noch da, an seinem Platz.
    expect(liste[0]).toBe(STANDARDTEXTE[0]);
  });

  it('bearbeiten mit Leerem ändert nichts - löschen ist der Papierkorb', () => {
    expect(satzAendern({ texte: ['A', 'B'] }, 'B', '  ')).toEqual(['A', 'B']);
  });

  it('löschen entfernt genau den Satz, egal wie geschrieben', () => {
    expect(satzLoeschen({ texte: ['A', 'B'] }, 'b')).toEqual(['A']);
    expect(satzLoeschen({ texte: [] }, 'x')).toEqual([]);
  });

  it('löscht auch einen mitgelieferten Satz', () => {
    const liste = satzLoeschen({}, 'Essen ist fertig!');
    expect(liste).not.toContain('Essen ist fertig!');
    expect(liste).toHaveLength(STANDARDTEXTE.length - 1);
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
