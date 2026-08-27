import { gaesteSatz, restText } from './gaeste';

const JETZT = 1_800_000_000_000;
const inMinuten = (m: number) => ({ active: true, until: (JETZT + m * 60_000) / 1000 });

test('die Restzeit kommt aus der Frist, nicht aus der Zahl von vorhin', () => {
  expect(restText(inMinuten(130), JETZT)).toBe('2 Std 10 Min');
  expect(restText(inMinuten(120), JETZT)).toBe('2 Std');
  expect(restText(inMinuten(40), JETZT)).toBe('40 Min');
});

test('eine abgelaufene Frist behauptet keine Restzeit mehr', () => {
  expect(restText(inMinuten(-5), JETZT)).toBe('gleich zu Ende');
});

test('ohne laufenden Modus gibt es keine Restzeit', () => {
  expect(restText(null, JETZT)).toBe('');
  expect(restText({ active: false }, JETZT)).toBe('');
});

test('die Zeile im Menü sagt, was der Griff tut – oder wie lange er noch läuft', () => {
  expect(gaesteSatz(null, JETZT)).toContain('WLAN');
  expect(gaesteSatz(inMinuten(90), JETZT)).toBe('Läuft noch 1 Std 30 Min');
});
