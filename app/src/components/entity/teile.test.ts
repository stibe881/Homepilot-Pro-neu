import { darkColors, lightColors } from '../../theme';
import { format, pillSchrift } from './teile';

// Die Bewegungsmarke bringt ein Sinnbild mit, und die Symbolschrift
// lädt im Test nicht - hier zählen nur die reinen Funktionen.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('format', () => {
  it('rundet Zahlen auf eine Nachkommastelle', () => {
    expect(format(21.47)).toBe('21.5');
    expect(format(21)).toBe('21');
  });

  it('macht aus dem Platzhalter des Hubs einen Strich', () => {
    // Der Hub setzt `unknown`, bis ein frisch angelerntes Gerät sich
    // zum ersten Mal meldet. Auf der Kachel stand das in grossen
    // Buchstaben - vier Klimafühler lang sah das aus wie ein Defekt.
    expect(format('unknown')).toBe('–');
    expect(format('unavailable')).toBe('–');
    expect(format(null)).toBe('–');
    expect(format('')).toBe('–');
  });

  it('lässt einen echten Fehlerwert stehen', () => {
    // Der ist die Wahrheit und man kann danach suchen.
    expect(format('error')).toBe('error');
    expect(format('offline')).toBe('offline');
  });
});

describe('pillSchrift', () => {
  // Punkt 609 der Werkbank: Die Signalfarbe gehört an den Rand der
  // Pille, nicht in ihre Schrift - und auf eine gefüllte Pille gehört
  // die Gegenfarbe der Palette, nicht fest Weiss.
  it('schreibt eine grüne oder orange Umriss-Pille in der Tinte der Farbe', () => {
    expect(pillSchrift(lightColors, lightColors.on, false)).toBe(lightColors.onInk);
    expect(pillSchrift(lightColors, lightColors.warn, false)).toBe(lightColors.warnInk);
    expect(pillSchrift(lightColors, lightColors.danger, false)).toBe(lightColors.danger);
  });

  it('schreibt auf Grün und Orange mit onSignal, auf Akzent und Rot mit onAccent', () => {
    expect(pillSchrift(darkColors, darkColors.on, true)).toBe(darkColors.onSignal);
    expect(pillSchrift(darkColors, darkColors.warn, true)).toBe(darkColors.onSignal);
    expect(pillSchrift(darkColors, darkColors.accent, true)).toBe(darkColors.onAccent);
    expect(pillSchrift(darkColors, darkColors.danger, true)).toBe(darkColors.onAccent);
  });
});
