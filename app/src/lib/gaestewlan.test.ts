import { gaesteansicht } from './gaestewlan';

test('ohne WLAN und ohne UniFi bleibt nur der Einrichtungshinweis', () => {
  expect(gaesteansicht(false, null)).toBe('einrichten');
});

test('ein hinterlegtes Gaeste-WLAN genuegt fuer die Karte', () => {
  expect(gaesteansicht(true, null)).toBe('karte');
});

test('die UniFi-Anbindung zeigt den Spender auch mit leerem Vorrat', () => {
  // Der Fall des Hauses: kein guest_wifi, kein Passwort, nur das Portal.
  // Hier muss der erste Gutschein angelegt werden koennen.
  expect(gaesteansicht(false, [])).toBe('karte');
});

test('vorhandene Gutscheine zeigen die Karte ohnehin', () => {
  expect(gaesteansicht(false, [{ id: 'a' }])).toBe('karte');
});
