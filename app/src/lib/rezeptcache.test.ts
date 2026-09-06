/**
 * Rezepte ohne Netz (Punkt 250 der Werkbank).
 *
 * Der Fall, der wehtut: In der Küche zickt das WLAN, und das Rezept
 * verschwindet mitten im Kochen. Diese Funktionen entscheiden, ob der
 * letzte Stand stehen bleibt – und ob ehrlich dransteht, wie alt er ist.
 */
import {
  RezeptLager,
  VERFALL,
  anzeigen,
  fuersLager,
  gelesen,
  hinweisText,
  istFrisch,
  uebernehmen,
} from './rezeptcache';

const JETZT = 1_700_000_000_000;

describe('fuersLager', () => {
  test('eingebettete Fotos fallen weg, der Kochtext bleibt vollständig', () => {
    const [gelagert] = fuersLager([
      {
        id: 'r1',
        text: 'Lasagne',
        servings: 4,
        ingredients: [{ name: 'Hackfleisch', amount: 500, unit: 'g' }],
        instructions: [{ text: 'Anbraten.' }],
        image_url: `data:image/jpeg;base64,${'A'.repeat(1000)}`,
        original_url: 'data:image/jpeg;base64,BBBB',
      },
    ]);
    expect(gelagert.image_url).toBeNull();
    expect(gelagert.original_url).toBeNull();
    expect(gelagert).toMatchObject({
      id: 'r1',
      text: 'Lasagne',
      servings: 4,
      ingredients: [{ name: 'Hackfleisch', amount: 500, unit: 'g' }],
      instructions: [{ text: 'Anbraten.' }],
    });
  });

  test('kurze Verweise (Hub-Pfad, http-Adresse) bleiben stehen', () => {
    const [hub, netz] = fuersLager([
      { id: 'r1', image_url: '/api/recipes/r1/bild?v=abc' },
      { id: 'r2', image_url: 'https://example.com/bild.jpg' },
    ]);
    expect(hub.image_url).toBe('/api/recipes/r1/bild?v=abc');
    expect(netz.image_url).toBe('https://example.com/bild.jpg');
  });
});

describe('istFrisch', () => {
  test('ein zwei Wochen alter Stand kocht noch', () => {
    expect(istFrisch(JETZT - 14 * 24 * 3600 * 1000, JETZT)).toBe(true);
  });

  test('nach dem Verfall zählt der Stand nicht mehr', () => {
    expect(istFrisch(JETZT - VERFALL, JETZT)).toBe(false);
  });
});

describe('uebernehmen', () => {
  test('ein erfolgreiches Laden ersetzt das Lager', () => {
    const alt: RezeptLager = { recipes: [{ id: 'alt' }], at: JETZT - 1000 };
    const neu = uebernehmen(alt, [{ id: 'neu', text: 'Rösti' }], JETZT);
    expect(neu).toEqual({ recipes: [{ id: 'neu', text: 'Rösti' }], at: JETZT });
  });

  test('ein leerer Stand überschreibt nie ein gefülltes Lager', () => {
    const alt: RezeptLager = { recipes: [{ id: 'r1' }], at: JETZT - 1000 };
    // Dasselbe Objekt zurück: Der Bildschirm spart sich das Schreiben.
    expect(uebernehmen(alt, [], JETZT)).toBe(alt);
  });

  test('nichts geladen und nichts gemerkt bleibt nichts', () => {
    expect(uebernehmen(null, [], JETZT)).toBeNull();
  });

  test('Fotos wandern nicht ins Lager', () => {
    const neu = uebernehmen(null, [{ id: 'r1', image_url: 'data:image/jpeg;base64,X' }], JETZT);
    expect(neu?.recipes[0].image_url).toBeNull();
  });
});

describe('anzeigen', () => {
  const lager: RezeptLager = { recipes: [{ id: 'gemerkt' }], at: JETZT - 3600 * 1000 };

  test('der geladene Stand gewinnt, sobald er etwas enthält', () => {
    const sicht = anzeigen([{ id: 'frisch' }], lager, JETZT);
    expect(sicht).toEqual({ recipes: [{ id: 'frisch' }], ausCache: false, stand: null });
  });

  test('beim Ausfall springt das frische Lager ein, ehrlich markiert', () => {
    const sicht = anzeigen([], lager, JETZT);
    expect(sicht.recipes).toEqual([{ id: 'gemerkt' }]);
    expect(sicht.ausCache).toBe(true);
    expect(sicht.stand).toBe(lager.at);
  });

  test('ein verfallenes Lager wird nicht gezeigt', () => {
    const alt: RezeptLager = { recipes: [{ id: 'uralt' }], at: JETZT - VERFALL - 1 };
    expect(anzeigen([], alt, JETZT)).toEqual({ recipes: [], ausCache: false, stand: null });
  });

  test('ohne Lager und ohne Laden ist das Buch leer, kein Ausfall', () => {
    expect(anzeigen([], null, JETZT)).toEqual({ recipes: [], ausCache: false, stand: null });
  });
});

describe('gelesen', () => {
  test('ein gespeicherter Stand kommt ganz zurück', () => {
    const raw = JSON.stringify({ recipes: [{ id: 'r1' }], at: JETZT });
    expect(gelesen(raw)).toEqual({ recipes: [{ id: 'r1' }], at: JETZT });
  });

  test('nichts, kaputter JSON und falsche Form zählen als kein Lager', () => {
    expect(gelesen(null)).toBeNull();
    expect(gelesen('{halb')).toBeNull();
    expect(gelesen(JSON.stringify({ recipes: 'kaputt', at: JETZT }))).toBeNull();
    expect(gelesen(JSON.stringify({ recipes: [], at: 'gestern' }))).toBeNull();
  });
});

describe('hinweisText', () => {
  test('am selben Tag steht nur die Uhrzeit', () => {
    const stand = new Date(2026, 8, 6, 14, 12).getTime();
    const jetzt = new Date(2026, 8, 6, 19, 30);
    expect(hinweisText(stand, jetzt)).toBe('Ohne Verbindung – Stand von 14:12');
  });

  test('ein älterer Stand trägt sein Datum', () => {
    const stand = new Date(2026, 8, 3, 18, 5).getTime();
    const jetzt = new Date(2026, 8, 6, 19, 30);
    expect(hinweisText(stand, jetzt)).toBe('Ohne Verbindung – Stand vom 3.9., 18:05');
  });

  test('ohne Zeitstempel sagt die Zeile trotzdem die Wahrheit', () => {
    expect(hinweisText(null, new Date(2026, 8, 6))).toBe('Ohne Verbindung');
  });
});
