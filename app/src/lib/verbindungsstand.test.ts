import {
  CODE_ABGEMELDET,
  VERBINDUNGSWORT,
  WARTEZEIT_MAX_MS,
  nachSchliessen,
  verbindungsAnsage,
  verbindungsZusatz,
  wartezeit,
} from './verbindungsstand';

describe('nachSchliessen', () => {
  // Punkt 579 der Werkbank: Ein unter «Meine Geräte» beendetes iPad
  // verband in Endlosschleife neu und sagte «Keine Verbindung», obwohl
  // der Hub erreichbar war und gerade 4401 geantwortet hatte.
  it('gibt nach 4401 auf, statt weiter anzuklopfen', () => {
    expect(nachSchliessen(CODE_ABGEMELDET, 3, 1_000_000)).toEqual({
      status: 'signed_out',
      wiederAb: null,
    });
  });

  it('verbindet nach einem gewöhnlichen Abbruch mit wachsender Wartezeit neu', () => {
    expect(nachSchliessen(1006, 0, 1_000_000)).toEqual({
      status: 'disconnected',
      wiederAb: 1_001_000,
    });
    expect(nachSchliessen(1000, 2, 1_000_000).wiederAb).toBe(1_004_000);
    // Ohne Code (ein von der App selbst geschlossener Socket) dasselbe.
    expect(nachSchliessen(undefined, 0, 1_000_000).status).toBe('disconnected');
  });

  it('wartet nie länger als die Obergrenze', () => {
    expect(wartezeit(10)).toBe(WARTEZEIT_MAX_MS);
    expect(wartezeit(0)).toBe(1000);
  });
});

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
    expect(verbindungsAnsage('signed_out', 0)).toBe('abgemeldet');
  });

  it('nimmt die Wartezahl mit', () => {
    expect(verbindungsAnsage('disconnected', 2)).toBe('getrennt · 2 wartet');
  });
});
