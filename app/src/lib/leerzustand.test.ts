import { leerbild } from './leerzustand';

test('ohne Verbindung wird nichts über fehlende Geräte behauptet', () => {
  expect(leerbild('light', null, false).titel).toBe('Warte auf den Hub');
});

test('jede Geräteart nennt die Integrationen, die sie bringt', () => {
  expect(leerbild('light', null, true).satz).toContain('hue');
  expect(leerbild('covers', null, true).satz).toContain('overkiz');
  expect(leerbild('cameras', null, true).satz).toContain('ring');
});

test('ein leerer Raum bietet den ersten Schritt an', () => {
  const bild = leerbild('home', 'Keller', true);
  expect(bild.titel).toBe('Keller ist noch leer');
  expect(bild.aktion).toBe('Geräte zuordnen');
});

test('ganz ohne Geräte zeigt der Satz auf die config.yaml', () => {
  expect(leerbild('home', null, true).satz).toContain('config.yaml');
  expect(leerbild('home', null, true).aktion).toBeUndefined();
});
