import { haushalt, mitglieder, namen, pruefeName, rolleWort } from './mitglieder';

const konten = [
  { name: 'Stefan', role: 'besitzer' },
  { name: 'Bine', role: 'bewohner' },
];

describe('mitglieder', () => {
  it('hängt die Kinder hinter die Zugänge', () => {
    const reihe = mitglieder(konten, [
      { id: 'a1', text: 'Livia' },
      { id: 'a2', text: 'Nino', role: 'kind' },
    ]);
    expect(namen(reihe)).toEqual(['Stefan', 'Bine', 'Livia', 'Nino']);
    expect(reihe[2]).toEqual({ name: 'Livia', role: 'kind', ohneZugang: true, id: 'a1' });
  });

  it('zählt niemanden zweimal, wenn er später einen Zugang bekommt', () => {
    // Livia bekommt mit zwölf ein eigenes Konto. Stünde sie danach
    // zweimal da, verteilten sich ihre Punkte auf zwei Zeilen.
    const reihe = mitglieder([...konten, { name: 'Livia', role: 'gast' }], [
      { id: 'a1', text: 'livia' },
    ]);
    expect(namen(reihe)).toEqual(['Stefan', 'Bine', 'Livia']);
    expect(reihe[2].ohneZugang).toBeUndefined();
  });

  it('überspringt leere Namen und kommt ohne Daten aus', () => {
    expect(mitglieder(null, null)).toEqual([]);
    expect(namen(mitglieder([], [{ id: 'x', text: '   ' }]))).toEqual([]);
  });

  it('nimmt «kind» als Voreinstellung', () => {
    expect(mitglieder([], [{ id: 'x', text: 'Nino' }])[0].role).toBe('kind');
  });
});

describe('haushalt', () => {
  it('lässt Gäste aus der Familienreihe weg', () => {
    // Der gemeldete Fall: Der Babysitter und der Besuch mit Link-Zugang
    // standen als Avatare zwischen den Kindern - mit jedem spontanen
    // Gast-Zugang einer mehr.
    const reihe = mitglieder(
      [...konten, { name: 'Babysitter', role: 'gast' }, { name: 'Ray', role: 'gast' }],
      [{ id: 'a1', text: 'Livia' }]
    );
    expect(namen(haushalt(reihe))).toEqual(['Stefan', 'Bine', 'Livia']);
  });

  it('behält Kinder und Angehörige ohne Zugang', () => {
    const reihe = mitglieder(konten, [
      { id: 'a1', text: 'Livia' },
      { id: 'a2', text: 'Oma', role: 'erwachsen' },
    ]);
    expect(haushalt(reihe)).toEqual(reihe);
  });
});

describe('rolleWort', () => {
  it('sagt nur bei den Angehörigen ohne Zugang etwas', () => {
    // Für Zugänge übersetzt der Bildschirm die Hub-Rolle - hier stünde
    // sonst «besitzer» statt «Besitzer».
    expect(rolleWort({ name: 'Stefan', role: 'besitzer' })).toBe('');
    expect(rolleWort({ name: 'Livia', role: 'kind', ohneZugang: true })).toBe('Kind');
    expect(rolleWort({ name: 'Oma', role: 'erwachsen', ohneZugang: true })).toBe(
      'Ohne Zugang'
    );
  });
});

describe('pruefeName', () => {
  it('lässt einen neuen Namen durch', () => {
    expect(pruefeName('Nino', mitglieder(konten, []))).toBeNull();
  });

  it('verlangt überhaupt einen Namen', () => {
    expect(pruefeName('   ', [])).toBe('Bitte einen Namen eingeben.');
  });

  it('erkennt denselben Menschen in anderer Schreibweise', () => {
    expect(pruefeName(' stefan ', mitglieder(konten, []))).toBe(
      '«stefan» steht schon in der Liste.'
    );
  });
});
