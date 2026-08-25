/**
 * Warum das Radio manchmal nirgends hin kann.
 *
 * Der Fall: «Wenn ich auf Radio wechsle, dann einen Sender anklicke,
 * passiert nichts.» Die Karte sah normal aus, der Sender liess sich
 * antippen – und der Ton hatte kein Ziel. Der Satz dazu stand nur in der
 * Boxenzeile, und die ist auf der Startseite ausgeblendet.
 */
import { keineBoxText, senderzeile } from './radiobox';

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

describe('senderzeile', () => {
  it('nennt den Sender, solange er läuft', () => {
    expect(senderzeile({ state: 'playing', station: 'SRF 3' })).toEqual({
      sender: 'SRF 3',
      laedt: false,
    });
  });

  it('sagt, dass noch geladen wird', () => {
    // Der gemeldete Fall: «Es dauert lange, bis die Musik kommt.» Der
    // Sender stand da, es kam nichts – und niemand wusste, ob daraus
    // noch etwas wird.
    expect(senderzeile({ state: 'playing', station: 'SRF 3', buffering: true })).toEqual({
      sender: 'SRF 3',
      laedt: true,
    });
  });

  it('behauptet nach dem Anhalten nichts mehr', () => {
    // Der Name wäre eine Aussage über die Gegenwart, die nicht stimmt.
    expect(senderzeile({ state: 'idle', station: 'SRF 3' }).sender).toBeNull();
    expect(senderzeile({ state: 'idle', station: 'SRF 3', buffering: true }).laedt).toBe(
      false
    );
    expect(senderzeile({}).sender).toBeNull();
  });
});
