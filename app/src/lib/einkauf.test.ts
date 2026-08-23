/**
 * Die Einkaufsliste: Gänge, Zuordnung, Zutaten aus Rezepten.
 *
 * Diese Funktionen entscheiden, in welcher Reihenfolge man durch den Laden
 * läuft – der Ort, an dem es still falsch wird. Ein Poulet in den
 * Milchprodukten merkt man erst im Regal.
 */
import {
  ALLGEMEIN,
  artikelName,
  einkaufZeile,
  einkaufsText,
  eintragen,
  findeArtikel,
  fuerLaden,
  groupForShop,
  ingredientLabel,
  ingredientsToShopping,
  ladenZaehler,
  mengeAendern,
  mengeUndName,
  mitMenge,
  shopCategory,
  shopOrder,
  zeilenAufteilen,
  zutatGeteilt,
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
    expect(sonstiges?.items.map((i) => String(i.text))).toEqual(['Batterien']);
  });

  it('behält innerhalb eines Gangs die Reihenfolge des Eintragens', () => {
    const zwei = [
      { id: '1', text: 'Milch', category: 'Milchprodukte' },
      { id: '2', text: 'Rahm', category: 'Milchprodukte' },
    ];
    expect(
      groupForShop(zwei, ALLGEMEIN)[0].items.map((i) => String(i.text))
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

  it('rechnet je Rezept mit seinem eigenen Portionen-Faktor (Punkt 145)', () => {
    // Samstag kommt Besuch (Faktor 2), am Montag isst man zu viert wie
    // im Rezept - der Wocheneinkauf darf das nicht über einen Kamm
    // scheren.
    const getrennt = [
      { ingredients: [{ name: 'Rahm', amount: 200, unit: 'ml' }] },
      { ingredients: [{ name: 'Hackfleisch', amount: 500, unit: 'g' }] },
    ];
    const daraus = ingredientsToShopping(getrennt, [], [2, 1]);
    expect(daraus.find((e) => e.text === 'Rahm')?.amount).toBe('400 ml');
    expect(daraus.find((e) => e.text === 'Hackfleisch')?.amount).toBe('500 g');
  });
});

describe('mengeUndName', () => {
  it('liest «2 Milch» als zwei Milch', () => {
    expect(mengeUndName('2 Milch')).toEqual({ menge: 2, name: 'Milch' });
  });

  it('versteht 2x, 2× und 2 gleich', () => {
    expect(mengeUndName('2x Milch').menge).toBe(2);
    expect(mengeUndName('2× Milch').menge).toBe(2);
    expect(mengeUndName('2 Milch').menge).toBe(2);
  });

  it('lässt einen Namen ohne Menge in Ruhe', () => {
    expect(mengeUndName('Milch')).toEqual({ menge: 1, name: 'Milch' });
  });

  it('behandelt «1 Milch» nicht als Menge – eins schreibt man nicht hin', () => {
    expect(mengeUndName('1 Milch')).toEqual({ menge: 1, name: '1 Milch' });
  });

  it('lässt eine Mengenangabe mit Einheit unangetastet', () => {
    // «250 ml Ketchup» ist ein Name mit Einheit, keine Stückzahl – die
    // Zahl darf nicht als Anzahl Ketchups gelesen werden.
    expect(mengeUndName('250 ml Ketchup').menge).toBe(1);
  });
});

describe('findeArtikel', () => {
  const liste = [
    { id: 'a', text: '2× Milch' },
    { id: 'b', text: 'Brot' },
  ];

  it('findet den Posten unabhängig von der Menge', () => {
    expect(findeArtikel(liste, 'Milch')?.id).toBe('a');
    expect(findeArtikel(liste, '3 Milch')?.id).toBe('a');
  });

  it('unterscheidet Gross- und Kleinschreibung nicht', () => {
    expect(findeArtikel(liste, 'brot')?.id).toBe('b');
  });

  it('gibt nichts zurück, was nicht drauf steht', () => {
    expect(findeArtikel(liste, 'Butter')).toBeUndefined();
  });
});

describe('mitMenge', () => {
  it('schreibt ab zwei die Menge davor', () => {
    expect(mitMenge('Milch', 3)).toBe('3× Milch');
  });

  it('lässt eine einzelne Sache ohne Zahl', () => {
    expect(mitMenge('Milch', 1)).toBe('Milch');
  });
});

describe('ingredientsToShopping mit Portionen-Faktor', () => {
  const rezept = {
    ingredients: [
      { name: 'Mehl', amount: 250, unit: 'g' },
      { name: 'Salz' },
    ],
  };

  it('rechnet die Mengen auf die gewählten Portionen um', () => {
    // Der Artikel steht in text, die Menge daneben – seit sie nicht mehr
    // in den Namen geklebt wird.
    const liste = ingredientsToShopping([rezept], [], 2);
    expect(liste[0]).toMatchObject({ text: 'Mehl', amount: '500 g' });
    // Ohne Menge bleibt der Name der Name – «2× Salz» wäre Unsinn.
    expect(liste[1].text).toBe('Salz');
    expect(liste[1].amount).toBeUndefined();
  });

  it('rundet auf eine Nachkommastelle – niemand wiegt 666,6667 g', () => {
    const drittel = ingredientsToShopping(
      [{ ingredients: [{ name: 'Mehl', amount: 500, unit: 'g' }] }],
      [],
      4 / 3
    );
    expect(drittel[0]).toMatchObject({ text: 'Mehl', amount: '666,7 g' });
  });

  it('ohne Faktor bleibt alles wie es war', () => {
    expect(ingredientsToShopping([rezept])[0]).toMatchObject({
      text: 'Mehl',
      amount: '250 g',
    });
  });
});

describe('Menge, Läden und Teilen', () => {
  test('mengeAendern zählt hoch und wieder runter', () => {
    expect(mengeAendern('Milch', 1)).toBe('2× Milch');
    expect(mengeAendern('2× Milch', 1)).toBe('3× Milch');
    expect(mengeAendern('2× Milch', -1)).toBe('Milch');
    // Unter eins geht es nicht – gelöscht wird mit dem Papierkorb.
    expect(mengeAendern('Milch', -1)).toBe('Milch');
  });

  test('zeilenAufteilen macht aus einem Satz mehrere Posten', () => {
    const posten = zeilenAufteilen('Milch, Butter, 2 Zwiebeln');
    expect(posten.map((p) => p.text)).toEqual(['Milch', 'Butter', '2 Zwiebeln']);
    expect(posten[0].category).toBe('Milchprodukte');
    expect(posten[2].category).toBe('Früchte & Gemüse');
  });

  test('zeilenAufteilen lässt einen einzelnen Posten in Ruhe', () => {
    expect(zeilenAufteilen('Salz und Pfeffer').map((p) => p.text)).toEqual([
      'Salz und Pfeffer',
    ]);
  });

  test('eintragen erhöht statt zu verdoppeln', () => {
    const liste = [{ id: 'a', text: '2× Milch' }];
    const ergebnis = eintragen(liste, 'Milch');
    expect(ergebnis).toEqual({ kind: 'mehr', id: 'a', text: '3× Milch' });
  });

  test('eintragen legt neu an, wenn der alte Posten erledigt ist', () => {
    const liste = [{ id: 'a', text: 'Milch', done: true }];
    const ergebnis = eintragen(liste, 'Milch');
    expect(ergebnis.kind).toBe('neu');
  });

  test('fuerLaden zeigt Allgemeines überall', () => {
    const items = [
      { id: '1', text: 'Milch' },
      { id: '2', text: 'Schrauben', shop: 'baumarkt' },
      { id: '3', text: 'Käse', shop: 'hofladen' },
    ];
    expect(fuerLaden(items, 'baumarkt').map((i) => i.id)).toEqual(['1', '2']);
    expect(fuerLaden(items, 'allgemein').map((i) => i.id)).toEqual(['1', '2', '3']);
  });

  test('ladenZaehler zählt nur Offenes', () => {
    const items = [
      { id: '1', text: 'Milch' },
      { id: '2', text: 'Schrauben', shop: 'baumarkt', done: true },
    ];
    const zahlen = ladenZaehler(items, [{ id: 'baumarkt', name: 'Baumarkt' }]);
    expect(zahlen.find((z) => z.shop.id === 'baumarkt')?.offen).toBe(1);
  });

  test('einkaufsText sortiert nach Gang', () => {
    const text = einkaufsText([
      { text: 'Milch', category: 'Milchprodukte' },
      { text: 'Äpfel', category: 'Früchte & Gemüse' },
      { text: 'Brot', category: 'Brot & Backwaren', done: true },
    ]);
    expect(text.indexOf('Äpfel')).toBeLessThan(text.indexOf('Milch'));
    expect(text).not.toContain('Brot');
  });

  test('die Zutaten bringen ihre Herkunft mit', () => {
    const posten = ingredientsToShopping([
      { id: 'r1', text: 'Lasagne', ingredients: [{ name: 'Kapern', amount: 250, unit: 'g' }] },
    ]);
    expect(posten[0]).toMatchObject({
      text: 'Kapern',
      amount: '250 g',
      from: 'Lasagne',
      from_id: 'r1',
    });
  });
});

// ── Menge und Artikel gehören getrennt ───────────────────────────────────
// Aus dem Rezept kam «400 ml Milch» als ein Text auf die Liste. Damit
// stand die Menge im Artikelnamen: Das Gedächtnis lernte «400 ml Milch»,
// «schon drauf?» verglich Mengen mit, und die Stückzahl-Knöpfe fassten
// eine Zahl an, die keine Stückzahl war.

describe('zutatGeteilt', () => {
  it('trennt Menge und Artikel', () => {
    expect(zutatGeteilt({ name: 'Milch', amount: 400, unit: 'ml' })).toEqual({
      name: 'Milch',
      menge: '400 ml',
    });
  });

  it('rechnet die Portionen mit', () => {
    expect(zutatGeteilt({ name: 'Milch', amount: 400, unit: 'ml' }, 2).menge).toBe('800 ml');
  });

  it('lässt die Menge weg, wo das Rezept keine nennt', () => {
    expect(zutatGeteilt({ name: 'Salz' })).toEqual({ name: 'Salz', menge: '' });
  });

  it('verträgt eine Menge ohne Einheit und eine Einheit ohne Menge', () => {
    expect(zutatGeteilt({ name: 'Eier', amount: 3 }).menge).toBe('3');
    expect(zutatGeteilt({ name: 'Öl', unit: 'Schuss' }).menge).toBe('Schuss');
  });

  it('bleibt beim Ausschreiben bei der alten Zeile', () => {
    // Im Rezept selbst stehen Menge und Zutat weiterhin zusammen.
    expect(ingredientLabel({ name: 'Ketchup', amount: 250, unit: 'ml' })).toBe(
      '250 ml Ketchup'
    );
  });
});

describe('ingredientsToShopping mit getrennter Menge', () => {
  const rezept = {
    id: 'r1',
    text: 'Pfannkuchen',
    ingredients: [
      { name: 'Milch', amount: 400, unit: 'ml' },
      { name: 'Salz' },
    ],
  };

  it('schreibt den Artikel in text und die Menge daneben', () => {
    const [milch, salz] = ingredientsToShopping([rezept]);
    expect(milch.text).toBe('Milch');
    expect(milch.amount).toBe('400 ml');
    // Ohne Menge bleibt das Feld weg statt leer dazustehen.
    expect(salz.text).toBe('Salz');
    expect(salz.amount).toBeUndefined();
  });

  it('rechnet den Portionen-Faktor in die Menge', () => {
    expect(ingredientsToShopping([rezept], [], 2)[0].amount).toBe('800 ml');
  });

  it('erkennt einen alten Posten, in dem die Menge noch im Text steckt', () => {
    // Eine Liste vom letzten Samstag soll kein zweites «Milch» bekommen.
    expect(ingredientsToShopping([rezept], ['400 ml Milch'])).toHaveLength(1);
    expect(ingredientsToShopping([rezept], ['Milch'])).toHaveLength(1);
  });
});

describe('einkaufZeile', () => {
  it('trennt Stückzahl, Artikel und Menge', () => {
    expect(einkaufZeile({ text: '3× Milch', amount: '400 ml' })).toEqual({
      anzahl: 3,
      artikel: 'Milch',
      menge: '400 ml',
    });
  });

  it('lässt einen alten Posten aussehen wie bisher', () => {
    // Da steckt die Menge noch im Text – nichts daran soll sich ändern.
    expect(einkaufZeile({ text: '400 ml Milch' })).toEqual({
      anzahl: 1,
      artikel: '400 ml Milch',
      menge: '',
    });
  });

  it('verträgt einen Posten ganz ohne Angaben', () => {
    expect(einkaufZeile({})).toEqual({ anzahl: 1, artikel: '', menge: '' });
  });
});

describe('artikelName', () => {
  it('streift die Menge ab, damit sich Posten vergleichen lassen', () => {
    expect(artikelName('400 ml Milch')).toBe('Milch');
    expect(artikelName('1,5 kg Mehl')).toBe('Mehl');
    expect(artikelName('2 EL Öl')).toBe('Öl');
  });

  it('lässt ein Wort stehen, das keine Einheit ist', () => {
    // «2 Bio Eier» meint zwei Bio-Eier, nicht «Eier» in der Einheit «Bio».
    expect(artikelName('2 Bio Eier')).toBe('2 Bio Eier');
  });

  it('lässt einen Artikel ohne Zahl in Ruhe', () => {
    expect(artikelName('Milch')).toBe('Milch');
    expect(artikelName('')).toBe('');
  });

  it('macht aus einer Zeile ohne Rest keinen leeren Artikel', () => {
    expect(artikelName('500 g')).toBe('500 g');
  });
});
