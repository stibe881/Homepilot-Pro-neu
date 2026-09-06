import { HubSettings } from '../api/types';
import { WidgetButton } from './widgetButtons';

/**
 * Der ganze Schreibweg der Widget-Ablage, mit nachgebautem nativem
 * Modul. Entstanden, als die Warnung «Hülle zu alt» beim Umbau auf den
 * Expo-Auflöser still zu «kein Widget» wurde - der Zustand ohne jede
 * Anzeige. Auf dem Gerät sah das aus wie geheilt; erst dieser Test
 * macht die vier Fälle von aussen unterscheidbar.
 */

// Das nachgebaute Modul mit denselben Signaturen wie
// ExtensionStorageModule.swift: (key, value, group) und (key, group).
let mockModul: {
  ablage: Map<string, string>;
  setString: (key: string, wert: string, gruppe?: string) => void;
  get: (key: string, gruppe?: string) => string | null;
  remove: (key: string, gruppe?: string) => void;
  reloadWidget: jest.Mock;
} | null = null;

jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => mockModul,
}));

import { syncWidget, abgelegteKnoepfe, widgetSpur } from './widget';

function frischesModul() {
  const ablage = new Map<string, string>();
  return {
    ablage,
    setString: (key: string, wert: string) => {
      ablage.set(key, wert);
    },
    get: (key: string) => ablage.get(key) ?? null,
    remove: (key: string) => {
      ablage.delete(key);
    },
    reloadWidget: jest.fn(),
  };
}

const settings = { url: 'http://hub.local:8123/', token: 'geheim' } as HubSettings;

const knoepfe: WidgetButton[] = [
  { key: 'door', title: 'Haustüre', symbol: 'key.fill', url: 'homepilot://door' },
  {
    key: 'scene:kino',
    title: 'Kino',
    symbol: 'sparkles',
    url: 'homepilot://scene/kino',
    direct: true,
    actionPath: '/api/scenes/kino',
    actionBody: '{}',
  },
];

afterEach(() => {
  mockModul = null;
});

describe('syncWidget', () => {
  test('fehlendes Modul heisst Huelle zu alt, nicht kein Widget', () => {
    // Genau der Rückfall, der auf dem Gerät wie Heilung aussah: keine
    // Anzeige statt der Warnung, die den TestFlight-Build verlangt.
    mockModul = null;
    expect(syncWidget(settings, true, knoepfe)).toBe('huelle-alt');
  });

  test('schreibt Knoepfe und Hausstand und liest zurueck', () => {
    mockModul = frischesModul();
    expect(syncWidget(settings, true, knoepfe)).toBe('ok');
    expect(mockModul.ablage.get('hubUrl')).toBe('http://hub.local:8123');
    expect(mockModul.ablage.get('hubToken')).toBe('geheim');
    expect(mockModul.reloadWidget).toHaveBeenCalled();
  });

  test('die Knoepfe erfuellen den Vertrag des Swift-Decoders', () => {
    // index.swift entschlüsselt key/title/symbol als String und url als
    // URL - ein einziges fehlendes Feld oder eine unlesbare Adresse
    // liesse die GANZE Liste scheitern, und das Widget fiele still auf
    // die Standardknöpfe zurück.
    mockModul = frischesModul();
    syncWidget(settings, true, knoepfe);
    const geschrieben = JSON.parse(mockModul.ablage.get('buttons') ?? '[]');
    expect(Array.isArray(geschrieben)).toBe(true);
    expect(geschrieben).toHaveLength(2);
    for (const knopf of geschrieben) {
      expect(typeof knopf.key).toBe('string');
      expect(typeof knopf.title).toBe('string');
      expect(typeof knopf.symbol).toBe('string');
      expect(() => new URL(knopf.url)).not.toThrow();
    }
  });

  test('ausgeschalteter Hausstand raeumt Adresse und Token weg', () => {
    mockModul = frischesModul();
    syncWidget(settings, true, knoepfe);
    syncWidget(settings, false, knoepfe);
    expect(mockModul.ablage.has('hubUrl')).toBe(false);
    expect(mockModul.ablage.has('hubToken')).toBe(false);
    // Die Knöpfe bleiben - sie sind kein Geheimnis.
    expect(mockModul.ablage.has('buttons')).toBe(true);
  });

  test('verschlucktes Schreiben faellt beim Zuruecklesen auf', () => {
    // Der App-Gruppen-Fall: iOS meldet Erfolg, gespeichert ist nichts.
    mockModul = { ...frischesModul(), setString: () => {}, get: () => null };
    expect(syncWidget(settings, true, knoepfe)).toBe('fehlt');
  });
});

describe('widgetSpur', () => {
  test('liest den Zeitstempel des Widgets', () => {
    mockModul = frischesModul();
    mockModul.ablage.set('widgetZuletztGelesen', '1788681600');
    expect(widgetSpur()).toBe(1788681600);
  });

  test('ohne Stempel oder mit Unlesbarem bleibt es bei null', () => {
    mockModul = frischesModul();
    expect(widgetSpur()).toBeNull();
    mockModul.ablage.set('widgetZuletztGelesen', 'gestern');
    expect(widgetSpur()).toBeNull();
  });
});

describe('abgelegteKnoepfe', () => {
  test('zaehlt, was wirklich in der Ablage liegt', () => {
    mockModul = frischesModul();
    syncWidget(settings, true, knoepfe);
    expect(abgelegteKnoepfe()).toBe(2);
  });

  test('ohne Ablage bleibt es bei null', () => {
    mockModul = null;
    expect(abgelegteKnoepfe()).toBeNull();
  });
});
