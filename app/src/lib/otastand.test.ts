/** Liegt eine nachgeladene Fassung bereit - und was sagt man dazu? */
import { otaLage, otaZeile } from './otastand';

describe('otaLage', () => {
  it('meldet «bereit», sobald etwas daliegt', () => {
    // Auch ohne Nachfrage: Was schon geholt ist, beantwortet die Frage.
    expect(otaLage({ bereit: true, verfuegbar: false, gefragt: false })).toBe('bereit');
  });

  it('unterscheidet «neu» von «aktuell»', () => {
    expect(otaLage({ bereit: false, verfuegbar: true, gefragt: true })).toBe('neu');
    expect(otaLage({ bereit: false, verfuegbar: false, gefragt: true })).toBe('aktuell');
  });

  it('behauptet nichts, solange nicht gefragt wurde', () => {
    // Sonst stünde beim Öffnen der Seite eine Sekunde lang «alles
    // aktuell» - und genau das war die Auskunft, die nicht stimmte.
    expect(otaLage({ bereit: false, verfuegbar: false, gefragt: false })).toBe('offen');
  });
});

describe('otaZeile', () => {
  it('bietet einen Knopf, wo es etwas zu tun gibt', () => {
    expect(otaZeile('bereit').knopf).toBe('Jetzt übernehmen');
    expect(otaZeile('neu').knopf).toBe('Holen und übernehmen');
  });

  it('sagt auch, wenn nichts zu tun ist', () => {
    // Wer gerade ein Update gemacht hat, sucht die Bestätigung - eine
    // fehlende Meldung könnte genauso gut ein Fehler sein.
    expect(otaZeile('aktuell').knopf).toBeNull();
    expect(otaZeile('aktuell').text).toContain('neusten');
  });

  it('schweigt, solange die Nachfrage läuft', () => {
    expect(otaZeile('offen')).toEqual({ text: '', knopf: null });
  });
});
