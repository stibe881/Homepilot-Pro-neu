/**
 * Wie und wen die Startseite begrüsst.
 *
 * Zwei Fälle stecken darin. «Es gibt nicht viel Sinn, zweimal begrüsst zu
 * werden»: «Hallo Stefan,» und darunter «Guten Abend.» – jetzt ein Satz.
 * Und: «Wenn ein Benutzer im Wandpanel-Modus ist, soll nicht Hallo <Name>
 * stehen.» Vor dem iPad im Flur steht mal die eine, mal der andere.
 */
import { angesprochen, begruessung, tageszeitGruss } from './begruessung';

const stefan = { name: 'Stefan' };
const um = (stunde: number) => new Date(2026, 7, 26, stunde, 30);

describe('tageszeitGruss', () => {
  it('grüsst, wie man es zur Stunde täte', () => {
    expect(tageszeitGruss(um(7))).toBe('Guten Morgen');
    expect(tageszeitGruss(um(14))).toBe('Hallo');
    expect(tageszeitGruss(um(20))).toBe('Guten Abend');
  });

  it('sagt um zwei Uhr nachts nicht «Guten Morgen»', () => {
    // Wer da noch die Storen schliesst, ist nicht früh auf, sondern spät
    // dran.
    expect(tageszeitGruss(um(2))).toBe('Guten Abend');
  });
});

describe('begruessung', () => {
  it('begrüsst einmal, nicht zweimal', () => {
    // Vorher: «Hallo Stefan,» und darunter «Guten Abend.»
    expect(begruessung({}, stefan, um(20))).toBe('Guten Abend, Stefan.');
    expect(begruessung({}, stefan, um(7))).toBe('Guten Morgen, Stefan.');
    expect(begruessung({}, stefan, um(14))).toBe('Hallo, Stefan.');
  });

  it('nennt am Wandpanel niemanden', () => {
    // «Guten Abend, Stefan» begrüsst dort den Falschen, auch wenn
    // Stefans Zugang im Gerät steckt.
    expect(begruessung({ panel: true }, stefan, um(20))).toBe('Guten Abend.');
  });

  it('nimmt am Panel den selbst gesetzten Namen', () => {
    // Wer «Küche» hinschreibt, meint es so.
    expect(begruessung({ panel: true, name: 'Küche' }, stefan, um(20))).toBe(
      'Guten Abend, Küche.'
    );
    // Leerzeichen sind keine Angabe.
    expect(begruessung({ panel: true, name: '   ' }, stefan, um(20))).toBe(
      'Guten Abend.'
    );
  });

  it('behandelt das Gemeinschaftsgerät gleich', () => {
    // Derselbe Fall, nur vom Hub her entschieden statt vom Gerät.
    const tablet = { name: 'Wandtablet Flur', shared: true };
    expect(begruessung({}, tablet, um(20))).toBe('Guten Abend.');
    expect(begruessung({ name: 'Flur' }, tablet, um(20))).toBe('Guten Abend, Flur.');
  });

  it('räuspert sich mittags nicht bloss', () => {
    // «Hallo.» allein ist keine Begrüssung.
    expect(begruessung({ panel: true }, stefan, um(14))).toBe('Willkommen zuhause.');
  });

  it('grüsst auch ohne jede Angabe', () => {
    expect(begruessung({}, null, um(20))).toBe('Guten Abend.');
  });
});

describe('angesprochen', () => {
  it('sagt, wen die Seite meint – oder niemanden', () => {
    expect(angesprochen({}, stefan)).toBe('Stefan');
    expect(angesprochen({ panel: true }, stefan)).toBeNull();
    expect(angesprochen({}, null)).toBeNull();
  });
});
