/**
 * Warum das Radio manchmal nirgends hin kann.
 *
 * Der Fall: «Wenn ich auf Radio wechsle, dann einen Sender anklicke,
 * passiert nichts.» Die Karte sah normal aus, der Sender liess sich
 * antippen – und der Ton hatte kein Ziel. Der Satz dazu stand nur in der
 * Boxenzeile, und die ist auf der Startseite ausgeblendet.
 */
import { keineBoxText } from './radiobox';

describe('keineBoxText', () => {
  it('unterscheidet «gar keine Box» von «keine passende»', () => {
    // Zwei verschiedene Dinge sind zu tun: eine Box anschaffen oder die
    // vorhandene anbinden. Ein Satz für beides hülfe bei keinem.
    expect(keineBoxText(0)).toContain('Keine Box da');
    expect(keineBoxText(3)).toContain('Keine der bekannten Boxen');
  });

  it('nennt in beiden Fällen, was gebraucht wird', () => {
    for (const text of [keineBoxText(0), keineBoxText(2)]) {
      expect(text).toMatch(/Chromecast|Cast-Gerät/);
    }
  });
});
