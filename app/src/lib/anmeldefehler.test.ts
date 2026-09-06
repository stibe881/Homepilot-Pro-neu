/**
 * Die Anmeldemaske darf 401 nicht als «Anmeldung abgelaufen» vorlesen -
 * vor der Anmeldung gibt es nichts, was abgelaufen sein könnte.
 * Punkt 247 der Werkbank.
 */
import { anmeldeFehlerText } from './anmeldefehler';

describe('anmeldeFehlerText', () => {
  it('macht aus 401 «Name oder Passwort stimmt nicht»', () => {
    expect(
      anmeldeFehlerText(401, 'Dafür fehlt die Berechtigung – oder die Anmeldung ist abgelaufen.', 'anmelden')
    ).toBe('Name oder Passwort stimmt nicht.');
  });

  it('nennt beim Passwort-Wechsel das bisherige Passwort als Grund', () => {
    // Der Hub sagt bei 403 im Wechsel genau das (routes/auth.py) - der
    // Client wirft dieses `detail` aber weg, deshalb steht der Satz hier.
    expect(anmeldeFehlerText(403, 'egal', 'wechsel')).toBe(
      'Das bisherige Passwort stimmt nicht.'
    );
  });

  it('sagt beim Anmelden mit 403, dass der Zugang gesperrt ist', () => {
    expect(anmeldeFehlerText(403, 'egal', 'anmelden')).toContain('gesperrt');
  });

  it('lässt die Sätze des Clients sonst unangetastet', () => {
    // Zeitlimit: Der Satz des Clients sagt schon alles.
    expect(anmeldeFehlerText(null, 'Der Hub antwortet nicht. Ist er erreichbar?', 'anmelden')).toBe(
      'Der Hub antwortet nicht. Ist er erreichbar?'
    );
    // 429: Der Hub schreibt einen fertigen Satz in `detail`, und der
    // Client reicht ihn durch - hier darf nichts überschrieben werden.
    expect(
      anmeldeFehlerText(429, 'Zu viele Fehlversuche. In 30 Sekunden wieder.', 'anmelden')
    ).toBe('Zu viele Fehlversuche. In 30 Sekunden wieder.');
  });
});
