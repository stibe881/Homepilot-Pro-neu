import { HOECHSTENS, schnellaktionen, symbolFuer } from './schnellaktionen';
import { WidgetButton } from './widgetButtons';

const knopf = (key: string, title: string, url: string): WidgetButton => ({
  key,
  title,
  symbol: 'x',
  url,
});

describe('Kurzbefehle am App-Symbol', () => {
  it('nimmt die Widget-Knöpfe, wie sie stehen', () => {
    // Eine zweite Liste für dieselbe Frage wäre eine zweite Stelle, an
    // der man sucht - und eine, die mit der ersten auseinanderläuft.
    const aktionen = schnellaktionen([
      knopf('door', 'Haustüre', 'homepilot://door'),
      knopf('scene:kino', 'Kino', 'homepilot://scene/kino'),
    ]);
    expect(aktionen.map((a) => a.title)).toEqual(['Haustüre', 'Kino']);
    expect(aktionen[0].params.url).toBe('homepilot://door');
    expect(aktionen[0].id).toBe('door');
  });

  it('hört beim Höchstmass auf', () => {
    const viele = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) =>
      knopf(k, k, `homepilot://entity/${k}`)
    );
    expect(schnellaktionen(viele)).toHaveLength(HOECHSTENS);
  });

  it('kommt ohne Knöpfe aus', () => {
    expect(schnellaktionen([])).toEqual([]);
  });

  it('gibt jedem Knopf ein eingebautes Symbol', () => {
    // Ein Symbol, das die iOS-Fassung nicht kennt, zeichnet gar nichts.
    expect(symbolFuer('door')).toBe('home');
    expect(symbolFuer('alloff')).toBe('prohibit');
    expect(symbolFuer('scene:kino')).toBe('favorite');
    expect(symbolFuer('entity:hue.a')).toBe('task');
  });
});
