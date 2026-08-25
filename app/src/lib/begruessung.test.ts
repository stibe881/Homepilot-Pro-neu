/**
 * Wen die Startseite begrüsst.
 *
 * Der Fall: «Wenn ein Benutzer im Wandpanel-Modus ist, soll nicht Hallo
 * <Name des Benutzers> stehen.» Vor dem iPad im Flur steht mal die eine,
 * mal der andere – der Name des Zugangs sagt nichts darüber.
 */
import { begruessung } from './begruessung';

const stefan = { name: 'Stefan' };

describe('begruessung', () => {
  it('nennt am Telefon den angemeldeten Menschen', () => {
    expect(begruessung({}, stefan)).toBe('Hallo Stefan,');
  });

  it('nennt am Wandpanel niemanden', () => {
    // «Hallo Stefan» begrüsst dort den Falschen, auch wenn Stefans
    // Zugang im Gerät steckt.
    expect(begruessung({ panel: true }, stefan)).toBe('Willkommen zuhause,');
  });

  it('nimmt am Panel den selbst gesetzten Namen', () => {
    // Wer «Küche» hinschreibt, meint es so.
    expect(begruessung({ panel: true, name: 'Küche' }, stefan)).toBe('Hallo Küche,');
    // Leerzeichen sind keine Angabe.
    expect(begruessung({ panel: true, name: '   ' }, stefan)).toBe('Willkommen zuhause,');
  });

  it('behandelt das Gemeinschaftsgerät gleich', () => {
    // Derselbe Fall, nur vom Hub her entschieden statt vom Gerät.
    expect(begruessung({}, { name: 'Wandtablet Flur', shared: true })).toBe(
      'Willkommen zuhause,'
    );
    expect(begruessung({ name: 'Flur' }, { name: 'Wandtablet Flur', shared: true })).toBe(
      'Hallo Flur,'
    );
  });

  it('grüsst auch ohne jede Angabe', () => {
    expect(begruessung({}, null)).toBe('Willkommen zuhause,');
  });
});
