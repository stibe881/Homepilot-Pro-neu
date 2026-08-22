/**
 * Die benannten Datums-Formate.
 *
 * Die Tests halten fest, wie die Formate aussehen – wer eines ändert,
 * ändert es bewusst für die ganze App, nicht versehentlich für eine
 * einzelne Stelle.
 */
import {
  datumKurz,
  datumUhr,
  datumVoll,
  monatJahr,
  uhr,
  wochentag,
  wochentagDatum,
  wochentagDatumKurz,
  wochentagUhr,
} from './format';

// Mittwoch, 19. August 2026, 07:02 Ortszeit.
const wann = new Date(2026, 7, 19, 7, 2);

describe('format', () => {
  it('kennt jedes Format genau einmal', () => {
    expect(uhr(wann)).toBe('07:02');
    expect(datumUhr(wann)).toBe('19. Aug., 07:02');
    expect(datumKurz(wann)).toBe('19. Aug.');
    expect(wochentag(wann)).toBe('Mi');
    expect(wochentagUhr(wann)).toBe('Mi., 07:02');
    expect(wochentagDatumKurz(wann)).toBe('Mi., 19. Aug.');
    expect(wochentagDatum(wann)).toBe('Mittwoch, 19. August');
    expect(datumVoll(wann)).toBe('Mi., 19.08.2026');
    expect(monatJahr(wann)).toBe('August 2026');
  });

  it('nimmt auch Millisekunden', () => {
    expect(uhr(wann.getTime())).toBe('07:02');
  });
});
