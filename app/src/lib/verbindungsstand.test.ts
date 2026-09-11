import { VERBINDUNGSWORT, verbindungsAnsage, verbindungsZusatz } from './verbindungsstand';

describe('verbindungsZusatz', () => {
  it('schreibt neben den Punkt nichts, solange nichts wartet', () => {
    // Der Grund für die ganze Änderung: «verbunden» stand fast immer
    // da und sagte dasselbe wie der grüne Punkt daneben.
    expect(verbindungsZusatz(0)).toBe('');
    expect(verbindungsZusatz(-1)).toBe('');
  });

  it('nennt die wartenden Befehle - die sagt sonst niemand', () => {
    // Ohne diese Zahl ist ein Tipp im Funkloch nicht von einem
    // verschluckten Befehl zu unterscheiden.
    expect(verbindungsZusatz(1)).toBe('1 wartet');
    expect(verbindungsZusatz(3)).toBe('3 wartet');
  });
});

describe('verbindungsAnsage', () => {
  it('sagt der Vorlesefunktion, was der Punkt zeigt', () => {
    // Ein farbiger Kreis ohne Beschriftung ist für VoiceOver eine leere
    // Fläche - und für wen Farben schwer zu unterscheiden sind, die
    // einzige Auskunft, die er nicht bekommt.
    expect(verbindungsAnsage('connected', 0)).toBe('verbunden');
    expect(verbindungsAnsage('disconnected', 0)).toBe('getrennt');
    expect(verbindungsAnsage('connecting', 0)).toBe(VERBINDUNGSWORT.connecting);
  });

  it('nimmt die Wartezahl mit', () => {
    expect(verbindungsAnsage('disconnected', 2)).toBe('getrennt · 2 wartet');
  });
});
