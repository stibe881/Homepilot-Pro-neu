/**
 * Eingebaute und eigene Vorlagen in einer Liste.
 *
 * Der Fall dahinter: Die Vorlagen kamen ausschliesslich aus dem
 * Gerätebestand - dazutun oder wegnehmen konnte man nichts. Wer eine
 * bearbeitet, will danach seine sehen und nicht beide.
 */
import { EMPTY } from './entwurf';
import { EigeneVorlage, Template, mischeVorlagen } from './vorlagen';

const eingebaut = (label: string): Template => ({
  label,
  icon: 'flash-outline',
  draft: { ...EMPTY, alias: label },
});

const eigen = (label: string, id = 'vorlage_1'): EigeneVorlage => ({
  id,
  label,
  icon: 'bulb-outline',
  draft: { alias: label },
});

describe('mischeVorlagen', () => {
  it('stellt die eigenen nach vorn', () => {
    const liste = mischeVorlagen([eingebaut('Morgens saugen')], [eigen('Reduit')], []);
    expect(liste.map((zeile) => zeile.label)).toEqual(['Reduit', 'Morgens saugen']);
    expect(liste[0].eigen).toBe(true);
    expect(liste[1].eigen).toBe(false);
  });

  it('lässt Ausgeblendete weg', () => {
    const liste = mischeVorlagen(
      [eingebaut('Morgens saugen'), eingebaut('Storen zu')],
      [],
      ['Morgens saugen']
    );
    expect(liste.map((zeile) => zeile.label)).toEqual(['Storen zu']);
  });

  it('verdrängt die eingebaute, wenn eine eigene so heisst', () => {
    // Genau der Grund, aus dem jemand eine bearbeitet hat: Zwei fast
    // gleiche nebeneinander wären die schlechtere Antwort.
    const liste = mischeVorlagen(
      [eingebaut('Morgens saugen')],
      [eigen('morgens saugen')],
      []
    );
    expect(liste).toHaveLength(1);
    expect(liste[0].eigen).toBe(true);
  });

  it('gibt jeder Zeile einen eindeutigen Schlüssel', () => {
    const liste = mischeVorlagen(
      [eingebaut('A'), eingebaut('B')],
      [eigen('C', 'x'), eigen('D', 'y')],
      []
    );
    expect(new Set(liste.map((zeile) => zeile.key)).size).toBe(4);
  });

  it('verträgt leere Listen', () => {
    expect(mischeVorlagen([], [], [])).toEqual([]);
  });
});
