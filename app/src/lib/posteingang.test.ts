import { sortiert, ungelesen } from './posteingang';

describe('ungelesen', () => {
  it('zählt nur, was nach dem letzten Öffnen kam', () => {
    const liste = [{ at: 10 }, { at: 20 }, { at: 30 }];
    expect(ungelesen(liste, 0)).toBe(3);
    expect(ungelesen(liste, 20)).toBe(1);
    expect(ungelesen(liste, 30)).toBe(0);
    expect(ungelesen([{ at: Number.NaN }], 0)).toBe(0);
  });
});

describe('sortiert', () => {
  it('stellt das Zurückgehaltene nach vorn, jüngste zuerst', () => {
    const { zurueckgehalten, uebrige } = sortiert([
      { title: 'a', at: 1 },
      { title: 'b', at: 3, verpasst: true },
      { title: 'c', at: 2, verpasst: true },
    ]);
    expect(zurueckgehalten.map((z) => z.title)).toEqual(['b', 'c']);
    expect(uebrige.map((z) => z.title)).toEqual(['a']);
  });
});
