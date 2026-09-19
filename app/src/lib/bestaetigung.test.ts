import { zweiterTipp } from './bestaetigung';

describe('zweiterTipp (Punkt 677)', () => {
  it('zeigt die normale Beschriftung, solange nicht bestätigt wird', () => {
    expect(zweiterTipp('Löschen', 'löschen', false)).toBe('Löschen');
    expect(zweiterTipp('Auf + öffnen', 'öffnen', false)).toBe('Auf + öffnen');
  });

  it('fragt einheitlich mit Fragezeichen, sobald der erste Tipp scharf steht', () => {
    expect(zweiterTipp('Löschen', 'löschen', true)).toBe('Wirklich löschen?');
    expect(zweiterTipp('Auf + öffnen', 'öffnen', true)).toBe('Wirklich öffnen?');
    expect(zweiterTipp('Zurücksetzen', 'zurücksetzen', true)).toBe('Wirklich zurücksetzen?');
  });

  it('nimmt das Verb, nicht die (oft längere oder andere) normale Beschriftung', () => {
    // «Auf + öffnen» und «Aufnahme X löschen» sind die Knopftexte im Ruhezustand -
    // die Nachfrage nennt trotzdem nur das kurze Verb.
    expect(zweiterTipp('Aufnahme Grillcam löschen', 'löschen', true)).toBe('Wirklich löschen?');
  });
});
