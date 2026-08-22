/**
 * Die Konfiguration lesbar machen.
 *
 * Was hier geprüft wird, ist die Zusage an den Benutzer: Die Übersicht
 * sagt, was drinsteht, und ein leeres Feld nimmt eine Angabe zurück,
 * statt sie durch nichts zu ersetzen.
 */
import {
  alsText,
  eingabeWert,
  feldergruppe,
  maskiert,
  wertVon,
  zeilen,
  zusammenfassung,
} from './konfig';

const DATEN = {
  api: { host: '0.0.0.0', port: 8123, token: 'bMfjF-sehr-geheim-XYZ' },
  location: { latitude: 47.1445, longitude: 8.0675 },
  integrations: [
    { integration: 'demo' },
    { integration: 'hue' },
    { integration: 'homematic' },
    { integration: 'ring' },
    { integration: 'roborock' },
  ],
  rooms: { Wohnzimmer: ['a'], Küche: ['b'] },
  users: [{ name: 'Stefan' }, { name: 'Sandra' }],
};

describe('zusammenfassung', () => {
  test('nennt die Anbindungen beim Namen – und kürzt bei vielen', () => {
    expect(zusammenfassung('integrations', DATEN)).toBe('5: demo, hue, homematic, ring …');
  });

  test('zählt Räume und nennt sie', () => {
    expect(zusammenfassung('rooms', DATEN)).toBe('2: Wohnzimmer, Küche');
  });

  test('nennt Benutzer beim Namen', () => {
    expect(zusammenfassung('users', DATEN)).toBe('Stefan, Sandra');
  });

  test('beim Standort zählt die Adresse, sonst die Koordinaten', () => {
    expect(zusammenfassung('location', DATEN)).toBe('47.1445, 8.0675');
    expect(
      zusammenfassung('location', { location: { ...DATEN.location, address: 'Musterweg 3' } })
    ).toBe('Musterweg 3');
  });

  test('was fehlt, heisst «nicht eingerichtet»', () => {
    expect(zusammenfassung('push', DATEN)).toBe('nicht eingerichtet');
  });
});

describe('maskiert', () => {
  test('deutet ein Geheimnis an, statt es zu zeigen', () => {
    expect(maskiert('bMfjF-sehr-geheim-XYZ')).toBe('bMf••••YZ');
    expect(maskiert('kurz')).toBe('••••');
    expect(maskiert(undefined)).toBe('');
  });
});

describe('wertVon', () => {
  test('findet, was da ist – und stolpert nicht über den Rest', () => {
    expect(wertVon(DATEN, ['api', 'port'])).toBe(8123);
    expect(wertVon(DATEN, ['push', 'public_url'])).toBeUndefined();
    expect(wertVon(DATEN, ['api', 'port', 'zuweit'])).toBeUndefined();
  });
});

describe('eingabeWert', () => {
  const zahl = { pfad: ['api', 'port'], label: 'Port', art: 'zahl' as const };
  const text = { pfad: ['location', 'address'], label: 'Adresse' };

  test('ein leeres Feld nimmt die Angabe zurück', () => {
    expect(eingabeWert(text, '   ')).toEqual({ remove: true });
  });

  test('Zahlen kommen als Zahlen an – auch mit Komma getippt', () => {
    expect(eingabeWert(zahl, '8080')).toEqual({ value: 8080 });
    expect(eingabeWert({ ...zahl, pfad: ['energy', 'price_per_kwh'] }, '0,32')).toEqual({
      value: 0.32,
    });
  });

  test('was keine Zahl ist, bleibt Text – der Hub sagt dann, was fehlt', () => {
    expect(eingabeWert(zahl, 'achtzig')).toEqual({ value: 'achtzig' });
  });
});

test('alsText macht aus Wahrheitswerten Wörter', () => {
  expect(alsText(true)).toBe('ja');
  expect(alsText(0)).toBe('0');
  expect(alsText(null)).toBe('');
});

test('zeilen sagt, wie gross ein Abschnitt ist', () => {
  expect(zeilen({ key: 'a', label: 'A', start: 10, end: 42 })).toBe(32);
});

test('nur handverlesene Abschnitte haben Formularfelder', () => {
  expect(feldergruppe('location').length).toBeGreaterThan(0);
  // Integrationen gehören in den Blockeditor: Ein Feld ohne Zusammenhang
  // hilft dort niemandem.
  expect(feldergruppe('integrations')).toEqual([]);
});

describe('Zusammenfassung von Objekten', () => {
  test('beim Zugang zählt Adresse und Port', () => {
    expect(zusammenfassung('api', DATEN)).toBe('0.0.0.0:8123');
  });

  test('sonst die Werte, nicht die Feldnamen – Geheimnisse maskiert', () => {
    const daten = { guest_wifi: { ssid: 'Familie Gross Gast', password: 'sehr-geheim-123' } };
    expect(zusammenfassung('guest_wifi', daten)).toBe('Familie Gross Gast · seh••••23');
  });

  test('ein leerer Abschnitt sagt das auch', () => {
    expect(zusammenfassung('push', { push: {} })).toBe('leer');
  });
});
