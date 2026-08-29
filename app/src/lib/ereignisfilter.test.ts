import { gefiltert, istTagsueber } from './ereignisfilter';

const um = (stunde: number, detected: string[] = []) => ({
  start: `2026-08-27T${String(stunde).padStart(2, '0')}:30:00`,
  detected,
});

test('nur Personen lässt die Katzen weg', () => {
  const { sichtbar, verborgen } = gefiltert(
    [um(10, ['person']), um(11, ['animal']), um(12, [])],
    { nurPersonen: true, nurTagsueber: false }
  );
  expect(sichtbar).toHaveLength(1);
  expect(verborgen).toBe(2);
});

test('tagsüber heisst 7 bis 22 Uhr', () => {
  expect(istTagsueber('2026-08-27T06:59:00')).toBe(false);
  expect(istTagsueber('2026-08-27T07:00:00')).toBe(true);
  expect(istTagsueber('2026-08-27T21:59:00')).toBe(true);
  expect(istTagsueber('2026-08-27T22:00:00')).toBe(false);
});

test('beide Schalter zusammen: die Person um drei Uhr nachts bleibt weg', () => {
  const { sichtbar } = gefiltert(
    [um(3, ['person']), um(14, ['person'])],
    { nurPersonen: true, nurTagsueber: true }
  );
  expect(sichtbar).toHaveLength(1);
  expect(sichtbar[0].start).toContain('T14');
});

test('ohne Filter wird nichts verschluckt', () => {
  const { sichtbar, verborgen } = gefiltert([um(3), um(14)], {
    nurPersonen: false,
    nurTagsueber: false,
  });
  expect(sichtbar).toHaveLength(2);
  expect(verborgen).toBe(0);
});
