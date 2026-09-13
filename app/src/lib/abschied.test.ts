import { Abschied, loeschKnopf, loeschPfad, uebergabeMoeglich } from './abschied';

const antwort = (rest: Partial<Abschied>): Abschied => ({
  bilanz: {},
  bild: false,
  satz: 'Anna entfernen? An diesem Namen hängt sonst nichts.',
  uebernehmer: ['Levin', 'Lina'],
  ...rest,
});

describe('uebergabeMoeglich (Punkt 628)', () => {
  it('fragt nur, wenn Ämtli hängen und jemand sie nehmen kann', () => {
    expect(uebergabeMoeglich(null)).toBe(false);
    expect(uebergabeMoeglich(antwort({}))).toBe(false);
    expect(uebergabeMoeglich(antwort({ bilanz: { aemtli: 3 } }))).toBe(true);
    expect(uebergabeMoeglich(antwort({ bilanz: { aufgaben: 1 } }))).toBe(true);
    // Die Au-pair war die Letzte im Haus mit Zugang - niemand übrig.
    expect(uebergabeMoeglich(antwort({ bilanz: { aemtli: 3 }, uebernehmer: [] }))).toBe(false);
  });
});

describe('loeschKnopf', () => {
  it('sagt beim Drücken, wohin die Ämtli gehen', () => {
    expect(loeschKnopf(null, null)).toBe('Wirklich löschen');
    expect(loeschKnopf(antwort({ bilanz: { geraete: 2 } }), null)).toBe('Wirklich löschen');
    expect(loeschKnopf(antwort({ bilanz: { aemtli: 2 } }), null)).toBe(
      'Löschen, Ämtli rücken weiter'
    );
    expect(loeschKnopf(antwort({ bilanz: { aemtli: 2 } }), 'Levin')).toBe(
      'Löschen, Ämtli an Levin'
    );
  });
});

describe('loeschPfad', () => {
  it('hängt die Übergabe an, wenn eine gewählt ist', () => {
    expect(loeschPfad('Anna', null)).toBe('/api/users/Anna');
    expect(loeschPfad('Au pair', 'Levin')).toBe('/api/users/Au%20pair?aemtli_an=Levin');
  });
});
