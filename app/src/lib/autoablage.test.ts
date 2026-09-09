import { HubSettings } from '../api/types';
import { WidgetButton } from './widgetButtons';

/**
 * Der Schreibweg ins Auto, mit nachgebautem nativem Modul.
 *
 * Dieselbe Lehre wie bei der Widget-Ablage: Ohne einen Test von aussen
 * sehen «schreibt nichts», «schreibt ins Leere» und «es gibt nichts zu
 * schreiben» alle gleich aus - nämlich nach einem leeren Bildschirm im
 * Auto.
 */

let mockModul: {
  topf: Map<string, string>;
  setzen: (schluessel: string, wert: string) => void;
  entfernen: (schluessel: string) => void;
} | null = null;

jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) =>
    name === 'AutoAblage' ? mockModul : null,
}));

import { syncAuto } from './autoablage';

function frisch() {
  const topf = new Map<string, string>();
  return {
    topf,
    setzen: (schluessel: string, wert: string) => {
      topf.set(schluessel, wert);
    },
    entfernen: (schluessel: string) => {
      topf.delete(schluessel);
    },
  };
}

const settings = { url: 'http://hub.local:8123/', token: 'geheim' } as HubSettings;

const knoepfe: WidgetButton[] = [
  {
    key: 'door',
    title: 'Haustüre',
    symbol: 'key.fill',
    url: 'homepilot://door',
    direct: true,
    actionPath: '/api/entities/nuki.tuer/command',
    actionBody: '{"command":"unlatch"}',
  },
  {
    key: 'alarm',
    title: 'Alarm',
    symbol: 'shield.fill',
    url: 'homepilot://alarm',
  },
];

afterEach(() => {
  mockModul = null;
});

describe('syncAuto', () => {
  it('legt Knöpfe, Adresse und Token ab', () => {
    mockModul = frisch();
    expect(syncAuto(settings, knoepfe)).toBe('ok');
    expect(mockModul.topf.get('hubUrl')).toBe('http://hub.local:8123');
    expect(mockModul.topf.get('hubToken')).toBe('geheim');
    const abgelegt = JSON.parse(mockModul.topf.get('knoepfe') ?? '[]');
    // Nur der Knopf, der selbst schaltet - der andere öffnete die App,
    // und im Auto gibt es nichts zu öffnen.
    expect(abgelegt).toHaveLength(1);
    expect(abgelegt[0].symbol).toBe('tuer');
    expect(abgelegt[0].path).toBe('/api/entities/nuki.tuer/command');
  });

  it('ohne selbst schaltende Knöpfe bleibt der Topf leer', () => {
    // Und zwar wirklich leer: Stünde die Liste von gestern noch da,
    // zeigte das Auto Kacheln, die es in der App nicht mehr gibt.
    mockModul = frisch();
    mockModul.topf.set('knoepfe', '[{"key":"alt"}]');
    expect(syncAuto(settings, [knoepfe[1]])).toBe('keine-knoepfe');
    expect(mockModul.topf.has('knoepfe')).toBe(false);
  });

  it('ohne Verbindung fliegen Adresse und Token weg', () => {
    mockModul = frisch();
    syncAuto(settings, knoepfe);
    syncAuto({ url: '', token: '' } as HubSettings, knoepfe);
    expect(mockModul.topf.has('hubUrl')).toBe(false);
    expect(mockModul.topf.has('hubToken')).toBe(false);
    // Die Knöpfe bleiben: Sie sind kein Geheimnis, und ohne sie stünde
    // das Auto beim nächsten Anstecken leer da, bevor die App lief.
    expect(mockModul.topf.has('knoepfe')).toBe(true);
  });

  it('eine Hülle ohne das Modul sagt es, statt zu stürzen', () => {
    // Jedes Telefon vor dem nächsten Bau ist so eine Hülle.
    mockModul = null;
    expect(syncAuto(settings, knoepfe)).toBe('huelle-alt');
  });

  it('ein Topf, der wirft, hält die App nicht an', () => {
    mockModul = {
      ...frisch(),
      setzen: () => {
        throw new Error('kein Platz');
      },
    };
    expect(syncAuto(settings, knoepfe)).toBe('huelle-alt');
  });
});
