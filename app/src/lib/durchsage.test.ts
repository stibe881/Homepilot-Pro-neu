import {
  HOECHSTENS_GEMERKT,
  HOECHSTENS_TEXTE,
  STANDARDTEXTE,
  ZIEL_ALLE,
  bestaetigung,
  boxen,
  gueltigesZiel,
  merken,
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
  it('liefert ohne Gemerktes die mitgelieferten Sätze', () => {
    expect(vorschlaege(undefined)).toEqual([...STANDARDTEXTE]);
  });

  it('stellt Selbstgetipptes voran', () => {
    expect(vorschlaege(['Der Znüni steht bereit'])[0]).toBe('Der Znüni steht bereit');
  });

  it('zeigt einen Satz nicht zweimal, auch nicht anders geschrieben', () => {
    const liste = vorschlaege(['essen ist FERTIG!']);
    const treffer = liste.filter((t) => t.toLowerCase() === 'essen ist fertig!');
    expect(treffer).toHaveLength(1);
    expect(liste[0]).toBe('essen ist FERTIG!');
  });

  it('überschreitet die Höchstzahl nicht', () => {
    const viele = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    expect(vorschlaege(viele)).toHaveLength(HOECHSTENS_TEXTE);
  });

  it('wirft leere Einträge weg', () => {
    expect(vorschlaege(['   ', ''])).toEqual([...STANDARDTEXTE]);
  });
});

describe('merken', () => {
  it('merkt sich einen selbst getippten Satz', () => {
    expect(merken([], 'Paket ist da')).toEqual(['Paket ist da']);
  });

  it('merkt sich keinen mitgelieferten Satz', () => {
    // Sonst verdrängten die sechs Standardsätze genau das, wofür die
    // Merkliste da ist.
    expect(merken(['Paket ist da'], 'Essen ist fertig!')).toBeNull();
  });

  it('merkt sich nichts Leeres', () => {
    expect(merken([], '   ')).toBeNull();
  });

  it('holt einen schon gemerkten Satz nach vorn, statt ihn zu doppeln', () => {
    expect(merken(['A', 'B', 'C'], 'C')).toEqual(['C', 'A', 'B']);
  });

  it('behält nur die letzten paar', () => {
    const voll = ['A', 'B', 'C', 'D', 'E'];
    const raus = merken(voll, 'Neu');
    expect(raus).toHaveLength(HOECHSTENS_GEMERKT);
    expect(raus?.[0]).toBe('Neu');
  });

  it('schneidet Ränder ab', () => {
    expect(merken([], '  Paket ist da  ')).toEqual(['Paket ist da']);
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
