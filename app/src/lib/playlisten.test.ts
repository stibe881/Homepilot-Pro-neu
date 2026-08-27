import { LEER, wahlFuer, wahlSetzen } from './playlisten';

test('holt Reihenfolge und Ausgeblendetes heraus', () => {
  const buch = { 'media.spotify': { order: ['a'], hidden: ['b'] } };
  expect(wahlFuer(buch, 'media.spotify')).toEqual({ order: ['a'], hidden: ['b'] });
});

test('eine unbekannte Karte hat nichts gemerkt', () => {
  expect(wahlFuer({}, 'media.spotify')).toEqual(LEER);
});

test('was kein Buch ist, ergibt nichts – statt zu stürzen', () => {
  // Der Hub reicht die Einstellungen unverändert durch; was dort einmal
  // hineingeriet, kommt auch wieder heraus.
  expect(wahlFuer(null, 'x')).toEqual(LEER);
  expect(wahlFuer('kaputt', 'x')).toEqual(LEER);
  expect(wahlFuer({ x: 42 }, 'x')).toEqual(LEER);
  expect(wahlFuer({ x: { order: 'nein' } }, 'x')).toEqual(LEER);
});

test('nur Zeichenketten überleben', () => {
  expect(wahlFuer({ x: { order: ['a', 7, null] } }, 'x').order).toEqual(['a']);
});

test('setzen legt den Eintrag ab, ohne die anderen zu stören', () => {
  const buch = { a: { order: ['1'], hidden: [] } };
  expect(wahlSetzen(buch, 'b', { order: ['2'], hidden: [] })).toEqual({
    a: { order: ['1'], hidden: [] },
    b: { order: ['2'], hidden: [] },
  });
});

test('ein leerer Eintrag verschwindet', () => {
  const buch = { a: { order: ['1'], hidden: [] }, b: { order: [], hidden: [] } };
  expect(wahlSetzen(buch, 'a', { order: [], hidden: [] })).toEqual({
    b: { order: [], hidden: [] },
  });
});

test('das Buch selbst bleibt unangetastet', () => {
  const buch = { a: { order: ['1'], hidden: [] } };
  wahlSetzen(buch, 'a', { order: [], hidden: [] });
  expect(buch).toEqual({ a: { order: ['1'], hidden: [] } });
});
