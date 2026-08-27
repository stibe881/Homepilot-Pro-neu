import { linienPunkte } from './funkenlinie';

test('die Zeitachse ist echt – ein Loch bleibt ein Loch', () => {
  // Drei Punkte, aber der dritte kommt nach langer Pause: Er landet am
  // rechten Rand, der zweite bleibt nah beim ersten.
  const punkte = linienPunkte([[0, 10], [10, 20], [100, 10]], 100, 20);
  const xs = punkte.split(' ').map((paar) => Number(paar.split(',')[0]));
  expect(xs[0]).toBe(0);
  expect(xs[1]).toBe(10);
  expect(xs[2]).toBe(100);
});

test('eine flache Reihe wird zur Mittellinie – flach ist eine Antwort', () => {
  const punkte = linienPunkte([[0, 21], [50, 21], [100, 21]], 100, 20);
  for (const paar of punkte.split(' ')) {
    expect(Number(paar.split(',')[1])).toBe(10);
  }
});

test('unter zwei Punkten gibt es keine Linie', () => {
  expect(linienPunkte([[0, 1]], 100, 20)).toBe('');
  expect(linienPunkte(undefined, 100, 20)).toBe('');
});

test('der höchste Wert liegt oben, der tiefste unten', () => {
  const punkte = linienPunkte([[0, 10], [100, 30]], 100, 20).split(' ');
  const y0 = Number(punkte[0].split(',')[1]);
  const y1 = Number(punkte[1].split(',')[1]);
  expect(y1).toBeLessThan(y0);
});
