import { FRIST_MS, bandSatz, eintragName, nochGueltig } from './rueckband';

const eintrag = {
  name: 'Milch',
  label: 'gelöscht',
  at: 1_000_000,
  collection: 'shopping',
  id: 'a',
};

describe('nochGueltig', () => {
  it('steht, solange man den Fehler bemerkt', () => {
    expect(nochGueltig(eintrag, eintrag.at + 1000)).toBe(true);
  });

  it('verschwindet, bevor es im Weg steht', () => {
    // Ein Angebot, das nach zwei Minuten noch dasteht, meint eine
    // Handlung, an die sich niemand mehr erinnert.
    expect(nochGueltig(eintrag, eintrag.at + FRIST_MS + 1)).toBe(false);
  });

  it('kommt mit nichts zurecht', () => {
    expect(nochGueltig(null)).toBe(false);
  });
});

describe('bandSatz', () => {
  it('sagt, was zurückgenommen würde', () => {
    expect(bandSatz(eintrag)).toBe('«Milch» gelöscht');
  });

  it('bleibt leer, wo nichts ist', () => {
    expect(bandSatz(null)).toBe('');
  });
});

describe('eintragName', () => {
  it('nimmt Text oder Name', () => {
    expect(eintragName({ text: ' Milch ' })).toBe('Milch');
    expect(eintragName({ name: 'Oma' })).toBe('Oma');
  });

  it('macht aus einem leeren Posten kein leeres Zitat', () => {
    // Sonst stünde im Band «« » gelöscht».
    expect(eintragName({ text: '  ' })).toBe('Eintrag');
    expect(eintragName(null)).toBe('Eintrag');
  });
});
