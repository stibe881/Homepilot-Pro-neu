import { offlineSatz } from './funkstille';

describe('offlineSatz', () => {
  it('macht bei einer Store Mut statt sie abzuschreiben', () => {
    // Der gemeldete Fall: «geht nicht, da diese in der App als nicht
    // verfügbar angezeigt wird» - dabei ging es die ganze Zeit.
    const satz = offlineSatz(
      { integration: 'overkiz', commands: ['open', 'close', 'stop'] },
      'vor 5 Min.',
    );
    expect(satz).toContain('steuern geht trotzdem');
    expect(satz).toContain('vor 5 Min.');
  });

  it('bleibt ehrlich, wo Drücken wirklich nichts bringt', () => {
    // Eine Lampe am Netz, die nicht antwortet, ist nicht zu erreichen -
    // da wäre «geht trotzdem» eine Lüge.
    expect(offlineSatz({ integration: 'hue', commands: ['turn_on'] }, null)).toBe(
      'nicht erreichbar',
    );
  });

  it('verspricht nichts, wo es nichts zu drücken gibt', () => {
    // Ein Fühler ohne Kommandos: Da hilft auch Funk-Nachsicht nicht.
    expect(offlineSatz({ integration: 'overkiz', commands: [] }, null)).toBe(
      'nicht erreichbar',
    );
  });

  it('kommt ohne Zeitangabe aus', () => {
    expect(offlineSatz({ integration: 'overkiz', commands: ['open'] }, null)).toBe(
      'meldet sich nicht · steuern geht trotzdem',
    );
  });
});
