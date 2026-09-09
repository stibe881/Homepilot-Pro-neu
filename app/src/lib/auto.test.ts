import { WidgetButton } from './widgetButtons';
import { AUTO_HOECHSTENS, autoKnoepfe, autoSatz, autoSymbol } from './auto';

const knopf = (patch: Partial<WidgetButton>): WidgetButton => ({
  key: 'door',
  title: 'Haustüre',
  symbol: 'key.fill',
  url: 'homepilot://door',
  direct: true,
  actionPath: '/api/entities/nuki.tuer/command',
  actionBody: '{"command":"unlatch"}',
  ...patch,
});

describe('autoKnoepfe', () => {
  it('nimmt nur, was selbst schaltet', () => {
    // Auf dem Telefon darf ein Knopf die App öffnen. Im Auto gibt es
    // nichts zu öffnen: Der Bildschirm dort kann nur seine Vorlagen,
    // und das Telefon bleibt während der Fahrt dunkel. Eine Kachel, die
    // beim Antippen nichts tut, ist schlimmer als eine, die fehlt.
    const liste = autoKnoepfe([
      knopf({ key: 'door' }),
      knopf({ key: 'alarm', direct: false }),
      knopf({ key: 'ohnePfad', actionPath: undefined }),
    ]);
    expect(liste.map((k) => k.key)).toEqual(['door']);
  });

  it('übersetzt Symbol, Pfad und Rumpf', () => {
    const [eins] = autoKnoepfe([knopf({})]);
    expect(eins).toEqual({
      key: 'door',
      title: 'Haustüre',
      symbol: 'tuer',
      path: '/api/entities/nuki.tuer/command',
      body: '{"command":"unlatch"}',
    });
  });

  it('ohne Rumpf steht ein leeres Objekt da', () => {
    // Der Hub will einen JSON-Rumpf sehen; «nichts» wäre keiner.
    expect(autoKnoepfe([knopf({ actionBody: undefined })])[0].body).toBe('{}');
  });

  it('mehr als acht braucht kein Auto', () => {
    const viele = Array.from({ length: 12 }, (_, i) => knopf({ key: `k${i}` }));
    expect(autoKnoepfe(viele)).toHaveLength(AUTO_HOECHSTENS);
  });
});

describe('autoSymbol', () => {
  it('übersetzt die Symbole des Widgets', () => {
    // SF-Symbole gibt es nur auf Apple-Geräten. Android zeichnet
    // Vektoren mit eigenen Namen - übersetzt wird deshalb hier, einmal,
    // statt zweimal nativ.
    expect(autoSymbol('key.fill')).toBe('tuer');
    expect(autoSymbol('power')).toBe('aus');
    expect(autoSymbol('shield.fill')).toBe('alarm');
    expect(autoSymbol('lightbulb.fill')).toBe('licht');
    expect(autoSymbol('sparkles')).toBe('szene');
    expect(autoSymbol('arrow.up.arrow.down')).toBe('store');
    expect(autoSymbol('music.note')).toBe('musik');
  });

  it('Unbekanntes bekommt einen Punkt, kein Nichts', () => {
    // Android zeichnet eine Kachel ohne Bild gar nicht erst.
    expect(autoSymbol('irgendwas.neues')).toBe('punkt');
    expect(autoSymbol('')).toBe('punkt');
  });
});

describe('autoSatz', () => {
  it('zählt auf, was im Auto erscheint', () => {
    const satz = autoSatz([knopf({ key: 'door', title: 'Haustüre' })]);
    expect(satz).toBe('1 Knopf im Auto: Haustüre');
  });

  it('sagt, warum die Kachelwand leer bleibt', () => {
    // Die Frage stellt man sich sonst erst im Auto - wo man sie nicht
    // mehr beantworten kann.
    const satz = autoSatz([knopf({ direct: false })]);
    expect(satz).toContain('direkt schalten');
  });

  it('ohne Knöpfe verweist er aufs Widget', () => {
    expect(autoSatz([])).toContain('Widget');
  });
});
