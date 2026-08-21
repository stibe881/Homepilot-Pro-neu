/**
 * Die Einkaufsliste: Gänge, Zuordnung, Zutaten aus Rezepten.
 *
 * Diese Funktionen entscheiden, in welcher Reihenfolge man durch den Laden
 * läuft – der Ort, an dem es still falsch wird. Ein Poulet in den
 * Milchprodukten merkt man erst im Regal.
 */
import {
  ALLGEMEIN,
  groupForShop,
  ingredientLabel,
  ingredientsToShopping,
  shopCategory,
  shopOrder,
} from './einkauf';

describe('shopCategory', () => {
  it('ordnet die Alltagsposten dem richtigen Gang zu', () => {
    expect(shopCategory('Rüebli')).toBe('Früchte & Gemüse');
    expect(shopCategory('Vollmilch')).toBe('Milchprodukte');
    expect(shopCategory('Zopf')).toBe('Brot & Backwaren');
  });

  it('kennt Gross- und Kleinschreibung nicht', () => {
    expect(shopCategory('MILCH')).toBe(shopCategory('milch'));
  });

  it('legt Unbekanntes zu «Sonstiges», statt zu raten', () => {
    // Lieber unsortiert als falsch einsortiert: Ein Gang, den es im Laden
    // nicht gibt, kostet mehr als eine Zeile ganz unten.
    expect(shopCategory('Schraubenzieher')).toBe('Sonstiges');
  });
});

describe('shopOrder', () => {
  it('stellt die Gänge des Ladens nach vorn, den Rest hinten dran', () => {
    const coop = { id: 'coop', name: 'Coop', categories: ['Getränke', 'Tiefkühl'] };
    const reihenfolge = shopOrder(coop);
    expect(reihenfolge.slice(0, 2)).toEqual(['Getränke', 'Tiefkühl']);
    // Nichts fällt weg – auch nicht, was der Laden nicht kennt.
    expect(reihenfolge).toContain('Sonstiges');
    expect(new Set(reihenfolge).size).toBe(reihenfolge.length);
  });

  it('erfindet keine Gänge, die es nicht gibt', () => {
    const seltsam = { id: 'x', name: 'X', categories: ['Zoohandlung'] };
    expect(shopOrder(seltsam)).not.toContain('Zoohandlung');
  });

  it('ohne Laden die Standardreihenfolge', () => {
    expect(shopOrder(null)[0]).toBe('Früchte & Gemüse');
  });
});

describe('groupForShop', () => {
  const liste = [
    { id: '1', text: 'Milch', category: 'Milchprodukte' },
    { id: '2', text: 'Rüebli', category: 'Früchte & Gemüse' },
    { id: '3', text: 'Bier', category: 'Getränke' },
    { id: '4', text: 'Batterien', category: 'Quatsch' },
  ];

  it('bündelt nach Gang, in der Laufreihenfolge des Ladens', () => {
    const coop = { id: 'coop', name: 'Coop', categories: ['Getränke'] };
    expect(groupForShop(liste, coop).map((g) => g.category)).toEqual([
      'Getränke',
      'Früchte & Gemüse',
      'Milchprodukte',
      'Sonstiges',
    ]);
  });

  it('lässt leere Gänge weg', () => {
    const nur = [{ id: '1', text: 'Milch', category: 'Milchprodukte' }];
    expect(groupForShop(nur, ALLGEMEIN)).toHaveLength(1);
  });

  it('fängt unbekannte Kategorien unter «Sonstiges» auf', () => {
    const sonstiges = groupForShop(liste, ALLGEMEIN).find(
      (g) => g.category === 'Sonstiges'
    );
    expect(sonstiges?.items.map((i: { text: string }) => i.text)).toEqual(['Batterien']);
  });

  it('behält innerhalb eines Gangs die Reihenfolge des Eintragens', () => {
    const zwei = [
      { id: '1', text: 'Milch', category: 'Milchprodukte' },
      { id: '2', text: 'Rahm', category: 'Milchprodukte' },
    ];
    expect(
      groupForShop(zwei, ALLGEMEIN)[0].items.map((i: { text: string }) => i.text)
    ).toEqual(['Milch', 'Rahm']);
  });
});

describe('ingredientLabel', () => {
  it('setzt Menge, Einheit und Name zusammen', () => {
    expect(ingredientLabel({ amount: 250, unit: 'ml', name: 'Rahm' })).toBe('250 ml Rahm');
  });

  it('schreibt den Dezimalpunkt als Komma', () => {
    expect(ingredientLabel({ amount: 1.5, unit: 'dl', name: 'Milch' })).toBe(
      '1,5 dl Milch'
    );
  });

  it('lässt weg, was fehlt', () => {
    expect(ingredientLabel({ name: 'Salz' })).toBe('Salz');
    expect(ingredientLabel({ amount: 2, name: 'Zwiebeln' })).toBe('2 Zwiebeln');
    expect(ingredientLabel({ name: '  ' })).toBe('');
  });
});

describe('ingredientsToShopping', () => {
  const rezepte = [
    { ingredients: [{ name: 'Zwiebeln', amount: 2 }, { name: 'Rahm', amount: 200, unit: 'ml' }] },
    { ingredients: [{ name: 'Zwiebeln', amount: 1 }] },
  ];

  it('fasst denselben Posten aus zwei Rezepten zusammen', () => {
    // Wer für zwei Gerichte Zwiebeln braucht, will einmal daran denken.
    const daraus = ingredientsToShopping(rezepte);
    expect(daraus.filter((e) => e.text.includes('Zwiebeln'))).toHaveLength(1);
  });

  it('setzt nichts auf die Liste, was schon drauf steht', () => {
    expect(ingredientsToShopping(rezepte, ['zwiebeln'])).toHaveLength(1);
  });

  it('gibt jedem Posten gleich seinen Gang mit', () => {
    const rahm = ingredientsToShopping(rezepte).find((e) => e.text.includes('Rahm'));
    expect(rahm?.category).toBe('Milchprodukte');
  });

  it('überspringt namenlose Zutaten, statt leere Zeilen anzulegen', () => {
    expect(ingredientsToShopping([{ ingredients: [{ amount: 3 }] }])).toEqual([]);
  });
});
