/**
 * Rezept auf Papier, Kochen aus dem Vorrat, Kategorien aufräumen.
 */
import {
  ausVorrat,
  fehltText,
  kategorien,
  kategorieUmbenennen,
  vorratsNamen,
  rezeptAlsSeite,
} from './rezeptseite';

const LASAGNE = {
  id: 'r1',
  text: 'Lasagne',
  category: 'dinner',
  ingredients: [
    { name: 'Hackfleisch', amount: 500, unit: 'g' },
    { name: 'Vollrahm', amount: 2, unit: 'dl' },
    { name: 'Tomatenpüree', amount: 1, unit: 'EL' },
    { name: 'Salz' },
  ],
  instructions: ['Hackfleisch anbraten', 'Schichten', 'Backen'],
};

describe('rezeptAlsSeite', () => {
  test('bringt Titel, Portionen, Zutaten und Schritte aufs Blatt', () => {
    const seite = rezeptAlsSeite(LASAGNE, 1, 4);
    expect(seite).toContain('<h1>Lasagne</h1>');
    expect(seite).toContain('Für 4 Portionen');
    expect(seite).toContain('500 g Hackfleisch');
    expect(seite).toContain('<li>Hackfleisch anbraten</li>');
  });

  test('rechnet die Mengen auf die gewählten Portionen um', () => {
    expect(rezeptAlsSeite(LASAGNE, 1.5, 6)).toContain('750 g Hackfleisch');
  });

  test('was jemand getippt hat, bleibt Text und wird kein Markup', () => {
    const seite = rezeptAlsSeite({ text: '<script>x</script>' }, 1, 0);
    expect(seite).not.toContain('<script>x');
  });
});

describe('ausVorrat', () => {
  const REZEPTE = [
    LASAGNE,
    {
      id: 'r2',
      text: 'Rahmschnitzel',
      ingredients: [{ name: 'Schnitzel' }, { name: 'Rahm' }, { name: 'Salz' }],
    },
    { id: 'r3', text: 'Kuchen', ingredients: [{ name: 'Äpfel' }, { name: 'Zimt' }] },
  ];

  test('findet, was mit dem Vorhandenen geht', () => {
    const treffer = ausVorrat(REZEPTE, ['Hackfleisch', 'Rahm']);
    // Beide brauchen genau eine Zutat, die fehlt – dann gewinnt das
    // Rezept, das mehr vom Vorrat verwendet.
    expect(treffer.map((t) => t.recipe.id)).toEqual(['r1', 'r2']);
  });

  test('sagt ehrlich, was noch fehlt', () => {
    const treffer = ausVorrat(REZEPTE, ['Hackfleisch', 'Rahm']);
    const lasagne = treffer.find((t) => t.recipe.id === 'r1');
    expect(lasagne?.fehlt).toEqual(['Tomatenpüree']);
  });

  test('Salz und Pfeffer zählen nicht als fehlend – die hat jeder', () => {
    const treffer = ausVorrat(REZEPTE, ['Schnitzel', 'Rahm']);
    expect(treffer[0].fehlt).toEqual([]);
  });

  test('ohne Eingabe kein Vorschlag', () => {
    expect(ausVorrat(REZEPTE, [])).toEqual([]);
  });

  test('was zu viel fehlt, taucht nicht auf', () => {
    expect(ausVorrat(REZEPTE, ['Zimt'], 0).map((t) => t.recipe.id)).toEqual([]);
  });
});

test('fehltText schreibt es in einem Satz', () => {
  expect(fehltText([])).toBe('alles da');
  expect(fehltText(['Rahm'])).toBe('ohne Rahm');
  expect(fehltText(['Rahm', 'Käse', 'Wein'])).toBe('ohne Rahm und Käse (+1)');
});

describe('Kategorien aufräumen', () => {
  const REZEPTE = [
    { id: 'a', text: 'Lasagne', category: 'dinner' },
    { id: 'b', text: 'Suppe', category: 'dinner' },
    { id: 'c', text: 'Kuchen', category: 'Dessert' },
  ];

  test('benennt alle betroffenen um', () => {
    const geaendert = kategorieUmbenennen(REZEPTE, 'dinner', 'Znacht');
    expect(geaendert.map((r) => r.id)).toEqual(['a', 'b']);
    expect(geaendert[0].category).toBe('Znacht');
  });

  test('gibt nur die Geänderten zurück', () => {
    expect(kategorieUmbenennen(REZEPTE, 'gibtsnicht', 'X')).toEqual([]);
  });

  test('zählt, was es gibt', () => {
    // Häufigstes zuerst: Was man aufräumen will, steht oben.
    expect(kategorien(REZEPTE)).toEqual([
      { name: 'dinner', anzahl: 2 },
      { name: 'Dessert', anzahl: 1 },
    ]);
  });
});

describe('vorratsNamen', () => {
  it('nimmt die Namen aus dem Vorrat', () => {
    expect(
      vorratsNamen([{ text: 'Milch' }, { text: 'Rahm' }])
    ).toEqual(['Milch', 'Rahm']);
  });

  it('lässt zu kurze Einträge weg', () => {
    // `ausVorrat` sucht auf Wortstamm-Ebene: Ein zweibuchstabiges «Ei»
    // träfe «Eintopf», «Eisberg» und «Eiweiss» gleich mit.
    expect(vorratsNamen([{ text: 'Ei' }, { text: 'Eier' }])).toEqual(['Eier']);
  });

  it('nennt dieselbe Sache nur einmal', () => {
    expect(
      vorratsNamen([{ text: 'Milch' }, { text: ' milch ' }])
    ).toEqual(['Milch']);
  });

  it('verträgt Unsinn', () => {
    expect(vorratsNamen([{ text: null }, {}, { text: '  ' }])).toEqual([]);
  });

  it('findet mit dem Vorrat auch wirklich Rezepte', () => {
    // Der eigentliche Zweck: Die Namen aus dem Vorrat müssen so
    // aussehen, dass `ausVorrat` sie annimmt.
    const rezepte = [
      { id: '1', text: 'Rahmsauce', ingredients: [{ name: 'Rahm' }, { name: 'Salz' }] },
    ] as unknown as Parameters<typeof ausVorrat>[0];
    const treffer = ausVorrat(rezepte, vorratsNamen([{ text: 'Rahm' }]));
    expect(treffer).toHaveLength(1);
    expect(treffer[0].fehlt).toEqual([]);
  });
});
