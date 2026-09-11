import { themenprobe } from './themenprobe';
import { darkColors, lightColors, sandColors } from '../theme';

describe('themenprobe', () => {
  it('zeigt zwei Enden desselben Verlaufs', () => {
    expect(themenprobe('sand')).toEqual([sandColors.gradient[0], sandColors.gradient[2]]);
  });

  it('zeigt bei «System» hell über dunkel', () => {
    // Es ist beides - und genau das soll der Fleck sagen, statt eine
    // der beiden Möglichkeiten zu behaupten.
    expect(themenprobe('system')).toEqual([
      lightColors.gradient[0],
      darkColors.gradient[2],
    ]);
    expect(themenprobe('auto')).toEqual(themenprobe('system'));
  });

  it('gibt für jedes Erscheinungsbild zwei verschiedene Farben', () => {
    // Ein Fleck aus zweimal derselben Farbe wäre kein Verlauf, sondern
    // ein Fehler, den niemand sieht.
    for (const mode of ['system', 'auto', 'light', 'dark', 'pink', 'mitternacht', 'sand'] as const) {
      const [oben, unten] = themenprobe(mode);
      expect(oben).toMatch(/^#/);
      expect(unten).toMatch(/^#/);
      expect(oben).not.toBe(unten);
    }
  });
});
