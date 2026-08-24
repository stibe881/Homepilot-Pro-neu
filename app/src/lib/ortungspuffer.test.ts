/**
 * Der Puffer der Ortung.
 *
 * Der Fall: Man kommt heim, das Telefon kreuzt die Grenze, hängt dabei
 * noch am Mobilfunk – und die Meldung an den Hub im Heimnetz läuft ins
 * Leere. Bisher war sie damit für immer weg, und man stand bis zum
 * nächsten Weggehen auf «unterwegs».
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Der Speicher ist hier keine Nebensache, sondern der Prüfgegenstand: Ob
// eine Meldung liegen bleibt, entscheidet sich genau dort. Ohne
// Nachbildung fehlt das native Modul und der Test scheitert schon beim
// Import.
//
// Von Hand statt der Nachbildung aus dem Paket: Die kommt nur über ein
// `require` herein, und das ist in diesem Baum untersagt. Gebraucht
// werden vier Methoden – die stehen schneller hier, als die Ausnahme
// begründet wäre.
jest.mock('@react-native-async-storage/async-storage', () => {
  const inhalt = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (schluessel: string) => inhalt.get(schluessel) ?? null),
      setItem: jest.fn(async (schluessel: string, wert: string) => {
        inhalt.set(schluessel, wert);
      }),
      removeItem: jest.fn(async (schluessel: string) => {
        inhalt.delete(schluessel);
      }),
      clear: jest.fn(async () => {
        inhalt.clear();
      }),
    },
  };
});

import {
  Standortmeldung,
  aufheben,
  gueltig,
  positionMelden,
  pufferLesen,
} from './ortungspuffer';

const ZUHAUSE: Standortmeldung = {
  latitude: 47.1381,
  longitude: 7.9228,
  accuracy: 15,
  at: 1_700_000_000,
};

const UNTERWEGS: Standortmeldung = {
  latitude: 47.05,
  longitude: 8.31,
  accuracy: 20,
  at: 1_699_999_400,
};

describe('gueltig', () => {
  it('nimmt eine gewöhnliche Meldung an', () => {
    expect(gueltig(ZUHAUSE)).toBe(true);
  });

  it('verwirft den Punkt 0/0 – das ist der Atlantik, kein fehlender Wert', () => {
    expect(gueltig({ ...ZUHAUSE, latitude: 0, longitude: 0 })).toBe(false);
  });

  it('verwirft eine Meldung ohne Zeitpunkt', () => {
    // Ohne ihn kann der Hub nicht entscheiden, was neuer ist.
    expect(gueltig({ ...ZUHAUSE, at: 0 })).toBe(false);
  });

  it('verwirft Unsinn', () => {
    expect(gueltig(null)).toBe(false);
    expect(gueltig({ latitude: 'zuhause' })).toBe(false);
  });
});

describe('aufheben', () => {
  it('behält die jüngere Meldung', () => {
    expect(aufheben(UNTERWEGS, ZUHAUSE)).toBe(ZUHAUSE);
  });

  it('lässt eine ältere die frischere nicht überschreiben', () => {
    // Der Fehler, der ohne Zeitpunkt entstünde: Die zurückgestellte
    // Messung von der Ausfahrt legt sich über die von zuhause.
    expect(aufheben(ZUHAUSE, UNTERWEGS)).toBe(ZUHAUSE);
  });

  it('kommt mit einem leeren Puffer zurecht', () => {
    expect(aufheben(null, ZUHAUSE)).toBe(ZUHAUSE);
    expect(aufheben(ZUHAUSE, null)).toBe(ZUHAUSE);
    expect(aufheben(null, null)).toBeNull();
  });
});

describe('positionMelden', () => {
  const ziel = { url: 'http://hub.local:8080', token: 'geheim', zone: 'stefan' };

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it('meldet die Position und lässt den Puffer leer', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await positionMelden(ziel, ZUHAUSE)).toBe(true);
    expect(await pufferLesen()).toBeNull();

    const [url, optionen] = fetchMock.mock.calls[0];
    expect(url).toBe('http://hub.local:8080/api/presence/report');
    expect(JSON.parse(optionen.body)).toMatchObject({
      latitude: ZUHAUSE.latitude,
      accuracy: 15,
      at: ZUHAUSE.at,
      zone: 'stefan',
    });
  });

  it('hebt die Ankunft auf, wenn der Hub nicht erreichbar war', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('Network request failed')) as unknown as typeof fetch;

    expect(await positionMelden(ziel, ZUHAUSE)).toBe(false);
    expect(await pufferLesen()).toMatchObject({ at: ZUHAUSE.at });
  });

  it('reicht das Zurückgestellte beim nächsten Anlass nach', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('kein Netz')) as unknown as typeof fetch;
    await positionMelden(ziel, ZUHAUSE);

    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    // Beim nächsten Mal ist die ältere Messung die einzige, die es gibt.
    expect(await positionMelden(ziel, UNTERWEGS)).toBe(true);

    // Gemeldet wird die jüngere von beiden – die Ankunft, nicht die
    // nachgereichte Ausfahrt.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      at: ZUHAUSE.at,
    });
    expect(await pufferLesen()).toBeNull();
  });

  it('hebt eine Absage des Hubs nicht auf', async () => {
    // Ein 404 («Unbekannte Zone») ist keine Störung, sondern eine
    // Antwort. Sie aufzuheben hiesse, sie bei jedem Anlass erneut
    // abweisen zu lassen.
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404 } as Response) as unknown as typeof fetch;

    expect(await positionMelden(ziel, ZUHAUSE)).toBe(false);
    expect(await pufferLesen()).toBeNull();
  });

  it('hebt auf, wenn der Hub gerade nicht kann', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 503 } as Response) as unknown as typeof fetch;

    expect(await positionMelden(ziel, ZUHAUSE)).toBe(false);
    expect(await pufferLesen()).toMatchObject({ at: ZUHAUSE.at });
  });

  it('meldet nicht ohne Zugangsdaten, verliert die Messung aber auch nicht', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await positionMelden({ url: '', token: '', zone: '' }, ZUHAUSE)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await pufferLesen()).toMatchObject({ at: ZUHAUSE.at });
  });
});
