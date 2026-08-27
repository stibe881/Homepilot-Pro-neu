import { uvWort } from './uv';

test('die Stufen sind die der WHO', () => {
  expect(uvWort(1)).toBeNull();
  expect(uvWort(3)).toBe('mässig');
  expect(uvWort(6)).toBe('hoch');
  expect(uvWort(8)).toBe('sehr hoch');
  expect(uvWort(11)).toBe('extrem');
});

test('ohne Wert steht nichts da', () => {
  expect(uvWort(undefined)).toBeNull();
  expect(uvWort('wolkig')).toBeNull();
});
